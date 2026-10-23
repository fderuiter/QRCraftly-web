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

//! Plain Rust XML & Excel cell parser for XLSX sharedStrings, sheet XML, SpreadsheetML & HTML tables.

extern crate alloc;
use alloc::borrow::ToOwned;
use alloc::string::String;
use alloc::vec::Vec;

pub fn unescape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '&' {
            let mut entity = String::new();
            let mut matched = false;
            while let Some(&nc) = chars.peek() {
                chars.next();
                if nc == ';' {
                    matched = true;
                    break;
                }
                entity.push(nc);
                if entity.len() > 10 {
                    break;
                }
            }
            if matched {
                match entity.as_str() {
                    "amp" => out.push('&'),
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "quot" => out.push('"'),
                    "apos" => out.push('\''),
                    s if s.starts_with('#') => {
                        let num_str = &s[1..];
                        let code = if num_str.starts_with('x') || num_str.starts_with('X') {
                            u32::from_str_radix(&num_str[1..], 16).ok()
                        } else {
                            num_str.parse::<u32>().ok()
                        };
                        if let Some(ch) = code.and_then(char::from_u32) {
                            out.push(ch);
                        } else {
                            out.push('&');
                            out.push_str(&entity);
                            out.push(';');
                        }
                    }
                    _ => {
                        out.push('&');
                        out.push_str(&entity);
                        out.push(';');
                    }
                }
            } else {
                out.push('&');
                out.push_str(&entity);
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn parse_shared_strings(xml: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut pos = 0;

    while let Some(si_start) = xml[pos..].find("<si") {
        let abs_start = pos + si_start;
        if let Some(si_end) = xml[abs_start..].find("</si>") {
            let abs_end = abs_start + si_end + 5;
            let block = &xml[abs_start..abs_end];

            let mut val = String::new();
            let mut t_pos = 0;
            while let Some(t_open) = block[t_pos..].find("<t") {
                let open_idx = t_pos + t_open;
                if let Some(tag_close) = block[open_idx..].find('>') {
                    let content_start = open_idx + tag_close + 1;
                    if let Some(t_end) = block[content_start..].find("</t>") {
                        let text = &block[content_start..content_start + t_end];
                        val.push_str(&unescape_xml(text));
                        t_pos = content_start + t_end + 4;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            strings.push(val);
            pos = abs_end;
        } else {
            break;
        }
    }

    strings
}

pub fn col_letters_to_index(col: &str) -> usize {
    let mut index = 0usize;
    for c in col.chars() {
        if c.is_ascii_uppercase() {
            index = index * 26 + ((c as usize) - ('A' as usize) + 1);
        } else if c.is_ascii_lowercase() {
            index = index * 26 + ((c as usize) - ('a' as usize) + 1);
        }
    }
    if index > 0 {
        index - 1
    } else {
        0
    }
}

pub fn parse_cell_ref(r_attr: &str) -> (usize, usize) {
    let letters: String = r_attr.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    let digits: String = r_attr.chars().filter(|c| c.is_ascii_digit()).collect();

    let col_idx = if !letters.is_empty() {
        col_letters_to_index(&letters)
    } else {
        0
    };

    let row_idx = if !digits.is_empty() {
        digits.parse::<usize>().unwrap_or(1).saturating_sub(1)
    } else {
        0
    };

    (col_idx, row_idx)
}

fn get_attribute<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let pattern = alloc::format!("{}=", attr);
    if let Some(idx) = tag.find(&pattern) {
        let val_part = &tag[idx + pattern.len()..];
        let quote = val_part.chars().next()?;
        if quote == '"' || quote == '\'' {
            let end_quote = val_part[1..].find(quote)?;
            return Some(&val_part[1..1 + end_quote]);
        }
    }
    None
}

pub fn parse_sheet_xml(xml: &str, shared_strings: &[String]) -> Vec<Vec<String>> {
    let mut rows: Vec<(usize, Vec<(usize, String)>)> = Vec::new();
    let mut pos = 0;

    while let Some(row_start) = xml[pos..].find("<row") {
        let abs_row_start = pos + row_start;
        let row_tag_end = match xml[abs_row_start..].find('>') {
            Some(idx) => abs_row_start + idx + 1,
            None => break,
        };

        let row_end = match xml[abs_row_start..].find("</row>") {
            Some(idx) => abs_row_start + idx + 6,
            None => break,
        };

        let row_tag = &xml[abs_row_start..row_tag_end];
        let row_body = &xml[row_tag_end..row_end];

        let row_num = get_attribute(row_tag, "r")
            .and_then(|s| s.parse::<usize>().ok())
            .map(|n| n.saturating_sub(1));

        let mut row_cells: Vec<(usize, String)> = Vec::new();
        let mut cell_pos = 0;
        let mut curr_col = 0;

        while let Some(c_start) = row_body[cell_pos..].find("<c") {
            let abs_c_start = cell_pos + c_start;
            let c_tag_end = match row_body[abs_c_start..].find('>') {
                Some(idx) => abs_c_start + idx + 1,
                None => break,
            };

            let c_tag = &row_body[abs_c_start..c_tag_end];
            let is_self_closing = c_tag.ends_with("/>");

            let (col_idx, derived_row) = if let Some(r_attr) = get_attribute(c_tag, "r") {
                let (c, r) = parse_cell_ref(r_attr);
                curr_col = c + 1;
                (c, Some(r))
            } else {
                let c = curr_col;
                curr_col += 1;
                (c, None)
            };

            let cell_type = get_attribute(c_tag, "t").unwrap_or("");

            let cell_val = if is_self_closing {
                cell_pos = c_tag_end;
                String::new()
            } else {
                let c_end = match row_body[abs_c_start..].find("</c>") {
                    Some(idx) => abs_c_start + idx + 4,
                    None => break,
                };
                let cell_inner = &row_body[c_tag_end..c_end - 4];
                cell_pos = c_end;

                if cell_type == "s" {
                    if let Some(v_start) = cell_inner.find("<v>") {
                        let val_start = v_start + 3;
                        if let Some(v_end) = cell_inner[val_start..].find("</v>") {
                            let idx_str = &cell_inner[val_start..val_start + v_end];
                            if let Ok(s_idx) = idx_str.trim().parse::<usize>() {
                                shared_strings.get(s_idx).cloned().unwrap_or_default()
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                } else if cell_type == "inlineStr" || cell_type == "str" {
                    if let Some(t_start) = cell_inner.find("<t") {
                        if let Some(tag_close) = cell_inner[t_start..].find('>') {
                            let val_start = t_start + tag_close + 1;
                            if let Some(t_end) = cell_inner[val_start..].find("</t>") {
                                unescape_xml(&cell_inner[val_start..val_start + t_end])
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        }
                    } else if let Some(v_start) = cell_inner.find("<v>") {
                        let val_start = v_start + 3;
                        if let Some(v_end) = cell_inner[val_start..].find("</v>") {
                            unescape_xml(&cell_inner[val_start..val_start + v_end])
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                } else if cell_type == "b" {
                    if let Some(v_start) = cell_inner.find("<v>") {
                        let val_start = v_start + 3;
                        if let Some(v_end) = cell_inner[val_start..].find("</v>") {
                            let b_val = cell_inner[val_start..val_start + v_end].trim();
                            if b_val == "1" || b_val.eq_ignore_ascii_case("true") {
                                "TRUE".to_owned()
                            } else {
                                "FALSE".to_owned()
                            }
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                } else {
                    // Default numeric / formula cached value
                    if let Some(v_start) = cell_inner.find("<v>") {
                        let val_start = v_start + 3;
                        if let Some(v_end) = cell_inner[val_start..].find("</v>") {
                            unescape_xml(cell_inner[val_start..val_start + v_end].trim())
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                }
            };

            let _ = derived_row;
            row_cells.push((col_idx, cell_val));
        }

        let explicit_row_idx = row_num.unwrap_or(rows.len());
        rows.push((explicit_row_idx, row_cells));
        pos = row_end;
    }

    if rows.is_empty() {
        return Vec::new();
    }

    rows.sort_by_key(|(r, _)| *r);

    let mut result_matrix: Vec<Vec<String>> = Vec::new();
    for (r_idx, cells) in rows {
        while result_matrix.len() < r_idx {
            result_matrix.push(Vec::new());
        }

        let mut row_vec = Vec::new();
        for (c_idx, val) in cells {
            while row_vec.len() < c_idx {
                row_vec.push(String::new());
            }
            if row_vec.len() == c_idx {
                row_vec.push(val);
            } else {
                row_vec[c_idx] = val;
            }
        }
        result_matrix.push(row_vec);
    }

    result_matrix
}

pub fn parse_spreadsheetml_or_html(text: &str) -> Vec<Vec<String>> {
    let mut matrix = Vec::new();
    let lower = text.to_lowercase();
    let is_html = lower.contains("<table") || lower.contains("<tr");

    let row_tag_open = if is_html { "<tr" } else { "<row" };
    let row_tag_close = if is_html { "</tr>" } else { "</row>" };
    let cell_tag_open = if is_html { "<td" } else { "<cell" };
    let cell_tag_close = if is_html { "</td>" } else { "</cell>" };

    let mut pos = 0;
    while let Some(r_start) = lower[pos..].find(row_tag_open) {
        let abs_r_start = pos + r_start;
        let r_end = match lower[abs_r_start..].find(row_tag_close) {
            Some(idx) => abs_r_start + idx + row_tag_close.len(),
            None => break,
        };

        let row_body = &text[abs_r_start..r_end];
        let mut row_cells = Vec::new();
        let mut cell_pos = 0;

        let lower_body = row_body.to_lowercase();
        while let Some(c_start) = lower_body[cell_pos..].find(cell_tag_open) {
            let abs_c_start = cell_pos + c_start;
            let c_open_end = match lower_body[abs_c_start..].find('>') {
                Some(idx) => abs_c_start + idx + 1,
                None => break,
            };

            let c_end = match lower_body[abs_c_start..].find(cell_tag_close) {
                Some(idx) => abs_c_start + idx + cell_tag_close.len(),
                None => break,
            };

            let cell_inner = &row_body[c_open_end..c_end - cell_tag_close.len()];

            // Extract plain text inside cell, stripping inner tags
            let mut val = String::new();
            let mut in_tag = false;
            for ch in cell_inner.chars() {
                if ch == '<' {
                    in_tag = true;
                } else if ch == '>' {
                    in_tag = false;
                } else if !in_tag {
                    val.push(ch);
                }
            }

            row_cells.push(unescape_xml(val.trim()));
            cell_pos = c_end;
        }

        if !row_cells.is_empty() {
            matrix.push(row_cells);
        }
        pos = r_end;
    }

    matrix
}

pub fn format_matrix_to_csv(matrix: &[Vec<String>]) -> String {
    let mut csv = String::new();
    for (r_idx, row) in matrix.iter().enumerate() {
        if r_idx > 0 {
            csv.push('\n');
        }
        for (c_idx, cell) in row.iter().enumerate() {
            if c_idx > 0 {
                csv.push(',');
            }
            if cell.contains(',')
                || cell.contains('"')
                || cell.contains('\n')
                || cell.contains('\r')
            {
                csv.push('"');
                for ch in cell.chars() {
                    if ch == '"' {
                        csv.push_str("\"\"");
                    } else {
                        csv.push(ch);
                    }
                }
                csv.push('"');
            } else {
                csv.push_str(cell);
            }
        }
    }
    csv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes_xml_entities() {
        assert_eq!(
            unescape_xml("Foo &amp; Bar &lt;Baz&gt; &quot;Qux&quot;"),
            "Foo & Bar <Baz> \"Qux\""
        );
        assert_eq!(unescape_xml("Hex &#x41; Dec &#66;"), "Hex A Dec B");
    }

    #[test]
    fn parses_shared_strings_xml() {
        let xml = "<sst><si><t>Hello</t></si><si><r><t>World</t></r></si></sst>";
        let strings = parse_shared_strings(xml);
        assert_eq!(strings, vec!["Hello", "World"]);
    }

    #[test]
    fn parses_sheet_xml_matrix() {
        let shared = vec!["Col 1".to_string(), "Col 2".to_string()];
        let xml = r#"<worksheet><sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
            <row r="2"><c r="A2"><v>123</v></c><c r="B2" t="b"><v>1</v></c></row>
        </sheetData></worksheet>"#;
        let matrix = parse_sheet_xml(xml, &shared);
        assert_eq!(matrix.len(), 2);
        assert_eq!(matrix[0], vec!["Col 1", "Col 2"]);
        assert_eq!(matrix[1], vec!["123", "TRUE"]);
    }

    #[test]
    fn formats_csv_escaping_special_chars() {
        let matrix = vec![
            vec!["Header,1".to_string(), "Header \"2\"".to_string()],
            vec!["Line 1\nLine 2".to_string(), "Normal".to_string()],
        ];
        let csv = format_matrix_to_csv(&matrix);
        assert_eq!(
            csv,
            "\"Header,1\",\"Header \"\"2\"\"\"\n\"Line 1\nLine 2\",Normal"
        );
    }
}
