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

fn get_u16_le(data: &[u8], offset: usize) -> Option<u16> {
    let slice = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn get_u32_le(data: &[u8], offset: usize) -> Option<u32> {
    let slice = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
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
    let mut offset: usize = 0;
    while offset.saturating_add(30) <= data.len() {
        if data.get(offset..offset + 4) == Some(b"PK\x03\x04") {
            let method = match get_u16_le(data, offset + 8) {
                Some(m) => m,
                None => break,
            };
            let comp_size = match get_u32_le(data, offset + 18) {
                Some(s) => s as usize,
                None => break,
            };
            let fn_len = match get_u16_le(data, offset + 26) {
                Some(l) => l as usize,
                None => break,
            };
            let extra_len = match get_u16_le(data, offset + 28) {
                Some(l) => l as usize,
                None => break,
            };

            let name_start = match offset.checked_add(30) {
                Some(s) => s,
                None => break,
            };
            let data_start = match name_start.checked_add(fn_len).and_then(|s| s.checked_add(extra_len)) {
                Some(s) => s,
                None => break,
            };

            let name_bytes = match data.get(name_start..name_start.saturating_add(fn_len)) {
                Some(b) => b,
                None => break,
            };
            let name = String::from_utf8_lossy(name_bytes).into_owned();

            let comp_end = match data_start.checked_add(comp_size) {
                Some(e) => e,
                None => break,
            };
            let comp_data = match data.get(data_start..comp_end) {
                Some(d) => d,
                None => break,
            };

            let file_bytes = match method {
                0 => comp_data.to_vec(),
                8 => match decompress_deflate(comp_data) {
                    Some(b) => b,
                    None => {
                        offset += 1;
                        continue;
                    }
                },
                _ => Vec::new(),
            };

            entries.push(ZipFileEntry {
                name,
                data: file_bytes,
            });

            offset = comp_end;
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
    if data.len() < 22 {
        return None;
    }

    // Find End of Central Directory record (PK\x05\x06)
    let max_search = data.len().min(65557);
    let search_start = data.len().checked_sub(max_search)?;
    let search_end = data.len().checked_sub(22)?;
    let mut eocd_pos = None;

    for i in (search_start..=search_end).rev() {
        if data.get(i..i + 4) == Some(b"PK\x05\x06") {
            eocd_pos = Some(i);
            break;
        }
    }

    let eocd = eocd_pos?;
    let cd_count = get_u16_le(data, eocd.checked_add(10)?)? as usize;
    let cd_size = get_u32_le(data, eocd.checked_add(12)?)? as usize;
    let cd_offset = get_u32_le(data, eocd.checked_add(16)?)? as usize;

    if cd_offset.checked_add(cd_size)? > data.len() {
        return None;
    }

    let mut entries = Vec::with_capacity(cd_count.min(1024));
    let mut cd_pos = cd_offset;

    for _ in 0..cd_count {
        if data.get(cd_pos..cd_pos + 4) != Some(b"PK\x01\x02") {
            break;
        }

        let method = get_u16_le(data, cd_pos.checked_add(10)?)?;
        let comp_size = get_u32_le(data, cd_pos.checked_add(20)?)? as usize;
        let fn_len = get_u16_le(data, cd_pos.checked_add(28)?)? as usize;
        let extra_len = get_u16_le(data, cd_pos.checked_add(30)?)? as usize;
        let comment_len = get_u16_le(data, cd_pos.checked_add(32)?)? as usize;
        let local_offset = get_u32_le(data, cd_pos.checked_add(42)?)? as usize;

        let name_start = cd_pos.checked_add(46)?;
        let name_bytes = data.get(name_start..name_start.checked_add(fn_len)?)?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        let advance = 46usize.checked_add(fn_len)?.checked_add(extra_len)?.checked_add(comment_len)?;
        cd_pos = cd_pos.checked_add(advance)?;

        // Read from local header
        if data.get(local_offset..local_offset + 4) != Some(b"PK\x03\x04") {
            continue;
        }

        let loc_fn_len = get_u16_le(data, local_offset.checked_add(26)?)? as usize;
        let loc_extra_len = get_u16_le(data, local_offset.checked_add(28)?)? as usize;
        let data_start = local_offset.checked_add(30)?.checked_add(loc_fn_len)?.checked_add(loc_extra_len)?;

        let comp_data = data.get(data_start..data_start.checked_add(comp_size)?)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_central_dir_does_not_panic() {
        // Construct malformed ZIP data that has EOCD header with huge central directory offset
        let mut malformed = Vec::new();
        malformed.extend_from_slice(b"PK\x05\x06"); // EOCD signature
        malformed.extend_from_slice(&[0u8; 6]);     // disk numbers and cd counts
        malformed.extend_from_slice(&[0xFF, 0xFF, 0x00, 0x00]); // cd_size
        malformed.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0x7F]); // cd_offset out of bounds
        malformed.extend_from_slice(&[0u8; 2]);     // comment len

        assert!(parse_zip(&malformed).is_none());
    }

    #[test]
    fn truncated_zip_returns_none() {
        let truncated = b"PK\x03\x04\x0a\x00";
        assert!(parse_zip(truncated).is_none());
    }
}
