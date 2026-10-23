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

use alloc::vec::Vec;
use qrcraftly_core::crc32;

pub static WORDS: [&str; 256] = [
    "able", "acid", "also", "apex", "aqua", "arch", "atom", "aunt", "away", "axis", "back", "bald",
    "barn", "belt", "beta", "bias", "blue", "body", "brag", "brew", "bulb", "buzz", "calm", "cash",
    "cats", "chef", "city", "claw", "code", "cola", "cook", "cost", "crux", "curl", "cusp", "cyan",
    "dark", "data", "days", "deli", "dice", "diet", "door", "down", "draw", "drop", "drum", "dull",
    "duty", "each", "easy", "echo", "edge", "epic", "even", "exam", "exit", "eyes", "fact", "fair",
    "fern", "figs", "film", "fish", "fizz", "flap", "flew", "flux", "foxy", "free", "frog", "fuel",
    "fund", "gala", "game", "gear", "gems", "gift", "girl", "glow", "good", "gray", "grim", "guru",
    "gush", "gyro", "half", "hang", "hard", "hawk", "heat", "help", "high", "hill", "holy", "hope",
    "horn", "huts", "iced", "idea", "idle", "inch", "inky", "into", "iris", "iron", "item", "jade",
    "jazz", "join", "jolt", "jowl", "judo", "jugs", "jump", "junk", "jury", "keep", "keno", "kept",
    "keys", "kick", "kiln", "king", "kite", "kiwi", "knob", "lamb", "lava", "lazy", "leaf", "legs",
    "liar", "limp", "lion", "list", "logo", "loud", "love", "luau", "luck", "lung", "main", "many",
    "math", "maze", "memo", "menu", "meow", "mild", "mint", "miss", "monk", "nail", "navy", "need",
    "news", "next", "noon", "note", "numb", "obey", "oboe", "omit", "onyx", "open", "oval", "owls",
    "paid", "part", "peck", "play", "plus", "poem", "pool", "pose", "puff", "puma", "purr", "quad",
    "quiz", "race", "ramp", "real", "redo", "rich", "road", "rock", "roof", "ruby", "ruin", "runs",
    "rust", "safe", "saga", "scar", "sets", "silk", "skew", "slot", "soap", "solo", "song", "stub",
    "surf", "swan", "taco", "task", "taxi", "tent", "tied", "time", "tiny", "toil", "tomb", "toys",
    "trip", "tuna", "twin", "ugly", "undo", "unit", "urge", "user", "vast", "very", "veto", "vial",
    "vibe", "view", "visa", "void", "vows", "wall", "wand", "warm", "wasp", "wave", "waxy", "webs",
    "what", "when", "whiz", "wolf", "work", "yank", "yawn", "yell", "yoga", "yurt", "zaps", "zero",
    "zest", "zinc", "zone", "zoom",
];

const fn build_minimal_table() -> [u16; 256] {
    let mut table = [0u16; 256];
    let mut i = 0;
    while i < 256 {
        let word = WORDS[i].as_bytes();
        let first = word[0];
        let last = word[3];
        table[i] = ((first as u16) << 8) | (last as u16);
        i += 1;
    }
    table
}

pub static MINIMAL_PAIR_CODES: [u16; 256] = build_minimal_table();

pub fn lookup_minimal_pair(code: u16) -> Option<u8> {
    let mut i = 0;
    while i < 256 {
        if MINIMAL_PAIR_CODES[i] == code {
            return Some(i as u8);
        }
        i += 1;
    }
    None
}

pub fn decode_bytewords_minimal(text: &[u8]) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || text.len() < 10 {
        return None;
    }

    let len = text.len() / 2;
    let mut decoded = Vec::with_capacity(len);

    for i in 0..len {
        let c1 = text[i * 2].to_ascii_lowercase();
        let c2 = text[i * 2 + 1].to_ascii_lowercase();
        let code = ((c1 as u16) << 8) | (c2 as u16);
        let b = lookup_minimal_pair(code)?;
        decoded.push(b);
    }

    let payload_len = decoded.len() - 4;
    let body = &decoded[..payload_len];
    let expected = ((decoded[payload_len] as u32) << 24)
        | ((decoded[payload_len + 1] as u32) << 16)
        | ((decoded[payload_len + 2] as u32) << 8)
        | (decoded[payload_len + 3] as u32);

    if crc32::checksum(body) != expected {
        return None;
    }

    Some(body.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bytewords_decode_invalid() {
        assert!(decode_bytewords_minimal(b"short").is_none());
        assert!(decode_bytewords_minimal(b"invalidbytewordspair").is_none());
    }
}
