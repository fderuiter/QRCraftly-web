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

//! End-to-end tests: codes from the encoder (#1177) are drawn into frames,
//! distorted, and must decode to the same bytes.

mod common;

use common::{code, draw, plain, read, Rng};
use qr_decode::image::Luma;
use qr_decode::{decode, Options};

fn text(rng: &mut Rng, len: usize) -> Vec<u8> {
    const CHARS: &[u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /:.-_?=&%";
    (0..len)
        .map(|_| CHARS[rng.below(CHARS.len() as u32) as usize])
        .collect()
}

#[test]
fn every_version_and_level_round_trips() {
    let mut rng = Rng(0xC0DE);
    for version in 1..=40u8 {
        for ecc in 0..4u8 {
            // Fill about two thirds of the symbol so every block carries data.
            let capacity = qrcraftly_core::qr::data_codewords(
                version,
                qrcraftly_core::qr::Ecc::from_index(ecc).unwrap(),
            );
            let len = (capacity * 2 / 3).saturating_sub(4).max(1);
            let t = text(&mut rng, len);
            let mask = rng.below(8) as u8;
            let c = code(&t, ecc, version, mask);
            let luma = plain(&c, if version > 25 { 3 } else { 4 });
            let got = read(&luma, &Options::default());
            assert_eq!(
                got,
                vec![t.clone()],
                "version {version} level {ecc} mask {mask}"
            );
        }
    }
}

#[test]
fn rotations_round_trip() {
    let c = code(b"https://qrcraftly.com/wifi-qr-code", 1, 0, 8);
    let n = c.size as f32;
    let (w, h) = (360usize, 360usize);
    for step in 0..24 {
        let angle = step as f32 * 15.0f32.to_radians() + 0.1;
        let (s, co) = angle.sin_cos();
        let half = n * 5.0 / 2.0;
        let corner = |dx: f32, dy: f32| (180.0 + co * dx - s * dy, 180.0 + s * dx + co * dy);
        let corners = [
            corner(-half, -half),
            corner(half, -half),
            corner(half, half),
            corner(-half, half),
        ];
        let mut data = vec![235u8; w * h];
        draw(&c, w, h, corners, &mut data);
        let got = read(
            &Luma {
                width: w,
                height: h,
                data,
            },
            &Options::default(),
        );
        assert_eq!(
            got,
            vec![b"https://qrcraftly.com/wifi-qr-code".to_vec()],
            "angle step {step}"
        );
    }
}

#[test]
fn perspective_round_trips() {
    let mut rng = Rng(77);
    let payload = b"WIFI:T:WPA;S:QRCraftly guest;P:correct horse battery staple;;";
    let c = code(payload, 2, 0, 8);
    let (w, h) = (480usize, 480usize);
    let mut failures = 0;
    for round in 0..40 {
        let jitter = |rng: &mut Rng| (rng.unit() - 0.5) * 70.0;
        let corners = [
            (110.0 + jitter(&mut rng), 110.0 + jitter(&mut rng)),
            (370.0 + jitter(&mut rng), 110.0 + jitter(&mut rng)),
            (370.0 + jitter(&mut rng), 370.0 + jitter(&mut rng)),
            (110.0 + jitter(&mut rng), 370.0 + jitter(&mut rng)),
        ];
        let mut data = vec![240u8; w * h];
        draw(&c, w, h, corners, &mut data);
        let got = read(
            &Luma {
                width: w,
                height: h,
                data,
            },
            &Options::default(),
        );
        if got != vec![payload.to_vec()] {
            failures += 1;
            eprintln!("perspective round {round} failed: {corners:?}");
        }
    }
    assert!(failures <= 2, "{failures} of 40 perspective frames failed");
}

#[test]
fn noise_glare_and_low_contrast_round_trip() {
    let mut rng = Rng(5);
    let c = code(
        b"BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEND:VCARD",
        1,
        0,
        8,
    );
    let base = plain(&c, 5);
    let mut failures = 0;
    for _ in 0..20 {
        let mut luma = Luma {
            width: base.width,
            height: base.height,
            data: base.data.clone(),
        };
        let (gx, gy) = (
            rng.unit() * luma.width as f32,
            rng.unit() * luma.height as f32,
        );
        for y in 0..luma.height {
            for x in 0..luma.width {
                let v = luma.data[y * luma.width + x] as f32;
                // Squash contrast, add a soft highlight and per-pixel noise.
                let d = ((x as f32 - gx).powi(2) + (y as f32 - gy).powi(2)).sqrt();
                let glare = (60.0 - d / 4.0).max(0.0);
                let noise = (rng.unit() - 0.5) * 60.0;
                let out = 70.0 + v * 0.45 + glare + noise;
                luma.data[y * luma.width + x] = out.clamp(0.0, 255.0) as u8;
            }
        }
        if read(&luma, &Options::default()).is_empty() {
            failures += 1;
        }
    }
    assert!(failures <= 1, "{failures} of 20 noisy frames failed");
}

#[test]
fn light_on_dark_needs_the_inverted_pass() {
    let c = code(b"inverted", 0, 2, 3);
    let mut luma = plain(&c, 6);
    for v in &mut luma.data {
        *v = 255 - *v;
    }
    assert!(read(&luma, &Options::default()).is_empty());
    let options = Options {
        inverted: true,
        ..Options::default()
    };
    let found = decode(&luma, &options);
    assert_eq!(found.len(), 1);
    assert!(found[0].inverted);
    assert_eq!(found[0].content.bytes, b"inverted");
}

#[test]
fn mirrored_codes_read() {
    let c = code(b"mirror image", 1, 3, 1);
    let mut luma = plain(&c, 5);
    let w = luma.width;
    for row in luma.data.chunks_mut(w) {
        row.reverse();
    }
    let found = decode(&luma, &Options::default());
    assert_eq!(found.len(), 1);
    assert!(found[0].mirrored);
    assert_eq!(found[0].content.bytes, b"mirror image");
}

#[test]
fn several_codes_in_one_frame() {
    let payloads: [&[u8]; 4] = [b"tile 0", b"tile 1 of four", b"tile 2", b"tile three"];
    let (w, h) = (640usize, 640usize);
    let mut data = vec![250u8; w * h];
    for (i, p) in payloads.iter().enumerate() {
        let c = code(p, 1, 2, 8);
        let (ox, oy) = (40.0 + (i % 2) as f32 * 320.0, 40.0 + (i / 2) as f32 * 320.0);
        let side = c.size as f32 * 8.0;
        draw(
            &c,
            w,
            h,
            [
                (ox, oy),
                (ox + side, oy),
                (ox + side, oy + side),
                (ox, oy + side),
            ],
            &mut data,
        );
    }
    let luma = Luma {
        width: w,
        height: h,
        data,
    };
    let options = Options {
        max_codes: 6,
        ..Options::default()
    };
    let mut got = read(&luma, &options);
    got.sort();
    let mut want: Vec<Vec<u8>> = payloads.iter().map(|p| p.to_vec()).collect();
    want.sort();
    assert_eq!(got, want);
    assert_eq!(read(&luma, &Options::default()).len(), 1);
}

#[test]
fn reports_geometry() {
    let c = code(b"corners", 1, 1, 0);
    let luma = plain(&c, 10);
    let found = decode(&luma, &Options::default());
    let d = &found[0];
    let want = [(40.0, 40.0), (250.0, 40.0), (250.0, 250.0), (40.0, 250.0)];
    for (got, want) in d.corners.iter().zip(want) {
        assert!(
            (got.0 - want.0).abs() < 3.0 && (got.1 - want.1).abs() < 3.0,
            "{got:?} vs {want:?}"
        );
    }
    assert!((d.finders[0].0 - 75.0).abs() < 2.0 && (d.finders[0].1 - 75.0).abs() < 2.0);
    assert_eq!((d.version, d.ecc as u8, d.mask), (1, 1, 0));
}

#[test]
fn blank_and_random_frames_decode_nothing_and_never_panic() {
    let mut rng = Rng(42);
    for round in 0..60 {
        let w = 1 + rng.below(400) as usize;
        let h = 1 + rng.below(400) as usize;
        let data: Vec<u8> = match round % 3 {
            0 => vec![rng.below(256) as u8; w * h],
            1 => (0..w * h).map(|_| rng.below(256) as u8).collect(),
            _ => (0..w * h)
                .map(|i| {
                    if (i / (1 + rng.below(9) as usize)).is_multiple_of(2) {
                        0
                    } else {
                        255
                    }
                })
                .collect(),
        };
        let options = Options {
            dense: true,
            inverted: true,
            global: true,
            half: true,
            max_codes: 8,
        };
        let _ = decode(
            &Luma {
                width: w,
                height: h,
                data,
            },
            &options,
        );
    }
}

#[test]
fn damaged_codes_never_panic() {
    let mut rng = Rng(9);
    let c = code(b"https://qrcraftly.com/fuzz", 1, 0, 8);
    let base = plain(&c, 4);
    for _ in 0..200 {
        let mut data = base.data.clone();
        // Blot out rectangles and splash noise over the code.
        for _ in 0..1 + rng.below(6) {
            let (x0, y0) = (
                rng.below(base.width as u32) as usize,
                rng.below(base.height as u32) as usize,
            );
            let (bw, bh) = (1 + rng.below(40) as usize, 1 + rng.below(40) as usize);
            let v = rng.below(256) as u8;
            for y in y0..(y0 + bh).min(base.height) {
                for x in x0..(x0 + bw).min(base.width) {
                    data[y * base.width + x] = v;
                }
            }
        }
        let options = Options {
            dense: rng.below(2) == 0,
            inverted: true,
            global: true,
            half: true,
            max_codes: 1 + rng.below(8) as usize,
        };
        for d in decode(
            &Luma {
                width: base.width,
                height: base.height,
                data,
            },
            &options,
        ) {
            // Whatever decodes must be the real content: Reed-Solomon does not invent data.
            assert_eq!(d.content.bytes, b"https://qrcraftly.com/fuzz");
        }
    }
}
