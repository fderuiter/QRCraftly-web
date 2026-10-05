/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

//! Optimal segmentation: the cheapest split of a text into numeric,
//! alphanumeric and byte segments for one character count range.
//!
//! A shortest path over (character, mode) states. Costs are kept in sixths of
//! a bit, so a numeric digit costs 20 (10 bits per 3 digits) and an
//! alphanumeric character 33 (11 bits per 2); a segment's real cost is its
//! cost rounded up to a whole bit, which is applied whenever the mode switches.
//! Kanji mode is never chosen automatically (its Shift JIS table would double
//! the module); callers can still supply kanji segments.

use crate::segment::{is_alphanumeric, is_numeric, Mode, Segment};
use alloc::vec::Vec;

const MODES: [Mode; 3] = [Mode::Byte, Mode::Alphanumeric, Mode::Numeric];
const NONE: u8 = u8::MAX;

/// Length of the UTF-8 sequence that starts with `lead`.
fn utf8_len(lead: u8) -> usize {
    match lead {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

fn fits(mode: Mode, ch: &[u8]) -> bool {
    match mode {
        Mode::Byte => true,
        Mode::Alphanumeric => ch.len() == 1 && is_alphanumeric(ch[0]),
        Mode::Numeric => ch.len() == 1 && is_numeric(ch[0]),
        _ => false,
    }
}

/// Cost of one character in sixths of a bit.
fn char_cost(mode: Mode, ch: &[u8]) -> usize {
    match mode {
        Mode::Numeric => 20,
        Mode::Alphanumeric => 33,
        _ => ch.len() * 48,
    }
}

/// Splits valid UTF-8 `text` into the segments with the fewest bits for symbols
/// of `version`'s character count range, appending them to `out`.
pub fn segment_text<'a>(text: &'a [u8], version: u8, out: &mut Vec<Segment<'a>>) {
    if text.is_empty() {
        return;
    }
    // Character boundaries.
    let mut starts: Vec<usize> = Vec::with_capacity(text.len() + 1);
    let mut i = 0;
    while i < text.len() {
        starts.push(i);
        i += utf8_len(text[i]);
    }
    let n = starts.len();
    starts.push(text.len());

    let head: [usize; 3] = MODES.map(|m| (4 + m.count_bits(version) as usize) * 6);
    // chosen[i][j]: the mode character i is encoded in, for the path that is in mode j after it.
    let mut chosen: Vec<[u8; 3]> = Vec::with_capacity(n);
    let mut prev = head;
    for c in 0..n {
        let ch = &text[starts[c]..starts[c + 1]];
        let mut cur = [usize::MAX; 3];
        let mut modes = [NONE; 3];
        for (j, &mode) in MODES.iter().enumerate() {
            if fits(mode, ch) {
                cur[j] = prev[j] + char_cost(mode, ch);
                modes[j] = j as u8;
            }
        }
        // Switching after this character: round the finished segment up to whole bits.
        let ended = cur;
        for to in 0..3 {
            for from in 0..3 {
                if modes[from] == NONE || ended[from] == usize::MAX {
                    continue;
                }
                let cost = ended[from].div_ceil(6) * 6 + head[to];
                if cost < cur[to] {
                    cur[to] = cost;
                    modes[to] = from as u8;
                }
            }
        }
        chosen.push(modes);
        prev = cur;
    }

    // The cheapest final state, then trace each character's mode backwards.
    let mut state = 0;
    for j in 1..3 {
        if prev[j] < prev[state] {
            state = j;
        }
    }
    let mut char_modes: Vec<u8> = alloc::vec![0; n];
    for c in (0..n).rev() {
        let mode = chosen[c][state];
        char_modes[c] = mode;
        state = mode as usize;
    }

    // Merge runs of one mode into segments.
    let mut c = 0;
    while c < n {
        let mode = char_modes[c];
        let mut end = c + 1;
        while end < n && char_modes[end] == mode {
            end += 1;
        }
        let data = &text[starts[c]..starts[end]];
        let mode = MODES[mode as usize];
        out.push(Segment {
            mode,
            data,
            chars: if mode == Mode::Byte {
                data.len()
            } else {
                end - c
            },
            offset: starts[c],
        });
        c = end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::total_bits;

    fn split(text: &str, version: u8) -> Vec<(Mode, &str)> {
        let mut out = Vec::new();
        segment_text(text.as_bytes(), version, &mut out);
        out.iter()
            .map(|s| (s.mode, core::str::from_utf8(s.data).unwrap()))
            .collect()
    }

    #[test]
    fn single_mode_texts() {
        assert_eq!(split("0123456789", 1), [(Mode::Numeric, "0123456789")]);
        assert_eq!(
            split("HELLO WORLD", 1),
            [(Mode::Alphanumeric, "HELLO WORLD")]
        );
        assert_eq!(split("hello", 1), [(Mode::Byte, "hello")]);
        assert_eq!(split("日本語", 1), [(Mode::Byte, "日本語")]);
        assert!(split("", 1).is_empty());
    }

    #[test]
    fn short_runs_stay_in_the_surrounding_mode() {
        // Two digits are cheaper as bytes than as a numeric segment with its header.
        assert_eq!(split("ab12cd", 1), [(Mode::Byte, "ab12cd")]);
        // A long digit run earns its own segment.
        assert_eq!(
            split("ab123456789012cd", 1),
            [
                (Mode::Byte, "ab"),
                (Mode::Numeric, "123456789012"),
                (Mode::Byte, "cd")
            ]
        );
    }

    #[test]
    fn mixed_alphanumeric_and_numeric() {
        assert_eq!(
            split("ABC0123456789", 1),
            [(Mode::Alphanumeric, "ABC"), (Mode::Numeric, "0123456789")]
        );
    }

    /// The fewest bits over every split into segments, by exhaustive search, as an oracle.
    fn brute_force_bits(text: &[u8], version: u8) -> usize {
        let n = text.len();
        // best[i]: fewest bits for text[..i]; segments are scored independently.
        let mut best = alloc::vec![usize::MAX; n + 1];
        best[0] = 0;
        for i in 0..n {
            if best[i] == usize::MAX {
                continue;
            }
            for j in i + 1..=n {
                for mode in MODES {
                    if let Some(seg) = Segment::new(mode, &text[i..j], i) {
                        if let Some(bits) = seg.total_bits(version) {
                            best[j] = best[j].min(best[i] + bits);
                        }
                    }
                }
            }
        }
        best[n]
    }

    #[test]
    fn matches_an_exhaustive_search_on_ascii() {
        let alphabet = b"0123456789ABZ $:az";
        let mut seed = 0x1177u32;
        for round in 0..400 {
            let len = 1 + round % 24;
            let text: Vec<u8> = (0..len)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    alphabet[(seed % alphabet.len() as u32) as usize]
                })
                .collect();
            for version in [1u8, 10, 27] {
                let mut segs = Vec::new();
                segment_text(&text, version, &mut segs);
                let ours = total_bits(None, &segs, version).unwrap();
                assert_eq!(
                    ours,
                    brute_force_bits(&text, version),
                    "{:?} v{version}",
                    core::str::from_utf8(&text)
                );
            }
        }
    }
}
