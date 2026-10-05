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
//! The Prism fast path (#1178): tiles read from known corners, version and
//! level, without a search.

mod common;

use common::{code, draw, Rng};
use qr_decode::tracked::{decode_tracked, Pixels, Tile};
use qr_decode::{decode, qr_decode_capacity, qr_decode_tracked, Options, ANY_LEVEL, FLAG_INVERTED};
use qrcraftly_core::qr::Ecc;

fn grey(data: &[u8], width: usize, height: usize) -> Pixels<'_> {
    Pixels {
        width,
        height,
        channels: 1,
        data,
    }
}

fn tile(corners: [(f32, f32); 4], version: u8, ecc: Option<Ecc>) -> Tile {
    Tile {
        corners,
        version,
        ecc,
        inverted: false,
    }
}

/// A square symbol at `left`, `top`, `scale` pixels a module.
fn square(left: f32, top: f32, size: usize, scale: f32) -> [(f32, f32); 4] {
    let s = size as f32 * scale;
    [
        (left, top),
        (left + s, top),
        (left + s, top + s),
        (left, top + s),
    ]
}

#[test]
fn every_version_and_level_reads_from_its_corners() {
    let mut rng = Rng(0x7A11);
    for version in 1..=40u8 {
        for ecc in 0..4u8 {
            let level = Ecc::from_index(ecc).unwrap();
            let len = (qrcraftly_core::qr::data_codewords(version, level) / 2).max(1);
            let text: Vec<u8> = (0..len).map(|_| b'a' + rng.below(26) as u8).collect();
            let c = code(&text, ecc, version, rng.below(8) as u8);
            let scale = 3.0;
            let side = ((c.size + 8) as f32 * scale) as usize;
            let mut data = vec![255u8; side * side];
            let corners = square(4.0 * scale, 4.0 * scale, c.size, scale);
            draw(&c, side, side, corners, &mut data);
            let pixels = grey(&data, side, side);
            let found = decode_tracked(&pixels, &tile(corners, version, Some(level)))
                .unwrap_or_else(|| panic!("version {version} level {ecc}"));
            assert_eq!(found.content.bytes, text);
            assert_eq!((found.version, found.ecc), (version, level));
            assert!(decode_tracked(&pixels, &tile(corners, version, None)).is_some());
        }
    }
}

#[test]
fn reads_a_skewed_tile_from_rough_corners() {
    let c = code(b"https://qrcraftly.com/prism/tile/3", 1, 6, 8);
    let n = c.size as f32;
    let (w, h) = (420usize, 380usize);
    let corners = [
        (52.0, 40.0),
        (52.0 + n * 7.0, 58.0),
        (40.0 + n * 7.2, 50.0 + n * 7.1),
        (60.0, 30.0 + n * 6.6),
    ];
    let mut data = vec![230u8; w * h];
    draw(&c, w, h, corners, &mut data);
    let pixels = grey(&data, w, h);
    let mut rng = Rng(9);
    for _ in 0..20 {
        // A tracker's corners are a fraction of a module out.
        let rough =
            corners.map(|(x, y)| (x + (rng.unit() - 0.5) * 5.0, y + (rng.unit() - 0.5) * 5.0));
        let found = decode_tracked(&pixels, &tile(rough, 6, Some(Ecc::M))).expect("reads");
        assert_eq!(found.content.bytes, b"https://qrcraftly.com/prism/tile/3");
        assert_eq!(found.corners, rough);
    }
}

#[test]
fn reads_each_tile_of_a_mosaic() {
    // Prism lays out four to six tiles in a frame; each is read from its own corners.
    let (w, h) = (640usize, 440usize);
    let mut data = vec![255u8; w * h];
    let mut tiles = Vec::new();
    for i in 0..6 {
        let text = format!("tile {i} of six");
        let c = code(text.as_bytes(), 0, 5, 8);
        let corners = square(
            16.0 + (i % 3) as f32 * 210.0,
            16.0 + (i / 3) as f32 * 210.0,
            c.size,
            4.6,
        );
        draw(&c, w, h, corners, &mut data);
        tiles.push((text, corners));
    }
    let pixels = grey(&data, w, h);
    for (text, corners) in tiles {
        let found = decode_tracked(&pixels, &tile(corners, 5, Some(Ecc::L))).expect("reads");
        assert_eq!(found.content.bytes, text.as_bytes());
    }
}

#[test]
fn a_wrong_version_level_or_place_reads_nothing() {
    let c = code(b"strict", 2, 4, 8);
    let scale = 4.0;
    let side = (c.size + 8) * 4;
    let mut data = vec![255u8; side * side];
    let corners = square(16.0, 16.0, c.size, scale);
    draw(&c, side, side, corners, &mut data);
    let pixels = grey(&data, side, side);
    assert!(decode_tracked(&pixels, &tile(corners, 4, Some(Ecc::Q))).is_some());
    assert!(decode_tracked(&pixels, &tile(corners, 5, Some(Ecc::Q))).is_none());
    assert!(decode_tracked(&pixels, &tile(corners, 4, Some(Ecc::H))).is_none());
    let moved = corners.map(|(x, y)| (x + 3.0 * scale, y));
    assert!(decode_tracked(&pixels, &tile(moved, 4, None)).is_none());
    let off = corners.map(|(x, y)| (x + side as f32, y));
    assert!(decode_tracked(&pixels, &tile(off, 4, None)).is_none());
    let blank = vec![128u8; side * side];
    assert!(decode_tracked(&grey(&blank, side, side), &tile(corners, 4, None)).is_none());
}

#[test]
fn light_on_dark_and_mirrored_tiles() {
    let c = code(b"inverted tile", 1, 3, 2);
    let scale = 4.0;
    let side = (c.size + 8) * 4;
    let corners = square(16.0, 16.0, c.size, scale);
    let mut data = vec![255u8; side * side];
    draw(&c, side, side, corners, &mut data);
    let negative: Vec<u8> = data.iter().map(|v| 255 - v).collect();
    let mut t = tile(corners, 3, Some(Ecc::M));
    assert!(decode_tracked(&grey(&negative, side, side), &t).is_none());
    t.inverted = true;
    let found = decode_tracked(&grey(&negative, side, side), &t).expect("reads");
    assert!(found.inverted);
    assert_eq!(found.content.bytes, b"inverted tile");

    // Mirrored: the symbol's top-right corner is drawn where the bottom-left would be.
    let [tl, tr, br, bl] = corners;
    let mut mirrored = vec![255u8; side * side];
    draw(&c, side, side, [tl, bl, br, tr], &mut mirrored);
    let found =
        decode_tracked(&grey(&mirrored, side, side), &tile(corners, 3, None)).expect("reads");
    assert!(found.mirrored);
    assert_eq!(found.content.bytes, b"inverted tile");
}

/// One tile of a tracked request: version, level, flags and corners.
type TileRecord = (u8, u8, u8, [(f32, f32); 4]);

/// A tracked request for `qr_decode_tracked`.
fn request(
    (width, height, channels): (u32, u32, u8),
    tiles: &[TileRecord],
    pixels: &[u8],
) -> Vec<u8> {
    let mut r = Vec::new();
    r.extend_from_slice(&width.to_le_bytes());
    r.extend_from_slice(&height.to_le_bytes());
    r.extend_from_slice(&[channels, 0, tiles.len() as u8, 0]);
    for &(version, level, flags, corners) in tiles {
        r.extend_from_slice(&[version, level, flags, 0]);
        for (x, y) in corners {
            r.extend_from_slice(&x.to_le_bytes());
            r.extend_from_slice(&y.to_le_bytes());
        }
    }
    r.extend_from_slice(pixels);
    r
}

fn call(request: &[u8]) -> (i32, Vec<u8>) {
    let mut out = vec![0u8; qr_decode_capacity(8)];
    // SAFETY: both slices are valid for their lengths.
    let status =
        unsafe { qr_decode_tracked(request.as_ptr(), request.len(), out.as_mut_ptr(), out.len()) };
    (status, out)
}

#[test]
fn the_export_reads_rgba_and_rejects_bad_requests() {
    let c = code(b"export", 0, 2, 8);
    let side = (c.size + 8) * 4;
    let corners = square(16.0, 16.0, c.size, 4.0);
    let mut data = vec![255u8; side * side];
    draw(&c, side, side, corners, &mut data);
    let rgba: Vec<u8> = data.iter().flat_map(|&v| [v, v, v, 255]).collect();
    let frame = (side as u32, side as u32, 4);
    let valid = request(frame, &[(2, ANY_LEVEL, FLAG_INVERTED, corners)], &rgba);
    let (status, out) = call(&valid);
    assert_eq!((status, out[0], out[4]), (0, 1, 2));
    // One record per tile, in order: a tile that misses is a record of zeros.
    let (status, out) = call(&request(
        frame,
        &[(3, ANY_LEVEL, 0, corners), (2, 0, 0, corners)],
        &rgba,
    ));
    assert_eq!((status, out[0]), (0, 2));
    assert!(out[4..84].iter().all(|&b| b == 0));
    assert_eq!(out[84], 2);

    let bad = [
        request((side as u32, side as u32, 3), &[(2, 0, 0, corners)], &rgba),
        request(frame, &[(2, 0, 1, corners)], &rgba),
        request(frame, &[(0, 0, 0, corners)], &rgba),
        request(frame, &[(41, 0, 0, corners)], &rgba),
        request(frame, &[(2, 4, 0, corners)], &rgba),
        request(frame, &[(2, 0, 0, [(f32::NAN, 0.0); 4])], &rgba),
        request(frame, &[(2, 0, 0, [(1e9, 0.0); 4])], &rgba),
        request(frame, &[(2, 0, 0, corners)], &rgba[1..]),
        request(frame, &[], &rgba),
        request(frame, &[(2, 0, 0, corners); 9], &rgba),
        request((0, side as u32, 4), &[(2, 0, 0, corners)], &[]),
    ];
    for r in bad {
        assert_ne!(call(&r).0, 0);
    }
    // A too-small output buffer is reported, not overrun.
    let mut out = vec![0u8; 8];
    // SAFETY: both slices are valid for their lengths.
    let status =
        unsafe { qr_decode_tracked(valid.as_ptr(), valid.len(), out.as_mut_ptr(), out.len()) };
    assert_ne!(status, 0);

    let mut rng = Rng(0xFA57);
    for round in 0..400 {
        let mut r = valid.clone();
        for _ in 0..1 + rng.below(6) {
            let at = if round % 2 == 0 {
                rng.below(48)
            } else {
                rng.below(r.len() as u32)
            } as usize;
            r[at] = rng.below(256) as u8;
        }
        if round % 9 == 0 {
            r.truncate(rng.below(r.len() as u32 + 1) as usize);
        }
        call(&r);
    }
}

#[test]
fn faster_than_a_full_decode_of_the_same_tile() {
    // Release builds only: debug timings say little. The bench (`pnpm run
    // bench:transfer`) records the numbers; this guards the order of magnitude.
    if cfg!(debug_assertions) {
        return;
    }
    let c = code(
        b"https://qrcraftly.com/prism/0123456789abcdef0123456789abcdef",
        1,
        10,
        8,
    );
    // One tile in a VGA camera frame, as Prism sees it.
    let (w, h) = (640usize, 480usize);
    let corners = square(180.0, 100.0, c.size, 4.0);
    let mut data = vec![240u8; w * h];
    draw(&c, w, h, corners, &mut data);
    let luma = qr_decode::image::Luma {
        width: w,
        height: h,
        data: data.clone(),
    };
    let pixels = grey(&data, w, h);
    let t = tile(corners, 10, Some(Ecc::M));
    let time = |f: &dyn Fn() -> bool| {
        let start = std::time::Instant::now();
        for _ in 0..50 {
            assert!(f());
        }
        start.elapsed()
    };
    let full = time(&|| !decode(&luma, &Options::default()).is_empty());
    let fast = time(&|| decode_tracked(&pixels, &t).is_some());
    assert!(
        fast * 3 <= full,
        "fast path {fast:?} vs full decode {full:?}"
    );
}
