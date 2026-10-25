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

use alloc::vec::Vec;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CborValue {
    Uint(u64),
    Bytes(Vec<u8>),
    Text(Vec<u8>),
    Array(Vec<CborValue>),
}

pub fn cbor_encode(val: &CborValue) -> Vec<u8> {
    let mut out = Vec::new();
    encode_into(val, &mut out);
    out
}

fn encode_head(major: u8, val: u64, out: &mut Vec<u8>) {
    let m = major << 5;
    if val < 24 {
        out.push(m | (val as u8));
    } else if val <= 0xff {
        out.push(m | 24);
        out.push(val as u8);
    } else if val <= 0xffff {
        out.push(m | 25);
        out.extend_from_slice(&(val as u16).to_be_bytes());
    } else if val <= 0xffffffff {
        out.push(m | 26);
        out.extend_from_slice(&(val as u32).to_be_bytes());
    } else {
        out.push(m | 27);
        out.extend_from_slice(&val.to_be_bytes());
    }
}

fn encode_into(val: &CborValue, out: &mut Vec<u8>) {
    match val {
        CborValue::Uint(u) => encode_head(0, *u, out),
        CborValue::Bytes(b) => {
            encode_head(2, b.len() as u64, out);
            out.extend_from_slice(b);
        }
        CborValue::Text(t) => {
            encode_head(3, t.len() as u64, out);
            out.extend_from_slice(t);
        }
        CborValue::Array(items) => {
            encode_head(4, items.len() as u64, out);
            for item in items {
                encode_into(item, out);
            }
        }
    }
}

pub struct CborReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> CborReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    pub fn is_done(&self) -> bool {
        self.offset >= self.bytes.len()
    }

    fn byte(&mut self) -> Option<u8> {
        if self.offset >= self.bytes.len() {
            None
        } else {
            let b = self.bytes[self.offset];
            self.offset += 1;
            Some(b)
        }
    }

    fn read_argument(&mut self, info: u8) -> Option<u64> {
        if info < 24 {
            return Some(info as u64);
        }
        let len = match info {
            24 => 1,
            25 => 2,
            26 => 4,
            27 => 8,
            _ => return None,
        };
        let mut val = 0u64;
        for _ in 0..len {
            val = (val << 8) | (self.byte()? as u64);
        }
        Some(val)
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn take(&mut self, len: u64) -> Option<&'a [u8]> {
        // A length from the wire can be anything up to u64::MAX: compare before adding.
        let len = usize::try_from(len)
            .ok()
            .filter(|&len| len <= self.remaining())?;
        let slice = &self.bytes[self.offset..self.offset + len];
        self.offset += len;
        Some(slice)
    }

    pub fn read(&mut self, depth: usize) -> Option<CborValue> {
        if depth > 16 {
            return None;
        }
        let initial = self.byte()?;
        let major = initial >> 5;
        let arg = self.read_argument(initial & 0x1f)?;
        match major {
            0 => Some(CborValue::Uint(arg)),
            2 => {
                let slice = self.take(arg)?;
                Some(CborValue::Bytes(slice.to_vec()))
            }
            3 => {
                let slice = self.take(arg)?;
                Some(CborValue::Text(slice.to_vec()))
            }
            4 => {
                // Every item takes at least one byte, so a count beyond the bytes left is
                // malformed; checking first also keeps a huge count from sizing the Vec.
                let count = usize::try_from(arg)
                    .ok()
                    .filter(|&n| n <= self.remaining())?;
                let mut items = Vec::with_capacity(count);
                for _ in 0..count {
                    items.push(self.read(depth + 1)?);
                }
                Some(CborValue::Array(items))
            }
            _ => None,
        }
    }
}

pub fn cbor_decode(bytes: &[u8]) -> Option<CborValue> {
    let mut reader = CborReader::new(bytes);
    let val = reader.read(0)?;
    if !reader.is_done() {
        return None;
    }
    Some(val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cbor_roundtrip() {
        let val = CborValue::Array(alloc::vec![
            CborValue::Uint(1),
            CborValue::Bytes(alloc::vec![0xaa, 0xbb]),
            CborValue::Text(alloc::vec![b'a', b'b', b'c'])
        ]);
        let encoded = cbor_encode(&val);
        let decoded = cbor_decode(&encoded).expect("cbor decode");
        assert_eq!(decoded, val);
    }
}
