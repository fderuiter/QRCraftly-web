/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

//! Fuzz-style tests with seeded random and mutated inputs (#1611): BC-UR text
//! comes from a camera, so no frame may panic, a rejected frame may not change
//! what the decoder has, and what completes must be what was sent.

use fountain_bcur::bcur_decoder::{
    decode_ur_part, parse_ur, BcUrDecoder, BcUrIngestStatus, MAX_RECEIVE_MESSAGE_BYTES,
};
use fountain_bcur::bytewords::WORDS;
use fountain_bcur::cbor::{cbor_decode, cbor_encode, CborValue};
use fountain_bcur::xoshiro::FragmentChooser;
use qrcraftly_core::crc32;

/// xorshift32, the same seeded generator the qr-decode fuzz tests use.
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }

    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }

    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.below(256) as u8).collect()
    }

    fn bytes_upto(&mut self, max: u32) -> Vec<u8> {
        let len = self.below(max) as usize;
        self.bytes(len)
    }
}

/// Minimal bytewords (first and last letter of each word) with the CRC-32 suffix.
fn bytewords(body: &[u8]) -> String {
    let mut all = body.to_vec();
    all.extend_from_slice(&crc32::checksum(body).to_be_bytes());
    all.iter()
        .map(|&b| {
            let w = WORDS[b as usize].as_bytes();
            format!("{}{}", w[0] as char, w[3] as char)
        })
        .collect()
}

fn part_cbor(seq_num: u64, seq_len: u64, message_len: u64, checksum: u64, data: &[u8]) -> Vec<u8> {
    cbor_encode(&CborValue::Array(vec![
        CborValue::Uint(seq_num),
        CborValue::Uint(seq_len),
        CborValue::Uint(message_len),
        CborValue::Uint(checksum),
        CborValue::Bytes(data.to_vec()),
    ]))
}

/// A multipart frame whose path sequence matches its CBOR body.
fn frame(seq_num: u64, seq_len: u64, message_len: u64, checksum: u64, data: &[u8]) -> String {
    format!(
        "ur:bytes/{seq_num}-{seq_len}/{}",
        bytewords(&part_cbor(seq_num, seq_len, message_len, checksum, data))
    )
}

/// A fountain encoding of one message, built the way the sender builds it.
struct Message {
    bytes: Vec<u8>,
    fragment_len: usize,
    fragments: Vec<Vec<u8>>,
    checksum: u32,
    chooser: FragmentChooser,
}

impl Message {
    /// Splits like the sender: the fewest fragments of at most `max_fragment_len`, all equal.
    fn new(bytes: Vec<u8>, max_fragment_len: usize) -> Self {
        let fragment_len = bytes.len().div_ceil(bytes.len().div_ceil(max_fragment_len));
        let mut fragments: Vec<Vec<u8>> = bytes.chunks(fragment_len).map(<[u8]>::to_vec).collect();
        if let Some(last) = fragments.last_mut() {
            last.resize(fragment_len, 0);
        }
        let checksum = crc32::checksum(&bytes);
        let chooser = FragmentChooser::new(fragments.len());
        Self {
            bytes,
            fragment_len,
            fragments,
            checksum,
            chooser,
        }
    }

    fn seq_len(&self) -> usize {
        self.fragments.len()
    }

    /// Part `seq_num`: a plain fragment up to seq_len, an XOR of chosen fragments after it.
    fn part(&self, seq_num: usize) -> String {
        let mut data = vec![0u8; self.fragment_len];
        for index in self.chooser.indexes_for(seq_num, self.checksum) {
            for (d, s) in data.iter_mut().zip(&self.fragments[index]) {
                *d ^= s;
            }
        }
        frame(
            seq_num as u64,
            self.seq_len() as u64,
            self.bytes.len() as u64,
            u64::from(self.checksum),
            &data,
        )
    }
}

/// Everything a frame could change in the decoder.
#[derive(Debug, PartialEq)]
struct Snapshot {
    ur_type: String,
    seq_len: usize,
    message_len: usize,
    checksum: u32,
    fragment_length: usize,
    simple: Vec<(usize, Vec<u8>)>,
    done: bool,
}

fn snapshot(d: &BcUrDecoder) -> Snapshot {
    Snapshot {
        ur_type: d.ur_type.clone(),
        seq_len: d.seq_len,
        message_len: d.message_len,
        checksum: d.checksum,
        fragment_length: d.fragment_length,
        simple: d.simple.iter().map(|(&k, v)| (k, v.clone())).collect(),
        done: d.done.is_some(),
    }
}

/// Ingests `text` and checks the invariant every frame must keep.
fn ingest(decoder: &mut BcUrDecoder, text: &str) -> BcUrIngestStatus {
    let before = snapshot(decoder);
    let status = decoder.ingest_str(text);
    match &status {
        BcUrIngestStatus::Rejected => assert_eq!(
            snapshot(decoder),
            before,
            "a rejected frame changed the decoder: {text}"
        ),
        BcUrIngestStatus::Progress { received, total } => {
            assert!(received <= total);
            assert_eq!(*total, decoder.seq_len);
        }
        BcUrIngestStatus::Complete(_) | BcUrIngestStatus::Failed(_) => {}
    }
    status
}

/// Mutates `text` in place: changed, inserted or deleted characters, or a truncation.
fn mutate(rng: &mut Rng, text: &str) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzUR:/-0123456789 \xc3";
    for _ in 0..1 + rng.below(4) {
        if chars.is_empty() {
            break;
        }
        let at = rng.below(chars.len() as u32) as usize;
        let c = ALPHABET[rng.below(ALPHABET.len() as u32) as usize] as char;
        match rng.below(4) {
            0 => chars[at] = c,
            1 => chars.insert(at, c),
            2 => {
                chars.remove(at);
            }
            _ => chars.truncate(at),
        }
    }
    chars.into_iter().collect()
}

#[test]
fn seeded_random_and_mutated_frames_never_panic() {
    let mut rng = Rng(0x1611);
    let mut inputs = 0usize;
    for round in 0..400u32 {
        let len = 1 + rng.below(600) as usize;
        let message = Message::new(rng.bytes(len), 1 + rng.below(80) as usize);
        let mut decoder = BcUrDecoder::new();
        for i in 0..30u32 {
            let seq_num = 1 + rng.below(message.seq_len() as u32 * 3) as usize;
            let valid = message.part(seq_num);
            let text = match (round + i) % 6 {
                0 => valid,
                1 | 2 => mutate(&mut rng, &valid),
                // Random CBOR bodies behind a valid bytewords checksum reach the CBOR reader.
                3 => format!(
                    "ur:bytes/{seq_num}-{}/{}",
                    message.seq_len(),
                    bytewords(&rng.bytes_upto(40))
                ),
                4 => {
                    let mut body = part_cbor(
                        seq_num as u64,
                        message.seq_len() as u64,
                        len as u64,
                        u64::from(message.checksum),
                        &rng.bytes(message.fragment_len),
                    );
                    let at = rng.below(body.len() as u32) as usize;
                    body[at] = rng.below(256) as u8;
                    body.truncate(body.len() - rng.below(3) as usize);
                    format!(
                        "ur:bytes/{seq_num}-{}/{}",
                        message.seq_len(),
                        bytewords(&body)
                    )
                }
                _ => String::from_utf8_lossy(&rng.bytes_upto(64)).into_owned(),
            };
            let _ = parse_ur(&text);
            if let Some(parsed) = parse_ur(&text) {
                let _ = decode_ur_part(&parsed.body);
            }
            if let BcUrIngestStatus::Complete(result) = ingest(&mut decoder, &text) {
                // A completed multipart transfer always carries a message that passed its checksum.
                if decoder.seq_len > 0 {
                    assert_eq!(crc32::checksum(&result.cbor), decoder.checksum);
                }
            }
            inputs += 1;
        }
    }
    assert!(inputs >= 10_000, "only {inputs} inputs");
}

#[test]
fn random_cbor_never_panics() {
    let mut rng = Rng(9);
    for _ in 0..10_000 {
        let _ = cbor_decode(&rng.bytes_upto(48));
    }
    // Lengths from the wire that would overflow or size a huge Vec are refused, not trusted.
    assert_eq!(
        cbor_decode(&[0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        None
    );
    assert_eq!(
        cbor_decode(&[0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        None
    );
    assert_eq!(cbor_decode(&[0x9a, 0x00, 0x01, 0x00, 0x00, 0x00]), None);
}

#[test]
fn shuffled_streams_with_losses_decode_to_the_message() {
    let mut rng = Rng(3);
    for round in 0..200u32 {
        let len = 1 + rng.below(2_000) as usize;
        let message = Message::new(rng.bytes(len), 1 + rng.below(120) as usize);
        let mut decoder = BcUrDecoder::new();
        // Odd rounds send only fountain parts, so every fragment is solved from XORs.
        let mut seq_num = if round % 2 == 1 {
            message.seq_len() + 1
        } else {
            1
        };
        let result = loop {
            assert!(
                seq_num < message.seq_len() * 20 + 100,
                "round {round} never completed"
            );
            if rng.below(4) != 0 {
                if let BcUrIngestStatus::Complete(result) =
                    ingest(&mut decoder, &message.part(seq_num))
                {
                    break result;
                }
            }
            seq_num += 1;
        };
        assert_eq!(result.cbor, message.bytes, "round {round}");
    }
}

#[test]
fn a_part_numbered_past_seq_len_is_a_fountain_part() {
    // BC-UR keeps counting after seq_len: those parts are XORs of chosen fragments, so a
    // seq_num above seq_len is valid and must be absorbed, not rejected.
    let message = Message::new((0..40u8).collect(), 10);
    let mut decoder = BcUrDecoder::new();
    for seq_num in 1..message.seq_len() {
        assert!(matches!(
            ingest(&mut decoder, &message.part(seq_num)),
            BcUrIngestStatus::Progress { .. }
        ));
    }
    let mut seq_num = message.seq_len() + 1;
    loop {
        match ingest(&mut decoder, &message.part(seq_num)) {
            BcUrIngestStatus::Complete(result) => {
                assert_eq!(result.cbor, message.bytes);
                break;
            }
            BcUrIngestStatus::Progress { total, .. } => assert_eq!(total, message.seq_len()),
            other => panic!("part {seq_num}: {other:?}"),
        }
        seq_num += 1;
        assert!(seq_num < 200);
    }
    // seq_num is a 32-bit field: one that does not fit is malformed.
    let fresh = BcUrDecoder::new();
    let mut decoder = BcUrDecoder::new();
    let text = frame(1 << 32, 4, 40, u64::from(message.checksum), &[0; 10]);
    assert!(matches!(
        ingest(&mut decoder, &text),
        BcUrIngestStatus::Rejected
    ));
    assert_eq!(snapshot(&decoder), snapshot(&fresh));
}

/// Starts a decoder with the first two parts of `message`.
fn started(message: &Message) -> BcUrDecoder {
    let mut decoder = BcUrDecoder::new();
    for seq_num in 1..=2 {
        assert!(matches!(
            ingest(&mut decoder, &message.part(seq_num)),
            BcUrIngestStatus::Progress { .. }
        ));
    }
    decoder
}

fn assert_rejected(decoder: &mut BcUrDecoder, text: &str) {
    let before = snapshot(decoder);
    assert!(
        matches!(ingest(decoder, text), BcUrIngestStatus::Rejected),
        "{text}"
    );
    assert_eq!(snapshot(decoder), before);
}

#[test]
fn a_zero_seq_len_is_rejected() {
    let message = Message::new((0..40u8).collect(), 10);
    let checksum = u64::from(message.checksum);
    for decoder in [&mut BcUrDecoder::new(), &mut started(&message)] {
        assert_rejected(decoder, &frame(1, 0, 40, checksum, &[0; 10]));
        // The path says 0 but the body says 4: the two must agree.
        let body = bytewords(&part_cbor(3, 4, 40, checksum, &message.fragments[2]));
        assert_rejected(decoder, &format!("ur:bytes/3-0/{body}"));
        assert_rejected(decoder, &format!("ur:bytes/0-4/{body}"));
    }
}

#[test]
fn a_message_over_the_receive_limit_fails_without_starting() {
    let mut decoder = BcUrDecoder::new();
    let fresh = snapshot(&decoder);
    let big = MAX_RECEIVE_MESSAGE_BYTES as u64 + 1;
    let fragment = vec![0u8; 200];
    let seq_len = big.div_ceil(fragment.len() as u64);
    let status = ingest(&mut decoder, &frame(1, seq_len, big, 7, &fragment));
    assert!(
        matches!(status, BcUrIngestStatus::Failed(ref reason) if reason == "too-large"),
        "{status:?}"
    );
    assert_eq!(snapshot(&decoder), fresh);

    // Once a transfer has started, a part claiming another size is a different message.
    let message = Message::new((0..40u8).collect(), 10);
    let mut decoder = started(&message);
    assert_rejected(
        &mut decoder,
        &frame(3, seq_len, big, u64::from(message.checksum), &fragment),
    );
    // So is a message_len that does not fit usize on wasm32.
    assert_rejected(
        &mut decoder,
        &frame(
            3,
            4,
            (1 << 32) + 40,
            u64::from(message.checksum),
            &message.fragments[2],
        ),
    );
}

#[test]
fn a_fragment_whose_length_does_not_match_the_message_is_rejected() {
    let message = Message::new((0..40u8).collect(), 10);
    let checksum = u64::from(message.checksum);

    // First part: 40 bytes in 4 parts means 10-byte fragments.
    let mut decoder = BcUrDecoder::new();
    for len in [1, 9, 11, 13, 40] {
        assert_rejected(&mut decoder, &frame(1, 4, 40, checksum, &vec![0; len]));
    }
    assert_rejected(&mut decoder, &frame(1, 4, 40, checksum, &[]));

    // Later parts must have the fragment length the transfer started with.
    let mut decoder = started(&message);
    for len in [1, 9, 11, 20] {
        assert_rejected(&mut decoder, &frame(3, 4, 40, checksum, &vec![0; len]));
        assert_rejected(&mut decoder, &frame(7, 4, 40, checksum, &vec![0; len]));
    }
    // And the same checksum, and a checksum that fits 32 bits.
    assert_rejected(
        &mut decoder,
        &frame(3, 4, 40, checksum ^ 1, &message.fragments[2]),
    );
    assert_rejected(
        &mut decoder,
        &frame(3, 4, 40, checksum | 1 << 32, &message.fragments[2]),
    );

    // The good parts still complete the transfer.
    for seq_num in 3..=4 {
        let _ = ingest(&mut decoder, &message.part(seq_num));
    }
    assert!(
        matches!(decoder.ingest_str(&message.part(1)), BcUrIngestStatus::Complete(ref r) if r.cbor == message.bytes)
    );
}

#[test]
fn a_frame_of_another_type_is_rejected_mid_transfer() {
    let message = Message::new((0..40u8).collect(), 10);
    let mut decoder = started(&message);
    let other = message.part(3).replacen("ur:bytes/", "ur:crypto-psbt/", 1);
    assert_rejected(&mut decoder, &other);
    assert_rejected(&mut decoder, "ur:bytes/3-4/");
    assert_rejected(&mut decoder, "ur:bytes/3-4-5/abcd");
    assert_rejected(&mut decoder, "ur:bytes/x-4/abcdabcdabcd");
    assert_rejected(
        &mut decoder,
        "ur:bytes/99999999999999999999999-4/abcdabcdabcd",
    );
}
