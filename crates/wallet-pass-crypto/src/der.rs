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

//! ASN.1 DER (ITU-T X.690) reader and writer in pure Rust (`no_std`).

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

pub mod tag {
    pub const BOOLEAN: u8 = 0x01;
    pub const INTEGER: u8 = 0x02;
    pub const BIT_STRING: u8 = 0x03;
    pub const OCTET_STRING: u8 = 0x04;
    pub const NULL: u8 = 0x05;
    pub const OID: u8 = 0x06;
    pub const UTF8_STRING: u8 = 0x0c;
    pub const PRINTABLE_STRING: u8 = 0x13;
    pub const IA5_STRING: u8 = 0x16;
    pub const UTC_TIME: u8 = 0x17;
    pub const GENERALIZED_TIME: u8 = 0x18;
    pub const SEQUENCE: u8 = 0x30;
    pub const SET: u8 = 0x31;
}

#[derive(Debug, PartialEq, Eq)]
pub enum DerError {
    UnexpectedEof,
    HighTagNumberNotSupported,
    IndefiniteOrOversizedLength,
    InvalidOid,
    ElementMissing(usize),
    TagMismatch { expected: u8, actual: u8 },
    InvalidTime(String),
    ExtraBytes,
}

impl From<DerError> for String {
    fn from(err: DerError) -> Self {
        match err {
            DerError::UnexpectedEof => "Unexpected end of DER data.".into(),
            DerError::HighTagNumberNotSupported => "High tag numbers are not supported.".into(),
            DerError::IndefiniteOrOversizedLength => "Indefinite or oversized lengths are not DER.".into(),
            DerError::InvalidOid => "Invalid object identifier.".into(),
            DerError::ElementMissing(idx) => format!("Element {} is missing.", idx),
            DerError::TagMismatch { expected, actual } => format!("Element tag mismatch: expected 0x{:x}, got 0x{:x}", expected, actual),
            DerError::InvalidTime(s) => format!("Unsupported time: {}", s),
            DerError::ExtraBytes => "There are extra bytes after the element.".into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DerNode {
    pub tag: u8,
    pub value: Vec<u8>,
    pub bytes: Vec<u8>,
}

pub fn read_der(data: &[u8], offset: usize) -> Result<DerNode, DerError> {
    if offset + 2 > data.len() {
        return Err(DerError::UnexpectedEof);
    }
    let tag_byte = data[offset];
    if (tag_byte & 0x1f) == 0x1f {
        return Err(DerError::HighTagNumberNotSupported);
    }
    let mut length = data[offset + 1] as usize;
    let mut start = offset + 2;

    if (length & 0x80) != 0 {
        let count = length & 0x7f;
        if count == 0 || count > 4 {
            return Err(DerError::IndefiniteOrOversizedLength);
        }
        if start + count > data.len() {
            return Err(DerError::UnexpectedEof);
        }
        length = 0;
        for i in 0..count {
            length = (length * 256) + (data[start + i] as usize);
        }
        start += count;
    }

    let end = start + length;
    if end > data.len() {
        return Err(DerError::UnexpectedEof);
    }

    Ok(DerNode {
        tag: tag_byte,
        value: data[start..end].to_vec(),
        bytes: data[offset..end].to_vec(),
    })
}

pub fn read_children(node: &DerNode) -> Result<Vec<DerNode>, DerError> {
    let mut children = Vec::new();
    let mut offset = 0;
    while offset < node.value.len() {
        let child = read_der(&node.value, offset)?;
        offset += child.bytes.len();
        children.push(child);
    }
    Ok(children)
}

pub fn read_der_all(data: &[u8]) -> Result<DerNode, DerError> {
    let node = read_der(data, 0)?;
    if node.bytes.len() != data.len() {
        return Err(DerError::ExtraBytes);
    }
    Ok(node)
}

pub fn child_at(node: &DerNode, index: usize, expected_tag: Option<u8>) -> Result<DerNode, DerError> {
    let children = read_children(node)?;
    let child = children.get(index).cloned().ok_or(DerError::ElementMissing(index))?;
    if let Some(t) = expected_tag {
        if child.tag != t {
            return Err(DerError::TagMismatch { expected: t, actual: child.tag });
        }
    }
    Ok(child)
}

pub fn read_oid(node: &DerNode) -> Result<String, DerError> {
    if node.tag != tag::OID || node.value.is_empty() {
        return Err(DerError::InvalidOid);
    }
    let mut parts = Vec::new();
    let mut value: u64 = 0;

    for &byte in &node.value {
        value = (value * 128) + ((byte & 0x7f) as u64);
        if (byte & 0x80) == 0 {
            parts.push(value);
            value = 0;
        }
    }

    if parts.is_empty() {
        return Err(DerError::InvalidOid);
    }

    let first = parts[0];
    let (head0, head1) = if first < 80 {
        (first / 40, first % 40)
    } else {
        (2, first - 80)
    };

    let mut res = format!("{}.{}", head0, head1);
    for part in &parts[1..] {
        res.push_str(&format!(".{}", part));
    }
    Ok(res)
}

pub fn read_string(node: &DerNode) -> Result<String, DerError> {
    String::from_utf8(node.value.clone()).map_err(|_| DerError::InvalidOid)
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

fn encode_length(length: usize) -> Vec<u8> {
    if length < 0x80 {
        alloc::vec![length as u8]
    } else {
        let mut bytes = Vec::new();
        let mut rest = length;
        while rest > 0 {
            bytes.push((rest & 0xff) as u8);
            rest >>= 8;
        }
        bytes.reverse();
        let mut res = alloc::vec![0x80 | (bytes.len() as u8)];
        res.extend_from_slice(&bytes);
        res
    }
}

pub fn der(tag_byte: u8, contents: &[&[u8]]) -> Vec<u8> {
    let total_len: usize = contents.iter().map(|c| c.len()).sum();
    let len_bytes = encode_length(total_len);
    let mut result = Vec::with_capacity(1 + len_bytes.len() + total_len);
    result.push(tag_byte);
    result.extend_from_slice(&len_bytes);
    for chunk in contents {
        result.extend_from_slice(chunk);
    }
    result
}

pub fn sequence(items: &[&[u8]]) -> Vec<u8> {
    der(tag::SEQUENCE, items)
}

fn compare_bytes(a: &[u8], b: &[u8]) -> core::cmp::Ordering {
    let min_len = core::cmp::min(a.len(), b.len());
    for i in 0..min_len {
        if a[i] != b[i] {
            return a[i].cmp(&b[i]);
        }
    }
    a.len().cmp(&b.len())
}

pub fn set_of(items: &[&[u8]]) -> Vec<u8> {
    let mut sorted = items.to_vec();
    sorted.sort_by(|a, b| compare_bytes(a, b));
    der(tag::SET, &sorted)
}

pub fn context_tag(n: u8, contents: &[&[u8]]) -> Vec<u8> {
    der(0xa0 | n, contents)
}

pub fn oid(dotted: &str) -> Result<Vec<u8>, DerError> {
    let mut parts = Vec::new();
    for p in dotted.split('.') {
        let val: u64 = p.parse().map_err(|_| DerError::InvalidOid)?;
        parts.push(val);
    }
    if parts.len() < 2 {
        return Err(DerError::InvalidOid);
    }

    let first = parts[0] * 40 + parts[1];
    let mut encoded = Vec::new();

    let mut encode_val = |mut val: u64| {
        let mut group = alloc::vec![(val & 0x7f) as u8];
        val >>= 7;
        while val > 0 {
            group.push(((val & 0x7f) | 0x80) as u8);
            val >>= 7;
        }
        group.reverse();
        encoded.extend_from_slice(&group);
    };

    encode_val(first);
    for &part in &parts[2..] {
        encode_val(part);
    }

    Ok(der(tag::OID, &[&encoded]))
}

pub fn integer_from_u32(value: u32) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    let mut start = 0;
    while start < 3 && bytes[start] == 0 {
        start += 1;
    }
    let slice = &bytes[start..];
    if (slice[0] & 0x80) != 0 {
        let mut padded = alloc::vec![0u8];
        padded.extend_from_slice(slice);
        der(tag::INTEGER, &[&padded])
    } else {
        der(tag::INTEGER, &[slice])
    }
}

pub fn integer_from_bytes(bytes: &[u8]) -> Vec<u8> {
    let mut start = 0;
    while start < bytes.len() - 1 && bytes[start] == 0 {
        start += 1;
    }
    let slice = &bytes[start..];
    if slice.is_empty() {
        return der(tag::INTEGER, &[&[0]]);
    }
    if (slice[0] & 0x80) != 0 {
        let mut padded = alloc::vec![0u8];
        padded.extend_from_slice(slice);
        der(tag::INTEGER, &[&padded])
    } else {
        der(tag::INTEGER, &[slice])
    }
}

pub fn octet_string(bytes: &[u8]) -> Vec<u8> {
    der(tag::OCTET_STRING, &[bytes])
}

pub fn bit_string(bytes: &[u8]) -> Vec<u8> {
    let mut payload = alloc::vec![0u8];
    payload.extend_from_slice(bytes);
    der(tag::BIT_STRING, &[&payload])
}

pub fn null_value() -> Vec<u8> {
    alloc::vec![tag::NULL, 0]
}

pub fn utf8_string(text: &str) -> Vec<u8> {
    der(tag::UTF8_STRING, &[text.as_bytes()])
}

pub fn algorithm(dotted_oid: &str) -> Result<Vec<u8>, DerError> {
    let oid_bytes = oid(dotted_oid)?;
    Ok(sequence(&[&oid_bytes, &null_value()]))
}

pub fn time_utc(year: u16, month: u8, day: u8, hour: u8, min: u8, sec: u8) -> Vec<u8> {
    let yr_str = format!("{:02}", year % 100);
    let str_val = format!("{}{:02}{:02}{:02}{:02}{:02}Z", yr_str, month, day, hour, min, sec);
    der(tag::UTC_TIME, &[str_val.as_bytes()])
}

pub fn time_generalized(year: u16, month: u8, day: u8, hour: u8, min: u8, sec: u8) -> Vec<u8> {
    let str_val = format!("{:04}{:02}{:02}{:02}{:02}{:02}Z", year, month, day, hour, min, sec);
    der(tag::GENERALIZED_TIME, &[str_val.as_bytes()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oid_encode_decode() {
        let oid_str = "1.2.840.113549.1.1.1";
        let encoded = oid(oid_str).unwrap();
        let node = read_der_all(&encoded).unwrap();
        let decoded = read_oid(&node).unwrap();
        assert_eq!(decoded, oid_str);
    }

    #[test]
    fn test_set_of_sorting() {
        let a = octet_string(b"bbb");
        let b = octet_string(b"aaa");
        let set_bytes = set_of(&[&a, &b]);
        let node = read_der_all(&set_bytes).unwrap();
        let children = read_children(&node).unwrap();
        assert_eq!(children[0].value, b"aaa");
        assert_eq!(children[1].value, b"bbb");
    }
}
