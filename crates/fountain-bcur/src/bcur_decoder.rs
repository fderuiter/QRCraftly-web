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

use crate::bytewords::decode_bytewords_minimal;
use crate::cbor::{cbor_decode, CborValue};
use crate::xoshiro::FragmentChooser;
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::String;
use alloc::vec::Vec;
use qrcraftly_core::crc32;

pub const MAX_BCUR_FRAGMENTS: usize = 1 << 16;
pub const MAX_RECEIVE_MESSAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_PENDING_PARTS: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BcUrContentKind {
    File = 0,
    Text = 1,
    Cbor = 2,
}

#[derive(Debug, Clone)]
pub struct BcUrResult {
    pub ur_type: String,
    pub cbor: Vec<u8>,
    pub content_kind: BcUrContentKind,
}

#[derive(Debug, Clone)]
pub enum BcUrIngestStatus {
    Rejected,
    Progress { received: usize, total: usize },
    Complete(BcUrResult),
    Failed(String),
}

struct PendingEq {
    indexes: BTreeSet<usize>,
    data: Vec<u8>,
}

pub struct BcUrDecoder {
    pub ur_type: String,
    pub seq_len: usize,
    pub message_len: usize,
    pub checksum: u32,
    pub fragment_length: usize,
    pub chooser: Option<FragmentChooser>,
    pub simple: BTreeMap<usize, Vec<u8>>,
    pending: Vec<PendingEq>,
    ripple_queue: Vec<(usize, Vec<u8>)>,
    pub done: Option<BcUrResult>,
}

impl Default for BcUrDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl BcUrDecoder {
    pub fn new() -> Self {
        Self {
            ur_type: String::new(),
            seq_len: 0,
            message_len: 0,
            checksum: 0,
            fragment_length: 0,
            chooser: None,
            simple: BTreeMap::new(),
            pending: Vec::new(),
            ripple_queue: Vec::new(),
            done: None,
        }
    }

    pub fn reset(&mut self) {
        self.ur_type.clear();
        self.seq_len = 0;
        self.message_len = 0;
        self.checksum = 0;
        self.fragment_length = 0;
        self.chooser = None;
        self.simple.clear();
        self.pending.clear();
        self.ripple_queue.clear();
        self.done = None;
    }

    pub fn progress(&self) -> f64 {
        if self.done.is_some() {
            1.0
        } else if self.seq_len == 0 {
            0.0
        } else {
            (self.simple.len() as f64) / (self.seq_len as f64)
        }
    }

    pub fn ingest_str(&mut self, text: &str) -> BcUrIngestStatus {
        if let Some(ref res) = self.done {
            return BcUrIngestStatus::Complete(res.clone());
        }

        let parsed = match parse_ur(text) {
            Some(p) => p,
            None => return BcUrIngestStatus::Rejected,
        };

        if !self.ur_type.is_empty() && parsed.ur_type != self.ur_type {
            return BcUrIngestStatus::Rejected;
        }

        if parsed.seq.is_none() {
            let cbor = match decode_bytewords_minimal(parsed.body.as_bytes()) {
                Some(bytes) if !bytes.is_empty() => bytes,
                _ => return BcUrIngestStatus::Rejected,
            };
            if cbor.len() > MAX_RECEIVE_MESSAGE_BYTES {
                return BcUrIngestStatus::Rejected;
            }
            self.ur_type = parsed.ur_type;
            return self.finish(cbor, None);
        }

        let seq = parsed.seq.unwrap();
        let part = match decode_ur_part(&parsed.body) {
            Some(p) => p,
            None => return BcUrIngestStatus::Rejected,
        };

        if part.seq_num != seq.seq_num || part.seq_len != seq.seq_len {
            return BcUrIngestStatus::Rejected;
        }

        if self.chooser.is_none() && (part.seq_len > MAX_BCUR_FRAGMENTS || part.message_len > MAX_RECEIVE_MESSAGE_BYTES) {
            return BcUrIngestStatus::Rejected;
        }

        if !self.accepts(&part) {
            return BcUrIngestStatus::Rejected;
        }

        if self.chooser.is_none() {
            self.begin(&parsed.ur_type, &part);
        }

        let chooser = self.chooser.as_ref().unwrap();
        let indexes = chooser.indexes_for(part.seq_num, part.checksum);
        self.absorb(indexes, part.data);

        if self.simple.len() == self.seq_len {
            let mut message = alloc::vec![0u8; self.seq_len * self.fragment_length];
            for (&idx, frag) in &self.simple {
                let start = idx * self.fragment_length;
                let end = (start + frag.len()).min(message.len());
                message[start..end].copy_from_slice(&frag[..end - start]);
            }
            let truncated = message[..self.message_len.min(message.len())].to_vec();
            return self.finish(truncated, Some(self.checksum));
        }

        BcUrIngestStatus::Progress {
            received: self.simple.len(),
            total: self.seq_len,
        }
    }

    fn accepts(&self, part: &BcUrPart) -> bool {
        if self.chooser.is_some() {
            part.seq_len == self.seq_len
                && part.message_len == self.message_len
                && part.checksum == self.checksum
                && part.data.len() == self.fragment_length
        } else {
            let expected_len = (part.message_len + part.data.len() - 1) / part.data.len();
            part.seq_len == expected_len
        }
    }

    fn begin(&mut self, ur_type: &str, part: &BcUrPart) {
        self.ur_type = String::from(ur_type);
        self.seq_len = part.seq_len;
        self.message_len = part.message_len;
        self.checksum = part.checksum;
        self.fragment_length = part.data.len();
        self.chooser = Some(FragmentChooser::new(part.seq_len));
    }

    fn absorb(&mut self, indexes: Vec<usize>, data: Vec<u8>) {
        let mut queue = alloc::vec![PendingEq {
            indexes: indexes.into_iter().collect(),
            data,
        }];

        while !queue.is_empty() {
            let part = queue.remove(0);
            let reduced = self.reduce(part);
            if reduced.indexes.is_empty() {
                continue;
            }
            if reduced.indexes.len() == 1 {
                let index = *reduced.indexes.iter().next().unwrap();
                self.ripple_queue.push((index, reduced.data));
                self.process_ripple();
            } else if self.pending.len() < MAX_PENDING_PARTS && !self.is_duplicate(&reduced) {
                let mut matches = Vec::new();
                for other in &self.pending {
                    if reduced.indexes.is_subset(&other.indexes) && reduced.indexes.len() < other.indexes.len() {
                        matches.push(other.indexes.clone());
                    }
                }
                for other_indexes in matches {
                    if let Some(pos) = self.pending.iter().position(|e| e.indexes == other_indexes) {
                        let other = self.pending.remove(pos);
                        let mut new_data = other.data;
                        xor_into(&mut new_data, &reduced.data);
                        let new_indexes: BTreeSet<usize> = other.indexes.difference(&reduced.indexes).copied().collect();
                        queue.push(PendingEq {
                            indexes: new_indexes,
                            data: new_data,
                        });
                    }
                }
                self.pending.push(reduced);
            }
        }
        self.process_ripple();
    }

    fn is_duplicate(&self, eq: &PendingEq) -> bool {
        self.pending.iter().any(|e| e.indexes == eq.indexes)
    }

    fn reduce(&self, mut part: PendingEq) -> PendingEq {
        let mut indexes = BTreeSet::new();
        for &idx in &part.indexes {
            if let Some(known) = self.simple.get(&idx) {
                xor_into(&mut part.data, known);
            } else {
                indexes.insert(idx);
            }
        }
        part.indexes = indexes;

        let mut changed = true;
        while changed && part.indexes.len() > 1 {
            changed = false;
            for other in &self.pending {
                if other.indexes.is_subset(&part.indexes) && other.indexes.len() < part.indexes.len() {
                    xor_into(&mut part.data, &other.data);
                    for idx in &other.indexes {
                        part.indexes.remove(idx);
                    }
                    changed = true;
                    break;
                }
            }
        }

        part
    }

    fn process_ripple(&mut self) {
        while !self.ripple_queue.is_empty() {
            let (index, data) = self.ripple_queue.remove(0);
            if self.simple.contains_key(&index) {
                continue;
            }
            self.simple.insert(index, data.clone());

            let mut remaining_pending = Vec::new();
            let old_pending = core::mem::take(&mut self.pending);

            for mut eq in old_pending {
                if eq.indexes.contains(&index) {
                    xor_into(&mut eq.data, &data);
                    eq.indexes.remove(&index);
                    if eq.indexes.len() == 1 {
                        let rem = *eq.indexes.iter().next().unwrap();
                        self.ripple_queue.push((rem, eq.data));
                    } else if eq.indexes.len() > 1 {
                        remaining_pending.push(eq);
                    }
                } else {
                    remaining_pending.push(eq);
                }
            }
            self.pending = remaining_pending;
        }
    }

    fn finish(&mut self, cbor: Vec<u8>, expected_checksum: Option<u32>) -> BcUrIngestStatus {
        if let Some(chk) = expected_checksum {
            if crc32::checksum(&cbor) != chk {
                self.reset();
                return BcUrIngestStatus::Failed(String::from("checksum mismatch"));
            }
        }

        let kind = classify(&self.ur_type, &cbor);
        let res = BcUrResult {
            ur_type: self.ur_type.clone(),
            cbor: cbor.clone(),
            content_kind: kind,
        };
        self.done = Some(res.clone());
        self.pending.clear();
        self.ripple_queue.clear();
        BcUrIngestStatus::Complete(res)
    }
}

fn xor_into(target: &mut [u8], source: &[u8]) {
    for (t, &s) in target.iter_mut().zip(source.iter()) {
        *t ^= s;
    }
}

pub struct ParsedUr {
    pub ur_type: String,
    pub seq: Option<ParsedSeq>,
    pub body: String,
}

pub struct ParsedSeq {
    pub seq_num: usize,
    pub seq_len: usize,
}

pub fn parse_ur(text: &str) -> Option<ParsedUr> {
    let lower = text.trim().to_ascii_lowercase();
    if !lower.starts_with("ur:") {
        return None;
    }
    let rest = &lower[3..];
    let segments: Vec<&str> = rest.split('/').collect();
    if segments.len() < 2 || segments.len() > 3 {
        return None;
    }

    let ur_type = segments[0];
    let body = segments[segments.len() - 1];

    if !is_type_valid(ur_type) || !is_body_valid(body) {
        return None;
    }

    if segments.len() == 2 {
        Some(ParsedUr {
            ur_type: String::from(ur_type),
            seq: None,
            body: String::from(body),
        })
    } else {
        let seq_str = segments[1];
        let seq_parts: Vec<&str> = seq_str.split('-').collect();
        if seq_parts.len() != 2 {
            return None;
        }
        let seq_num: usize = seq_parts[0].parse().ok()?;
        let seq_len: usize = seq_parts[1].parse().ok()?;
        Some(ParsedUr {
            ur_type: String::from(ur_type),
            seq: Some(ParsedSeq { seq_num, seq_len }),
            body: String::from(body),
        })
    }
}

fn is_type_valid(type_str: &str) -> bool {
    !type_str.is_empty() && type_str.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_body_valid(body_str: &str) -> bool {
    !body_str.is_empty() && body_str.chars().all(|c| c.is_ascii_lowercase())
}

pub struct BcUrPart {
    pub seq_num: usize,
    pub seq_len: usize,
    pub message_len: usize,
    pub checksum: u32,
    pub data: Vec<u8>,
}

pub fn decode_ur_part(body: &str) -> Option<BcUrPart> {
    let bytes = decode_bytewords_minimal(body.as_bytes())?;
    let val = cbor_decode(&bytes)?;

    if let CborValue::Array(items) = val {
        if items.len() != 5 {
            return None;
        }
        let seq_num = match items[0] {
            CborValue::Uint(u) => u as usize,
            _ => return None,
        };
        let seq_len = match items[1] {
            CborValue::Uint(u) => u as usize,
            _ => return None,
        };
        let message_len = match items[2] {
            CborValue::Uint(u) => u as usize,
            _ => return None,
        };
        let checksum = match items[3] {
            CborValue::Uint(u) => u as u32,
            _ => return None,
        };
        let data = match &items[4] {
            CborValue::Bytes(b) => b.clone(),
            _ => return None,
        };

        if data.is_empty() || seq_num < 1 || seq_len < 1 || message_len < 1 {
            return None;
        }

        Some(BcUrPart {
            seq_num,
            seq_len,
            message_len,
            checksum,
            data,
        })
    } else {
        None
    }
}

fn classify(ur_type: &str, cbor: &[u8]) -> BcUrContentKind {
    if let Some(val) = cbor_decode(cbor) {
        if ur_type == "bytes" {
            if let CborValue::Bytes(_) = val {
                return BcUrContentKind::File;
            }
        }
        if let CborValue::Text(_) = val {
            return BcUrContentKind::Text;
        }
    }
    BcUrContentKind::Cbor
}
