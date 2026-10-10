/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//! The frame codec (ADR 0028): Reed-Solomon blocks whose bytes alternate
//! across the grid, whitened, packed into cells; and the soft-decision
//! decoder that marks the bytes of unsure cells as erasures. Every block
//! carries a CRC-32 tag over its identity and data (ADR 0043), so a block the
//! code repairs wrongly, or a good block read under the wrong identity, is
//! refused.

use alloc::vec::Vec;

use qrcraftly_core::crc32;

use crate::layout::BAND_ROWS;
use crate::rs;

/// Bytes of the identity-bound tag after each block's data, inside the codeword.
pub const TAG_BYTES: usize = 4;

/// The tag of one block: CRC-32 over the session, the frame sequence and the
/// block's index in the frame (big-endian, 32 bits each), then the data.
pub fn block_tag(session: u32, seq: u32, index: u32, data: &[u8]) -> u32 {
    let mut identity = [0u8; 12];
    identity[..4].copy_from_slice(&session.to_be_bytes());
    identity[4..8].copy_from_slice(&seq.to_be_bytes());
    identity[8..].copy_from_slice(&index.to_be_bytes());
    crc32::update(crc32::checksum(&identity), data)
}

/// Whether a repaired codeword's tag matches its data and identity.
fn tag_matches(word: &[u8], packet_bytes: usize, session: u32, seq: u32, index: u32) -> bool {
    let (data, rest) = word.split_at(packet_bytes);
    let tag = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]);
    tag == block_tag(session, seq, index, data)
}

/// A frame's shape and what it carries, as `frameCapacity` computes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capacity {
    pub data_cells: usize,
    pub bits_per_cell: usize,
    pub stream_bytes: usize,
    pub packet_bytes: usize,
    pub parity: usize,
    /// Data, tag and check bytes.
    pub block_bytes: usize,
    pub blocks: usize,
}

impl Capacity {
    /// `None` when a block would not fit a Reed-Solomon codeword or no block fits the grid.
    pub fn new(
        bits_per_cell: u32,
        cols: u32,
        rows: u32,
        packet_bytes: u32,
        parity: u32,
    ) -> Option<Capacity> {
        if !(1..=4).contains(&bits_per_cell) || rows < 2 * BAND_ROWS || cols > 4096 || rows > 4096 {
            return None;
        }
        let block_bytes = packet_bytes as usize + TAG_BYTES + parity as usize;
        if packet_bytes < 1 || block_bytes > 255 {
            return None;
        }
        let data_cells = (cols * (rows - 2 * BAND_ROWS)) as usize;
        let stream_bytes = data_cells * bits_per_cell as usize / 8;
        let blocks = stream_bytes / block_bytes;
        if blocks < 1 {
            return None;
        }
        Some(Capacity {
            data_cells,
            bits_per_cell: bits_per_cell as usize,
            stream_bytes,
            packet_bytes: packet_bytes as usize,
            parity: parity as usize,
            block_bytes,
            blocks,
        })
    }

    pub fn payload_bytes(&self) -> usize {
        self.blocks * self.packet_bytes
    }
}

/// The seeded generator the TypeScript modem uses (mulberry32).
pub struct Mulberry32(u32);

impl Mulberry32 {
    pub fn new(seed: u32) -> Mulberry32 {
        Mulberry32(seed)
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let s = self.0;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        t ^ (t >> 14)
    }
}

/// XORs a byte stream with a pseudo-random one, so long runs of one colour do not occur.
pub fn whiten(stream: &mut [u8], session: u32, seq: u32) {
    let mut rng = Mulberry32::new(session ^ seq.wrapping_add(1).wrapping_mul(0x9e37_79b1));
    for chunk in stream.chunks_mut(4) {
        let word = rng.next_u32();
        for (k, byte) in chunk.iter_mut().enumerate() {
            *byte ^= (word >> (8 * k)) as u8;
        }
    }
}

/// Encodes one frame's data cells: one symbol per cell into `symbols`
/// (`data_cells` long). `payload` holds at most `payload_bytes`; the rest is
/// zero padded. `stream` and `message` are scratch.
pub fn encode(
    capacity: &Capacity,
    payload: &[u8],
    session: u32,
    seq: u32,
    symbols: &mut [u8],
    stream: &mut Vec<u8>,
    message: &mut Vec<u8>,
) -> bool {
    if payload.len() > capacity.payload_bytes() || symbols.len() != capacity.data_cells {
        return false;
    }
    stream.clear();
    stream.resize(capacity.stream_bytes, 0);
    message.clear();
    message.resize(capacity.payload_bytes(), 0);
    message[..payload.len()].copy_from_slice(payload);
    let mut word = [0u8; 255];
    let mut tagged = [0u8; 255];
    let k = capacity.packet_bytes;
    for b in 0..capacity.blocks {
        let data = &message[b * k..(b + 1) * k];
        tagged[..k].copy_from_slice(data);
        tagged[k..k + TAG_BYTES]
            .copy_from_slice(&block_tag(session, seq, b as u32, data).to_be_bytes());
        if !rs::encode(&tagged[..k + TAG_BYTES], capacity.parity, &mut word) {
            return false;
        }
        for (i, &byte) in word[..capacity.block_bytes].iter().enumerate() {
            stream[i * capacity.blocks + b] = byte;
        }
    }
    whiten(stream, session, seq);
    let bits = capacity.bits_per_cell;
    for (c, symbol) in symbols.iter_mut().enumerate() {
        let mut value = 0u8;
        for k in 0..bits {
            let bit = c * bits + k;
            let byte = bit >> 3;
            let b = if byte < stream.len() {
                (stream[byte] >> (7 - (bit & 7))) & 1
            } else {
                0
            };
            value = (value << 1) | b;
        }
        *symbol = value;
    }
    true
}

/// Counts over one decoded frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Decoded {
    pub blocks_ok: u32,
    /// Bytes handed to the code as erasures, over the blocks it repaired.
    pub erasures: u32,
    /// Bytes the code repaired, over the blocks it repaired.
    pub corrected: u32,
    /// Blocks whose first repair the code accepted but whose tag did not
    /// match: without the tag, they would have been passed on wrong.
    pub refused: u32,
}

/// Scratch the decoder reuses from frame to frame.
#[derive(Default)]
pub struct DecodeScratch {
    stream: Vec<u8>,
    sure: Vec<u8>,
    unsure: Vec<(u8, usize)>,
    marked: Vec<usize>,
}

/// Decodes every block of a frame from its sampled cells. `threshold` is the
/// confidence under which a cell's bytes count as erasures; `None` decodes
/// hard. Writes a flag per block into `ok` and each repaired block's data
/// into `out` (`blocks * packet_bytes`); a failed block's data is zero. A
/// repair counts only when the block's tag matches its data, `session`, `seq`
/// and index; otherwise the next, smaller set of erasures is tried.
#[allow(clippy::too_many_arguments)]
pub fn decode(
    capacity: &Capacity,
    symbols: &[u8],
    confidence: &[u8],
    session: u32,
    seq: u32,
    threshold: Option<f64>,
    ok: &mut [u8],
    out: &mut [u8],
    scratch: &mut DecodeScratch,
) -> Decoded {
    let bits = capacity.bits_per_cell;
    let DecodeScratch {
        stream,
        sure,
        unsure,
        marked,
    } = scratch;
    stream.clear();
    stream.resize(capacity.stream_bytes, 0);
    sure.clear();
    sure.resize(capacity.stream_bytes, 255);
    for byte in 0..capacity.stream_bytes {
        let mut value = 0u8;
        for k in 0..8 {
            let bit = byte * 8 + k;
            let cell = bit / bits;
            value = (value << 1) | ((symbols[cell] >> (bits - 1 - bit % bits)) & 1);
        }
        stream[byte] = value;
        let first = byte * 8 / bits;
        let last = (byte * 8 + 7) / bits;
        for &c in &confidence[first..=last] {
            sure[byte] = sure[byte].min(c);
        }
    }
    whiten(stream, session, seq);
    let mut decoded = Decoded::default();
    let parity = capacity.parity;
    let n = capacity.block_bytes;
    let mut word = [0u8; 255];
    let mut received = [0u8; 255];
    for b in 0..capacity.blocks {
        unsure.clear();
        for i in 0..n {
            received[i] = stream[i * capacity.blocks + b];
            let c = sure[i * capacity.blocks + b];
            if threshold.is_some_and(|t| (c as f64) < t) {
                unsure.push((c, i));
            }
        }
        // Spend at most all the check bytes on erasures, the least sure first; if that fails,
        // half, then none.
        unsure.sort_unstable();
        let mut syndromes = [0u8; 255];
        let checked = parity > 0 && rs::syndromes(&received[..n], parity, &mut syndromes);
        let mut result = None;
        let mut used = 0;
        let mut first_repair = true;
        let mut tried = None;
        for limit in [parity, parity >> 1, 0] {
            let erasures = limit.min(unsure.len());
            if tried == Some(erasures) {
                // The same erasures again would give the same answer.
                continue;
            }
            tried = Some(erasures);
            marked.clear();
            marked.extend(unsure.iter().take(limit).map(|&(_, at)| at));
            word[..n].copy_from_slice(&received[..n]);
            result = if checked {
                rs::decode_from_syndromes(&mut word[..n], parity, marked, &syndromes[..parity])
            } else {
                rs::decode(&mut word[..n], parity, marked)
            };
            if result.is_some() {
                if tag_matches(&word[..n], capacity.packet_bytes, session, seq, b as u32) {
                    used = marked.len();
                    break;
                }
                // With as many erasures as check bytes the code always finds a codeword, so
                // only the tag tells a wrong repair from a right one.
                if first_repair {
                    decoded.refused += 1;
                }
                first_repair = false;
                result = None;
            }
            if marked.is_empty() {
                break;
            }
        }
        let target = &mut out[b * capacity.packet_bytes..(b + 1) * capacity.packet_bytes];
        match result {
            Some(corrected) => {
                ok[b] = 1;
                target.copy_from_slice(&word[..capacity.packet_bytes]);
                decoded.blocks_ok += 1;
                decoded.erasures += used as u32;
                decoded.corrected += corrected as u32;
            }
            None => {
                ok[b] = 0;
                target.fill(0);
            }
        }
    }
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_matches_the_profiles() {
        // P3 "Fast": 8 colours, 120 x 67 cells, 96 + 64 bytes per block.
        let c = Capacity::new(3, 120, 67, 96, 64).unwrap();
        assert_eq!(c.data_cells, 120 * 49);
        assert_eq!(c.stream_bytes, 120 * 49 * 3 / 8);
        assert_eq!(c.blocks, c.stream_bytes / 160);
        assert_eq!(c.block_bytes, 96 + TAG_BYTES + 64);
        assert!(Capacity::new(3, 120, 67, 200, 60).is_none());
        assert!(Capacity::new(3, 120, 67, 191, 60).is_some());
        assert!(Capacity::new(3, 120, 67, 192, 60).is_none());
        assert!(Capacity::new(3, 120, 67, 0, 60).is_none());
    }

    #[test]
    fn mulberry32_matches_the_typescript_generator() {
        // createRng(1).nextUint32() in src/packages/optical-modem/lib/prng.ts.
        let mut rng = Mulberry32::new(1);
        assert_eq!(rng.next_u32(), 2_693_262_067);
    }

    #[test]
    fn decodes_what_it_encodes() {
        let c = Capacity::new(2, 104, 58, 80, 80).unwrap();
        let payload: Vec<u8> = (0..c.payload_bytes()).map(|i| (i * 31 + 7) as u8).collect();
        let mut symbols = alloc::vec![0u8; c.data_cells];
        let (mut stream, mut message) = (Vec::new(), Vec::new());
        assert!(encode(
            &c,
            &payload,
            7,
            9,
            &mut symbols,
            &mut stream,
            &mut message
        ));
        let mut confidence = alloc::vec![200u8; c.data_cells];
        // Damage a few cells and say so.
        for cell in (0..c.data_cells).step_by(97) {
            symbols[cell] ^= 1;
            confidence[cell] = 3;
        }
        let mut ok = alloc::vec![0u8; c.blocks];
        let mut out = alloc::vec![0u8; c.payload_bytes()];
        let got = decode(
            &c,
            &symbols,
            &confidence,
            7,
            9,
            Some(32.0),
            &mut ok,
            &mut out,
            &mut DecodeScratch::default(),
        );
        assert_eq!(got.blocks_ok as usize, c.blocks);
        assert!(got.erasures > 0);
        assert_eq!(got.refused, 0);
        assert_eq!(out, payload);
    }

    /// Encodes one frame of the Steady shape; its capacity, payload and symbols.
    fn steady_frame(session: u32, seq: u32) -> (Capacity, Vec<u8>, Vec<u8>) {
        let c = Capacity::new(2, 104, 58, 80, 80).unwrap();
        let payload: Vec<u8> = (0..c.payload_bytes()).map(|i| (i * 13 + 1) as u8).collect();
        let mut symbols = alloc::vec![0u8; c.data_cells];
        let (mut stream, mut message) = (Vec::new(), Vec::new());
        assert!(encode(
            &c,
            &payload,
            session,
            seq,
            &mut symbols,
            &mut stream,
            &mut message
        ));
        (c, payload, symbols)
    }

    fn decode_frame(
        c: &Capacity,
        symbols: &[u8],
        confidence: &[u8],
        session: u32,
        seq: u32,
    ) -> (Decoded, Vec<u8>, Vec<u8>) {
        let mut ok = alloc::vec![0u8; c.blocks];
        let mut out = alloc::vec![0u8; c.payload_bytes()];
        let got = decode(
            c,
            symbols,
            confidence,
            session,
            seq,
            Some(32.0),
            &mut ok,
            &mut out,
            &mut DecodeScratch::default(),
        );
        (got, ok, out)
    }

    #[test]
    fn refuses_a_block_the_code_repairs_wrongly() {
        let (c, _, mut symbols) = steady_frame(7, 9);
        // Every byte is unsure, so the first attempt erases as many bytes as there are check
        // bytes and always finds a codeword, and far more bytes are wrong than the code can repair.
        let confidence = alloc::vec![3u8; c.data_cells];
        for cell in (0..c.data_cells).step_by(5) {
            symbols[cell] ^= 1;
        }
        let (got, ok, _) = decode_frame(&c, &symbols, &confidence, 7, 9);
        assert_eq!(got.refused as usize, c.blocks);
        assert_eq!(got.blocks_ok, 0);
        assert!(ok.iter().all(|&f| f == 0));
    }

    #[test]
    fn refuses_a_frame_read_under_the_wrong_identity() {
        let (c, payload, symbols) = steady_frame(7, 9);
        let confidence = alloc::vec![200u8; c.data_cells];
        // Another session and sequence that whiten exactly the same way, so every block is a
        // valid codeword and only the identity in the tag tells them apart.
        let seed = |session: u32, seq: u32| session ^ seq.wrapping_add(1).wrapping_mul(0x9e37_79b1);
        let other_seq: u32 = 10;
        let other_session = seed(7, 9) ^ other_seq.wrapping_add(1).wrapping_mul(0x9e37_79b1);
        assert_eq!(seed(other_session, other_seq), seed(7, 9));
        let (got, ok, _) = decode_frame(&c, &symbols, &confidence, other_session, other_seq);
        assert_eq!(got.blocks_ok, 0);
        assert_eq!(got.refused as usize, c.blocks);
        assert!(ok.iter().all(|&f| f == 0));
        let (got, _, out) = decode_frame(&c, &symbols, &confidence, 7, 9);
        assert_eq!(got.blocks_ok as usize, c.blocks);
        assert_eq!(out, payload);
    }

    #[test]
    fn a_block_tag_binds_session_sequence_and_index() {
        let data = [1u8, 2, 3, 4, 5];
        let mut word = [0u8; 9];
        word[..5].copy_from_slice(&data);
        word[5..].copy_from_slice(&block_tag(7, 9, 3, &data).to_be_bytes());
        assert!(tag_matches(&word, 5, 7, 9, 3));
        assert!(!tag_matches(&word, 5, 7, 9, 4));
        assert!(!tag_matches(&word, 5, 7, 10, 3));
        assert!(!tag_matches(&word, 5, 8, 9, 3));
        word[0] ^= 1;
        assert!(!tag_matches(&word, 5, 7, 9, 3));
    }
}
