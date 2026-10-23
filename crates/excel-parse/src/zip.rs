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
use super::inflate::{decompress_deflate, MAX_UNCOMPRESSED_SIZE};

#[derive(Debug, Clone)]
pub struct ZipFileEntry {
    pub name: String,
    pub data: Vec<u8>,
}

fn get_u16_le(data: &[u8], offset: usize) -> Option<u16> {
    let end = offset.checked_add(2)?;
    let slice = data.get(offset..end)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn get_u32_le(data: &[u8], offset: usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    let slice = data.get(offset..end)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn is_shared_strings_entry(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with("sharedstrings.xml")
}

fn is_sheet1_entry(name: &str) -> bool {
    name.to_ascii_lowercase().contains("sheet1.xml")
}

fn is_sheet_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("sheet") && lower.ends_with(".xml")
}

pub fn parse_zip(data: &[u8]) -> Option<Vec<ZipFileEntry>> {
    if data.len() < 22 {
        return None;
    }

    // 1. Try Central Directory parsing first
    if let Some(cd_entries) = parse_zip_central_dir(data) {
        if !cd_entries.is_empty() {
            return Some(cd_entries);
        }
    }

    // 2. Fallback: sequential local headers scan
    let mut entries = Vec::new();
    let mut remaining_budget = MAX_UNCOMPRESSED_SIZE;
    let mut offset: usize = 0;

    let mut has_shared_strings = false;
    let mut has_sheet1 = false;
    let mut has_any_sheet = false;

    while offset.saturating_add(30) <= data.len() {
        let sig_end = match offset.checked_add(4) {
            Some(e) => e,
            None => break,
        };

        if data.get(offset..sig_end) == Some(b"PK\x03\x04") {
            let method = match offset.checked_add(8).and_then(|o| get_u16_le(data, o)) {
                Some(m) => m,
                None => break,
            };
            let comp_size = match offset.checked_add(18).and_then(|o| get_u32_le(data, o)) {
                Some(s) => s as usize,
                None => break,
            };
            let fn_len = match offset.checked_add(26).and_then(|o| get_u16_le(data, o)) {
                Some(l) => l as usize,
                None => break,
            };
            let extra_len = match offset.checked_add(28).and_then(|o| get_u16_le(data, o)) {
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

            let name_end = match name_start.checked_add(fn_len) {
                Some(e) => e,
                None => break,
            };
            let name_bytes = match data.get(name_start..name_end) {
                Some(b) => b,
                None => break,
            };
            let name = String::from_utf8_lossy(name_bytes).into_owned();

            let comp_end = match data_start.checked_add(comp_size) {
                Some(e) => e,
                None => break,
            };

            let is_ss = is_shared_strings_entry(&name);
            let is_s1 = is_sheet1_entry(&name);
            let is_s = is_sheet_entry(&name);

            let should_decompress = if is_ss {
                !has_shared_strings
            } else if is_s1 {
                !has_sheet1
            } else if is_s {
                !has_any_sheet && !has_sheet1
            } else {
                false
            };

            if !should_decompress {
                offset = comp_end;
                continue;
            }

            let comp_data = match data.get(data_start..comp_end) {
                Some(d) => d,
                None => break,
            };

            let file_bytes = match method {
                0 => {
                    if comp_data.len() > remaining_budget {
                        break;
                    }
                    comp_data.to_vec()
                }
                8 => match decompress_deflate(comp_data, remaining_budget) {
                    Some(b) => b,
                    None => {
                        offset = comp_end;
                        continue;
                    }
                },
                _ => Vec::new(),
            };

            remaining_budget = remaining_budget.saturating_sub(file_bytes.len());

            entries.push(ZipFileEntry {
                name,
                data: file_bytes,
            });

            if is_ss {
                has_shared_strings = true;
            }
            if is_s1 {
                has_sheet1 = true;
                has_any_sheet = true;
            }
            if is_s {
                has_any_sheet = true;
            }

            if has_sheet1 && has_shared_strings {
                break;
            }

            offset = comp_end;
        } else {
            offset = match offset.checked_add(1) {
                Some(o) => o,
                None => break,
            };
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
        let sig_end = match i.checked_add(4) {
            Some(e) => e,
            None => continue,
        };
        if data.get(i..sig_end) == Some(b"PK\x05\x06") {
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
    let mut remaining_budget = MAX_UNCOMPRESSED_SIZE;

    let mut has_shared_strings = false;
    let mut has_sheet1 = false;
    let mut has_any_sheet = false;

    for _ in 0..cd_count {
        let cd_sig_end = match cd_pos.checked_add(4) {
            Some(e) => e,
            None => break,
        };
        if data.get(cd_pos..cd_sig_end) != Some(b"PK\x01\x02") {
            break;
        }

        let method = get_u16_le(data, cd_pos.checked_add(10)?)?;
        let comp_size = get_u32_le(data, cd_pos.checked_add(20)?)? as usize;
        let fn_len = get_u16_le(data, cd_pos.checked_add(28)?)? as usize;
        let extra_len = get_u16_le(data, cd_pos.checked_add(30)?)? as usize;
        let comment_len = get_u16_le(data, cd_pos.checked_add(32)?)? as usize;
        let local_offset = get_u32_le(data, cd_pos.checked_add(42)?)? as usize;

        let name_start = cd_pos.checked_add(46)?;
        let name_end = name_start.checked_add(fn_len)?;
        let name_bytes = data.get(name_start..name_end)?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        let advance = 46usize.checked_add(fn_len)?.checked_add(extra_len)?.checked_add(comment_len)?;
        cd_pos = cd_pos.checked_add(advance)?;

        let is_ss = is_shared_strings_entry(&name);
        let is_s1 = is_sheet1_entry(&name);
        let is_s = is_sheet_entry(&name);

        let should_decompress = if is_ss {
            !has_shared_strings
        } else if is_s1 {
            !has_sheet1
        } else if is_s {
            !has_any_sheet && !has_sheet1
        } else {
            false
        };

        if !should_decompress {
            continue;
        }

        // Read from local header
        let loc_sig_end = match local_offset.checked_add(4) {
            Some(e) => e,
            None => continue,
        };
        if data.get(local_offset..loc_sig_end) != Some(b"PK\x03\x04") {
            continue;
        }

        let loc_fn_len = get_u16_le(data, local_offset.checked_add(26)?)? as usize;
        let loc_extra_len = get_u16_le(data, local_offset.checked_add(28)?)? as usize;
        let data_start = local_offset.checked_add(30)?.checked_add(loc_fn_len)?.checked_add(loc_extra_len)?;

        let comp_end = data_start.checked_add(comp_size)?;
        let comp_data = data.get(data_start..comp_end)?;

        let file_bytes = match method {
            0 => {
                if comp_data.len() > remaining_budget {
                    break;
                }
                comp_data.to_vec()
            }
            8 => match decompress_deflate(comp_data, remaining_budget) {
                Some(b) => b,
                None => continue,
            },
            _ => Vec::new(),
        };

        remaining_budget = remaining_budget.saturating_sub(file_bytes.len());

        entries.push(ZipFileEntry {
            name,
            data: file_bytes,
        });

        if is_ss {
            has_shared_strings = true;
        }
        if is_s1 {
            has_sheet1 = true;
            has_any_sheet = true;
        }
        if is_s {
            has_any_sheet = true;
        }

        if has_sheet1 && has_shared_strings {
            break;
        }
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

    #[test]
    fn stops_after_finding_sheet_xml_in_multisheet_zip() {
        // Construct a zip file containing sheet1.xml followed by sheet2.xml
        fn append_local_file(zip: &mut Vec<u8>, name: &str, content: &[u8]) -> usize {
            let offset = zip.len();
            zip.extend_from_slice(b"PK\x03\x04");
            zip.extend_from_slice(&[20, 0]); // version
            zip.extend_from_slice(&[0, 0]);  // flags
            zip.extend_from_slice(&[0, 0]);  // method (stored)
            zip.extend_from_slice(&[0, 0, 0, 0]); // time/date
            zip.extend_from_slice(&[0, 0, 0, 0]); // crc
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // comp size
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncomp size
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes()); // fn len
            zip.extend_from_slice(&[0, 0]);  // extra len
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(content);
            offset
        }

        let mut zip = Vec::new();
        let off1 = append_local_file(&mut zip, "xl/worksheets/sheet1.xml", b"<sheet1/>");
        let _off2 = append_local_file(&mut zip, "xl/worksheets/sheet2.xml", b"<sheet2/>");

        // Add central directory
        let cd_start = zip.len();
        let cd_entries = [
            ("xl/worksheets/sheet1.xml", b"<sheet1/>".len(), off1),
            ("xl/worksheets/sheet2.xml", b"<sheet2/>".len(), _off2),
        ];

        for (name, len, loc_off) in &cd_entries {
            zip.extend_from_slice(b"PK\x01\x02");
            zip.extend_from_slice(&[20, 0, 20, 0]); // versions
            zip.extend_from_slice(&[0, 0, 0, 0]); // flags & method
            zip.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]); // time/date & crc
            zip.extend_from_slice(&(*len as u32).to_le_bytes()); // comp
            zip.extend_from_slice(&(*len as u32).to_le_bytes()); // uncomp
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes()); // fn
            zip.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // extra, comment, disk, attrs
            zip.extend_from_slice(&(*loc_off as u32).to_le_bytes()); // local offset
            zip.extend_from_slice(name.as_bytes());
        }

        let cd_size = zip.len() - cd_start;
        zip.extend_from_slice(b"PK\x05\x06");
        zip.extend_from_slice(&[0, 0, 0, 0]); // disk numbers
        zip.extend_from_slice(&(cd_entries.len() as u16).to_le_bytes()); // entries on disk
        zip.extend_from_slice(&(cd_entries.len() as u16).to_le_bytes()); // total entries
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes()); // cd size
        zip.extend_from_slice(&(cd_start as u32).to_le_bytes()); // cd offset
        zip.extend_from_slice(&[0, 0]); // comment len

        let parsed = parse_zip(&zip).expect("Should parse zip successfully");
        assert_eq!(parsed.len(), 1, "Should stop after sheet1.xml and not parse sheet2.xml");
        assert_eq!(parsed[0].name, "xl/worksheets/sheet1.xml");
    }
}
