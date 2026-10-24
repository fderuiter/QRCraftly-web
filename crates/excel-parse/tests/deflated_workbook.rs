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

//! End-to-end check of the DEFLATE path on a real .xlsx container.
//!
//! `fixtures/deflated-workbook.xlsx` was written by Python's `zipfile` module with
//! `ZIP_DEFLATED` (every entry is compression method 8). That makes Python's zlib the
//! reference encoder. The file was NOT written by a spreadsheet app.

const FIXTURE: &[u8] = include_bytes!("fixtures/deflated-workbook.xlsx");

#[test]
fn inflates_deflated_xlsx_entries_into_expected_csv() {
    let csv = excel_parse::excel_bytes_to_csv(FIXTURE);
    let csv = String::from_utf8(csv).expect("CSV output must be valid UTF-8");

    // First sheet only (sheet1.xml). Column C is never written, so it appears as an empty
    // field. Cells with commas or quotes are quoted, with quotes doubled. Rows are joined
    // with "\n" and there is no trailing newline.
    let expected = concat!(
        "Name,URL,,Score\n",
        "\"Smith, Jane\",https://example.com/?a=1&b=2,,42\n",
        "\"Say \"\"hi\"\"\",https://example.com/inline,,7.5\n",
        "Tom & Jerry,,,0",
    );
    assert_eq!(csv, expected);
}
