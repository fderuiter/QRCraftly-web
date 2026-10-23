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

//! Plain Rust PKZip archive parser supporting STORED (0) and DEFLATE (8) compression.

extern crate alloc;
use alloc::string::String;
use alloc::vec::Vec;
use super::inflate::decompress_deflate;

#[derive(Debug, Clone)]
pub struct ZipFileEntry {
    pub name: String,
    pub data: Vec<u8>,
}

fn u16_le(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn u32_le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub fn parse_zip(data: &[u8]) -> Option<Vec<ZipFileEntry>> {
    if data.len() < 22 {
        return None;
    }

    let mut entries = Vec::new();

    // 1. Try Central Directory parsing first
    if let Some(cd_entries) = parse_zip_central_dir(data) {
        if !cd_entries.is_empty() {
            return Some(cd_entries);
        }
    }

    // 2. Fallback: sequential local headers scan
    let mut offset = 0;
    while offset + 30 <= data.len() {
        if &data[offset..offset + 4] == b"PK\x03\x04" {
            let method = u16_le(&data[offset + 8..offset + 10]);
            let comp_size = u32_le(&data[offset + 18..offset + 22]) as usize;
            let fn_len = u16_le(&data[offset + 26..offset + 28]) as usize;
            let extra_len = u16_le(&data[offset + 28..offset + 30]) as usize;

            let name_start = offset + 30;
            if name_start + fn_len + extra_len > data.len() {
                break;
            }

            let name_bytes = &data[name_start..name_start + fn_len];
            let name = String::from_utf8_lossy(name_bytes).into_owned();

            let data_start = name_start + fn_len + extra_len;
            if data_start + comp_size > data.len() {
                break;
            }

            let comp_data = &data[data_start..data_start + comp_size];
            let file_bytes = match method {
                0 => comp_data.to_vec(),
                8 => decompress_deflate(comp_data)?,
                _ => Vec::new(),
            };

            entries.push(ZipFileEntry {
                name,
                data: file_bytes,
            });

            offset = data_start + comp_size;
        } else {
            offset += 1;
        }
    }

    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn parse_zip_central_dir(data: &[u8]) -> Option<Vec<ZipFileEntry>> {
    // Find End of Central Directory record (PK\x05\x06)
    let max_search = data.len().min(65557);
    let search_start = data.len() - max_search;
    let mut eocd_pos = None;

    for i in (search_start..=data.len() - 22).rev() {
        if &data[i..i + 4] == b"PK\x05\x06" {
            eocd_pos = Some(i);
            break;
        }
    }

    let eocd = eocd_pos?;
    let cd_count = u16_le(&data[eocd + 10..eocd + 12]) as usize;
    let cd_size = u32_le(&data[eocd + 12..eocd + 16]) as usize;
    let cd_offset = u32_le(&data[eocd + 16..eocd + 20]) as usize;

    if cd_offset + cd_size > data.len() {
        return None;
    }

    let mut entries = Vec::with_capacity(cd_count);
    let mut cd_pos = cd_offset;

    for _ in 0..cd_count {
        if cd_pos + 46 > data.len() || &data[cd_pos..cd_pos + 4] != b"PK\x01\x02" {
            break;
        }

        let method = u16_le(&data[cd_pos + 10..cd_pos + 12]);
        let comp_size = u32_le(&data[cd_pos + 20..cd_pos + 24]) as usize;
        let fn_len = u16_le(&data[cd_pos + 28..cd_pos + 30]) as usize;
        let extra_len = u16_le(&data[cd_pos + 30..cd_pos + 32]) as usize;
        let comment_len = u16_le(&data[cd_pos + 32..cd_pos + 34]) as usize;
        let local_offset = u32_le(&data[cd_pos + 42..cd_pos + 46]) as usize;

        let name_bytes = &data[cd_pos + 46..cd_pos + 46 + fn_len];
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        cd_pos += 46 + fn_len + extra_len + comment_len;

        // Read from local header
        if local_offset + 30 > data.len() || &data[local_offset..local_offset + 4] != b"PK\x03\x04" {
            continue;
        }

        let loc_fn_len = u16_le(&data[local_offset + 26..local_offset + 28]) as usize;
        let loc_extra_len = u16_le(&data[local_offset + 28..local_offset + 30]) as usize;
        let data_start = local_offset + 30 + loc_fn_len + loc_extra_len;

        if data_start + comp_size > data.len() {
            continue;
        }

        let comp_data = &data[data_start..data_start + comp_size];
        let file_bytes = match method {
            0 => comp_data.to_vec(),
            8 => match decompress_deflate(comp_data) {
                Some(b) => b,
                None => continue,
            },
            _ => Vec::new(),
        };

        entries.push(ZipFileEntry {
            name,
            data: file_bytes,
        });
    }

    Some(entries)
}
