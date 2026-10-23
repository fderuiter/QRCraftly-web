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

//! PEM parsing and PKCS#1 to PKCS#8 conversion with memory zeroization.

use crate::der::{algorithm, integer_from_u32, octet_string, read_der_all, sequence, tag};
use crate::zeroize::ZeroizingVec;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub const RSA_ENCRYPTION_OID: &str = "1.2.840.113549.1.1.1";

pub struct PemBlock {
    pub label: String,
    pub bytes: ZeroizingVec,
}

pub fn base64_decode(text: &str) -> Result<ZeroizingVec, String> {
    let mut clean = Vec::with_capacity(text.len());
    for b in text.bytes() {
        if !b.is_ascii_whitespace() {
            clean.push(b);
        }
    }

    if clean.is_empty() {
        return Ok(ZeroizingVec::from_vec(Vec::new()));
    }

    if clean.len() % 4 == 1 {
        return Err("The file is not valid base64.".to_string());
    }

    let mut out = ZeroizingVec::with_capacity((clean.len() * 3) / 4);

    let decode_char = |c: u8| -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("The file is not valid base64.".to_string()),
        }
    };

    let mut i = 0;
    while i < clean.len() {
        if clean[i] == b'=' {
            break;
        }
        let b0 = decode_char(clean[i])?;
        let b1 = if i + 1 < clean.len() && clean[i + 1] != b'=' { decode_char(clean[i + 1])? } else { 0 };
        let b2 = if i + 2 < clean.len() && clean[i + 2] != b'=' { decode_char(clean[i + 2])? } else { 0 };
        let b3 = if i + 3 < clean.len() && clean[i + 3] != b'=' { decode_char(clean[i + 3])? } else { 0 };

        let triple = ((b0 as u32) << 18) | ((b1 as u32) << 12) | ((b2 as u32) << 6) | (b3 as u32);

        out.push((triple >> 16) as u8);
        if i + 2 < clean.len() && clean[i + 2] != b'=' {
            out.push((triple >> 8) as u8);
        }
        if i + 3 < clean.len() && clean[i + 3] != b'=' {
            out.push(triple as u8);
        }

        i += 4;
    }

    Ok(out)
}

pub fn parse_pem(text: &str) -> Result<Vec<PemBlock>, String> {
    let mut blocks = Vec::new();
    let begin_marker = "-----BEGIN ";
    let end_marker = "-----END ";

    let mut current = 0;
    while let Some(begin_pos) = text[current..].find(begin_marker) {
        let absolute_begin = current + begin_pos;
        let label_start = absolute_begin + begin_marker.len();
        let label_end = match text[label_start..].find("-----") {
            Some(pos) => label_start + pos,
            None => break,
        };
        let label = &text[label_start..label_end];

        let content_start = label_end + 5;
        let expected_end = format!("{}{}{}-----", end_marker, label, "");
        let end_pos = match text[content_start..].find(&expected_end) {
            Some(pos) => content_start + pos,
            None => break,
        };

        let base64_text = &text[content_start..end_pos];
        let bytes = base64_decode(base64_text)?;

        blocks.push(PemBlock {
            label: label.to_string(),
            bytes,
        });

        current = end_pos + expected_end.len();
    }

    Ok(blocks)
}

pub fn private_key_to_pkcs8(text: &str) -> Result<ZeroizingVec, String> {
    if text.contains("ENCRYPTED PRIVATE KEY") || text.contains("Proc-Type: 4,ENCRYPTED") {
        return Err("This private key is protected with a password. Export it without one, for example with \"openssl pkey -in key.pem -out key-plain.pem\".".to_string());
    }

    let blocks = parse_pem(text)?;
    if let Some(pkcs8) = blocks.iter().find(|b| b.label == "PRIVATE KEY") {
        return Ok(ZeroizingVec::from_vec(pkcs8.bytes.as_slice().to_vec()));
    }

    if let Some(pkcs1) = blocks.iter().find(|b| b.label == "RSA PRIVATE KEY") {
        let node = read_der_all(pkcs1.bytes.as_slice()).map_err(|_| "The RSA private key is damaged.".to_string())?;
        if node.tag != tag::SEQUENCE {
            return Err("The RSA private key is damaged.".to_string());
        }

        let alg = algorithm(RSA_ENCRYPTION_OID).map_err(|_| "Invalid OID".to_string())?;
        let ver = integer_from_u32(0);
        let oct = octet_string(pkcs1.bytes.as_slice());

        let pkcs8_bytes = sequence(&[&ver, &alg, &oct]);
        return Ok(ZeroizingVec::from_vec(pkcs8_bytes));
    }

    Err("No private key was found. Choose a PEM file that contains \"BEGIN PRIVATE KEY\".".to_string())
}

pub fn certificates_from_pem(text: &str) -> Result<Vec<ZeroizingVec>, String> {
    let blocks = parse_pem(text)?;
    Ok(blocks
        .into_iter()
        .filter(|b| b.label == "CERTIFICATE")
        .map(|b| b.bytes)
        .collect())
}

pub fn certificates_from_file(bytes: &[u8]) -> Result<Vec<ZeroizingVec>, String> {
    if let Ok(text) = core::str::from_utf8(bytes) {
        if text.contains("-----BEGIN") {
            return certificates_from_pem(text);
        }
    }
    if !bytes.is_empty() && bytes[0] == tag::SEQUENCE {
        Ok(alloc::vec![ZeroizingVec::from_vec(bytes.to_vec())])
    } else {
        Ok(Vec::new())
    }
}
