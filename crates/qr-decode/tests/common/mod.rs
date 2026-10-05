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

//! Shared by the integration tests: drawing encoder output into frames.

#![allow(dead_code)]

use qr_decode::image::Luma;
use qr_decode::transform::Projective;
use qr_decode::{decode, Options};
use qr_encode::{encode, parse_request};

/// xorshift32, so every run sees the same frames.
pub struct Rng(pub u32);

impl Rng {
    pub fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }

    pub fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }

    pub fn unit(&mut self) -> f32 {
        (self.next() >> 8) as f32 / (1u32 << 24) as f32
    }
}

pub struct Code {
    pub size: usize,
    pub modules: Vec<u8>,
}

pub fn code(text: &[u8], ecc: u8, version: u8, mask: u8) -> Code {
    let mut request = vec![ecc, version, mask, 0];
    request.extend_from_slice(text);
    let symbol = encode(&parse_request(&request).expect("request")).expect("encodes");
    Code {
        size: symbol.matrix.size,
        modules: symbol.matrix.modules.clone(),
    }
}

/// Draws `code` into a `width` x `height` frame: `corners` are where the
/// symbol's top-left, top-right, bottom-right and bottom-left corners land.
/// Each pixel averages a 3 x 3 grid of samples, like a camera's anti-aliasing.
pub fn draw(
    code: &Code,
    width: usize,
    height: usize,
    corners: [(f32, f32); 4],
    background: &mut [u8],
) {
    let n = code.size as f32;
    let to_module = Projective::quad_to_quad(corners, [(0.0, 0.0), (n, 0.0), (n, n), (0.0, n)]);
    for y in 0..height {
        for x in 0..width {
            let mut dark = 0u32;
            let mut inside = 0u32;
            for sy in 0..3 {
                for sx in 0..3 {
                    let (u, v) = to_module.apply(
                        x as f32 + (sx as f32 + 0.5) / 3.0,
                        y as f32 + (sy as f32 + 0.5) / 3.0,
                    );
                    // Four modules of quiet zone around the symbol.
                    if u >= -4.0 && v >= -4.0 && u < n + 4.0 && v < n + 4.0 {
                        inside += 1;
                        if u >= 0.0 && v >= 0.0 && u < n && v < n {
                            dark += u32::from(code.modules[v as usize * code.size + u as usize]);
                        }
                    }
                }
            }
            if inside > 0 {
                let light = background[y * width + x].max(200) as u32;
                let value = (light * (9 - dark) + 20 * dark) / 9;
                let value = (value * inside + background[y * width + x] as u32 * (9 - inside)) / 9;
                background[y * width + x] = value as u8;
            }
        }
    }
}

/// An axis-aligned code with a four-module quiet zone, `scale` pixels per module.
pub fn plain(code: &Code, scale: usize) -> Luma {
    let side = (code.size + 8) * scale;
    let mut data = vec![255u8; side * side];
    let (a, b) = ((4 * scale) as f32, ((code.size + 4) * scale) as f32);
    draw(
        code,
        side,
        side,
        [(a, a), (b, a), (b, b), (a, b)],
        &mut data,
    );
    Luma {
        width: side,
        height: side,
        data,
    }
}

pub fn read(luma: &Luma, options: &Options) -> Vec<Vec<u8>> {
    decode(luma, options)
        .into_iter()
        .map(|d| d.content.bytes)
        .collect()
}
