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
//! Converts XLSX (and SpreadsheetML/HTML) input into normalized CSV text.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod inflate;
pub mod xml;
pub mod zip;

use alloc::vec::Vec;
use qrcraftly_core::abi::{STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use xml::{
    format_matrix_to_csv, parse_shared_strings, parse_sheet_xml, parse_spreadsheetml_or_html,
};
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
            .or_else(|| {
                zip_files
                    .iter()
                    .find(|f| f.name.contains("sheet") && f.name.ends_with(".xml"))
            })
            .and_then(|f| core::str::from_utf8(&f.data).ok());

        if let Some(xml_content) = sheet_xml {
            let matrix = parse_sheet_xml(xml_content, &shared_strings);
            let csv_str = format_matrix_to_csv(&matrix);
            return csv_str.into_bytes();
        }

        // Zip archive without sheet XML (e.g. corrupt XLSX or unrelated ZIP)
        return Vec::new();
    }

    // 2. Try XML Spreadsheet 2003 / HTML table format (.xls XML/HTML fallback)
    if let Ok(text) = core::str::from_utf8(data) {
        let trimmed = text.trim();
        if trimmed.starts_with('<')
            && (trimmed.contains("<tr")
                || trimmed.contains("<Row")
                || trimmed.contains("<table")
                || trimmed.contains("<Workbook"))
        {
            let matrix = parse_spreadsheetml_or_html(text);
            let csv_str = format_matrix_to_csv(&matrix);
            return csv_str.into_bytes();
        }
    }

    // Unrecognized binary or plain text input (e.g. legacy BIFF8 .xls, plain CSV, or corrupt binary)
    Vec::new()
}

/// Parses an Excel spreadsheet (XLSX, SpreadsheetML) and writes normalized CSV text to `out_ptr`.
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
    fn rejects_plain_text_passthrough() {
        let input = b"Name,URL\nItem 1,https://example.com";
        let csv = excel_bytes_to_csv(input);
        assert!(
            csv.is_empty(),
            "Plain text passed to excel parser should return empty CSV bytes"
        );
    }

    #[test]
    fn parses_empty_workbook_sheet() {
        let xml = "<worksheet><sheetData/></worksheet>";
        let matrix = parse_sheet_xml(xml, &[]);
        assert!(
            matrix.is_empty(),
            "Empty sheet XML should return an empty matrix"
        );
        let csv = format_matrix_to_csv(&matrix);
        assert!(
            csv.is_empty(),
            "Empty matrix should format to empty CSV string"
        );
    }

    #[test]
    fn parses_html_table_xls() {
        let input = b"<table><tr><td>Name</td><td>URL</td></tr><tr><td>Test</td><td>https://test.com</td></tr></table>";
        let csv = excel_bytes_to_csv(input);
        assert_eq!(
            String::from_utf8(csv).unwrap(),
            "Name,URL\nTest,https://test.com"
        );
    }

    #[test]
    fn rejects_legacy_biff_binary_xls() {
        // OLE2 Compound File Binary Format magic bytes (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1)
        let ole2_bytes = [
            0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x01, 0x02,
        ];
        let csv = excel_bytes_to_csv(&ole2_bytes);
        assert!(
            csv.is_empty(),
            "Legacy binary BIFF .xls should return empty CSV bytes"
        );
    }

    #[test]
    fn rejects_corrupt_zip_without_sheet_xml() {
        // Minimal PKZip with a single file named 'readme.txt' instead of sheet XML
        let zip_bytes = [
            0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00,
            0x00, 0x00, 0x72, 0x65, 0x61, 0x64, 0x6d, 0x65, 0x2e, 0x74, 0x78, 0x74,
        ];
        let csv = excel_bytes_to_csv(&zip_bytes);
        assert!(
            csv.is_empty(),
            "Zip file without sheet XML should return empty CSV bytes"
        );
    }

    #[test]
    fn cell_ref_conversion() {
        use xml::col_letters_to_index;
        assert_eq!(col_letters_to_index("A"), 0);
        assert_eq!(col_letters_to_index("B"), 1);
        assert_eq!(col_letters_to_index("Z"), 25);
        assert_eq!(col_letters_to_index("AA"), 26);
    }

    #[test]
    fn parses_excel_order_sheet_before_shared_strings() {
        fn append_local_file(zip: &mut Vec<u8>, name: &str, content: &[u8]) -> usize {
            let offset = zip.len();
            zip.extend_from_slice(b"PK\x03\x04");
            zip.extend_from_slice(&[20, 0]); // version
            zip.extend_from_slice(&[0, 0]); // flags
            zip.extend_from_slice(&[0, 0]); // method (stored)
            zip.extend_from_slice(&[0, 0, 0, 0]); // time/date
            zip.extend_from_slice(&[0, 0, 0, 0]); // crc
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // comp size
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncomp size
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes()); // fn len
            zip.extend_from_slice(&[0, 0]); // extra len
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(content);
            offset
        }

        let sheet1_xml = br#"<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>"#;
        let shared_strings_xml =
            br#"<sst><si><t>Header</t></si><si><t>https://example.com</t></si></sst>"#;

        let mut zip = Vec::new();
        // Excel order: sheet1.xml BEFORE sharedStrings.xml
        let off1 = append_local_file(&mut zip, "xl/worksheets/sheet1.xml", sheet1_xml);
        let off2 = append_local_file(&mut zip, "xl/sharedStrings.xml", shared_strings_xml);

        let cd_start = zip.len();
        let cd_entries = [
            ("xl/worksheets/sheet1.xml", sheet1_xml.len(), off1),
            ("xl/sharedStrings.xml", shared_strings_xml.len(), off2),
        ];

        for (name, len, loc_off) in &cd_entries {
            zip.extend_from_slice(b"PK\x01\x02");
            zip.extend_from_slice(&[20, 0, 20, 0]);
            zip.extend_from_slice(&[0, 0, 0, 0]);
            zip.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
            zip.extend_from_slice(&(*len as u32).to_le_bytes());
            zip.extend_from_slice(&(*len as u32).to_le_bytes());
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
            zip.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            zip.extend_from_slice(&(*loc_off as u32).to_le_bytes());
            zip.extend_from_slice(name.as_bytes());
        }

        let cd_size = zip.len() - cd_start;
        zip.extend_from_slice(b"PK\x05\x06");
        zip.extend_from_slice(&[0, 0, 0, 0]);
        zip.extend_from_slice(&(cd_entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(cd_entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_start as u32).to_le_bytes());
        zip.extend_from_slice(&[0, 0]);

        let csv_bytes = excel_bytes_to_csv(&zip);
        let csv_text = String::from_utf8(csv_bytes).expect("CSV should be valid UTF-8");
        assert_eq!(csv_text, "Header,https://example.com", "Shared strings must be preserved even when sheet1.xml precedes sharedStrings.xml in archive");
    }

    #[test]
    fn parses_excel_order_local_header_fallback_sheet_before_shared_strings() {
        fn append_local_file(zip: &mut Vec<u8>, name: &str, content: &[u8]) {
            zip.extend_from_slice(b"PK\x03\x04");
            zip.extend_from_slice(&[20, 0]); // version
            zip.extend_from_slice(&[0, 0]); // flags
            zip.extend_from_slice(&[0, 0]); // method (stored)
            zip.extend_from_slice(&[0, 0, 0, 0]); // time/date
            zip.extend_from_slice(&[0, 0, 0, 0]); // crc
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // comp size
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncomp size
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes()); // fn len
            zip.extend_from_slice(&[0, 0]); // extra len
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(content);
        }

        let sheet1_xml = br#"<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>"#;
        let shared_strings_xml =
            br#"<sst><si><t>Header</t></si><si><t>https://example.com</t></si></sst>"#;

        let mut zip = Vec::new();
        // Excel order without central directory (testing fallback local header scanner)
        append_local_file(&mut zip, "xl/worksheets/sheet1.xml", sheet1_xml);
        append_local_file(&mut zip, "xl/sharedStrings.xml", shared_strings_xml);

        let csv_bytes = excel_bytes_to_csv(&zip);
        let csv_text = String::from_utf8(csv_bytes).expect("CSV should be valid UTF-8");
        assert_eq!(csv_text, "Header,https://example.com", "Local header scanner must preserve shared strings when sheet1.xml precedes sharedStrings.xml");
    }
}
