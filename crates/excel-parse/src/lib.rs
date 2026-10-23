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

//! In-house Excel spreadsheet parsing WebAssembly kernel (ADR 0033).
//! Converts XLSX, XLS (SpreadsheetML / HTML) and CSV input into normalized CSV text.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod inflate;
pub mod xml;
pub mod zip;

use alloc::vec::Vec;
use qrcraftly_core::abi::{STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use xml::{format_matrix_to_csv, parse_shared_strings, parse_sheet_xml, parse_spreadsheetml_or_html};
use zip::parse_zip;

/// Builds a slice from a pointer and length, treating a null or empty input as empty.
///
/// # Safety
/// `ptr..ptr + len` must be readable linear memory.
unsafe fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

pub fn excel_bytes_to_csv(data: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }

    // 1. Try XLSX (PKZip container)
    if let Some(zip_files) = parse_zip(data) {
        let shared_strings = zip_files
            .iter()
            .find(|f| f.name.ends_with("sharedStrings.xml"))
            .and_then(|f| core::str::from_utf8(&f.data).ok())
            .map(parse_shared_strings)
            .unwrap_or_default();

        let sheet_xml = zip_files
            .iter()
            .find(|f| f.name.contains("sheet1.xml"))
            .or_else(|| zip_files.iter().find(|f| f.name.contains("sheet") && f.name.ends_with(".xml")))
            .and_then(|f| core::str::from_utf8(&f.data).ok());

        if let Some(xml_content) = sheet_xml {
            let matrix = parse_sheet_xml(xml_content, &shared_strings);
            let csv_str = format_matrix_to_csv(&matrix);
            return csv_str.into_bytes();
        }
    }

    // 2. Try XML Spreadsheet 2003 / HTML table format (.xls)
    if let Ok(text) = core::str::from_utf8(data) {
        let trimmed = text.trim();
        if trimmed.starts_with('<') && (trimmed.contains("<tr") || trimmed.contains("<Row") || trimmed.contains("<table") || trimmed.contains("<Workbook")) {
            let matrix = parse_spreadsheetml_or_html(text);
            let csv_str = format_matrix_to_csv(&matrix);
            return csv_str.into_bytes();
        }

        // 3. Fallback: return input text as CSV
        return data.to_vec();
    }

    // Fallback binary
    data.to_vec()
}

/// Parses an Excel spreadsheet (XLSX, XLS) or CSV file and writes normalized CSV text to `out_ptr`.
///
/// # Safety
/// `in_ptr..in_ptr + in_len` must be readable linear memory and `out_ptr..out_ptr + out_max_len` writable.
#[no_mangle]
pub unsafe extern "C" fn excel_parse_to_csv(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_max_len: usize,
    out_len_ptr: *mut u32,
) -> i32 {
    let src = unsafe { input(in_ptr, in_len) };
    let csv_bytes = excel_bytes_to_csv(src);
    let needed = csv_bytes.len();

    if !out_len_ptr.is_null() {
        unsafe { *out_len_ptr = needed as u32 };
    }

    if out_ptr.is_null() || out_max_len < needed {
        return STATUS_BUFFER_TOO_SMALL;
    }

    if !csv_bytes.is_empty() {
        unsafe { core::ptr::copy_nonoverlapping(csv_bytes.as_ptr(), out_ptr, needed) };
    }

    STATUS_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_text_passthrough() {
        let input = b"Name,URL\nItem 1,https://example.com";
        let csv = excel_bytes_to_csv(input);
        assert_eq!(csv, input);
    }

    #[test]
    fn parses_html_table_xls() {
        let input = b"<table><tr><td>Name</td><td>URL</td></tr><tr><td>Test</td><td>https://test.com</td></tr></table>";
        let csv = excel_bytes_to_csv(input);
        assert_eq!(String::from_utf8(csv).unwrap(), "Name,URL\nTest,https://test.com");
    }

    #[test]
    fn cell_ref_conversion() {
        use xml::col_letters_to_index;
        assert_eq!(col_letters_to_index("A"), 0);
        assert_eq!(col_letters_to_index("B"), 1);
        assert_eq!(col_letters_to_index("Z"), 25);
        assert_eq!(col_letters_to_index("AA"), 26);
    }
}
