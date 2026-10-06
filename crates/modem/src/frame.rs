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

//! Acquiring a frame (ADR 0028): the fiducials, then the header against each
//! known geometry and each of the four ways the fiducials could be numbered,
//! then the live palette.

use crate::colour::luma;
use crate::constellation;
use crate::layout::{Grid, HEADER_BITS};
use crate::locate::{locate_fiducials, solve_homography, Fiducials, Scratch};
use crate::rs;
use crate::sample::{read_patch, reference_midpoint, sample_cell};
use crate::Image;

/// First byte of every header.
pub const HEADER_MAGIC: u8 = 0xb7;
/// The format version this build reads.
pub const MODEM_VERSION: u8 = 1;
/// Message bytes in a header.
pub const HEADER_MESSAGE_BYTES: usize = 18;
/// Check bytes in a header.
pub const HEADER_PARITY: usize = 24;
/// Bytes in the header codeword.
pub const HEADER_CODEWORD_BYTES: usize = HEADER_MESSAGE_BYTES + HEADER_PARITY;
/// Smallest luma step between the black and white patches.
const MIN_CONTRAST: i32 = 48;

/// Why a frame could not be acquired, as the export reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    NoFiducials = 1,
    NoHeader = 2,
    LowContrast = 3,
    UnsupportedVersion = 4,
    UnknownConstellation = 5,
}

/// An acquired frame: its header message, the homography as `f32` and the palette.
#[derive(Clone, Copy, Debug)]
pub struct Acquired {
    pub header: [u8; HEADER_MESSAGE_BYTES],
    pub homography: [f32; 9],
    /// Red, green and blue of each symbol.
    pub palette: [i32; 3 * constellation::MAX_SYMBOLS],
    pub symbols: usize,
}

fn homography_for(
    points: &[crate::locate::Point; 4],
    grid: &Grid,
    rotation: usize,
) -> Option<[f32; 9]> {
    // Clockwise on screen: top-left, top-right, bottom-right, bottom-left.
    let ideal = [
        grid.fiducial_centre(0),
        grid.fiducial_centre(1),
        grid.fiducial_centre(3),
        grid.fiducial_centre(2),
    ];
    let target = [0, 1, 2, 3].map(|i| points[(i + rotation) % 4]);
    solve_homography(&ideal, &target).map(|h| h.map(|v| v as f32))
}

fn read_header_codeword(
    image: &Image,
    h: &[f32; 9],
    grid: &Grid,
    midpoint: i32,
    strips: &[bool],
) -> [u8; HEADER_CODEWORD_BYTES] {
    let mut votes = [0i32; HEADER_BITS];
    for &bottom in strips {
        for t in 0..grid.header_cells() {
            let (col, row) = grid.header_cell(t, bottom);
            let cell = sample_cell(image, h, col as f64, row as f64);
            votes[t as usize % HEADER_BITS] += luma(cell[0], cell[1], cell[2]) as i32 - midpoint;
        }
    }
    let mut codeword = [0u8; HEADER_CODEWORD_BYTES];
    for (bit, &vote) in votes.iter().enumerate() {
        if vote > 0 {
            codeword[bit >> 3] |= 0x80 >> (bit & 7);
        }
    }
    codeword
}

/// Repairs a header codeword; the message, or `None` when the code cannot
/// repair it or the magic byte is wrong.
pub fn decode_header(codeword: &[u8; HEADER_CODEWORD_BYTES]) -> Option<[u8; HEADER_MESSAGE_BYTES]> {
    let mut word = *codeword;
    rs::decode(&mut word, HEADER_PARITY, &[])?;
    if word[0] != HEADER_MAGIC {
        return None;
    }
    let mut message = [0u8; HEADER_MESSAGE_BYTES];
    message.copy_from_slice(&word[..HEADER_MESSAGE_BYTES]);
    Some(message)
}

/// The `cols` and `rows` fields of a header message.
fn header_grid(message: &[u8; HEADER_MESSAGE_BYTES]) -> (u32, u32) {
    (
        u16::from_be_bytes([message[12], message[13]]) as u32,
        u16::from_be_bytes([message[14], message[15]]) as u32,
    )
}

/// What [`acquire`] found.
pub struct Acquisition {
    pub fiducials: Option<Fiducials>,
    pub result: Result<Acquired, Failure>,
}

/// Finds a frame in a captured image. `geometries` must already be checked.
pub fn acquire(image: &Image, geometries: &[Grid], scratch: &mut Scratch) -> Acquisition {
    let Some(fiducials) = locate_fiducials(image, scratch) else {
        return Acquisition {
            fiducials: None,
            result: Err(Failure::NoFiducials),
        };
    };
    let done = |result| Acquisition {
        fiducials: Some(fiducials),
        result,
    };
    let mut saw_contrast = false;
    for rotation in 0..4 {
        for grid in geometries {
            let Some(h) = homography_for(&fiducials.points, grid, rotation) else {
                continue;
            };
            let black = read_patch(image, &h, grid, 0);
            let white = read_patch(image, &h, grid, 1);
            let contrast = luma(white[0] as u32, white[1] as u32, white[2] as u32) as i32
                - luma(black[0] as u32, black[1] as u32, black[2] as u32) as i32;
            if contrast < MIN_CONTRAST {
                continue;
            }
            saw_contrast = true;
            // A screen refresh during readout leaves different headers in the two strips, so
            // each is tried alone before both together.
            let midpoint = reference_midpoint(&black, &white);
            let mut header = None;
            for strips in [&[false][..], &[true][..], &[false, true][..]] {
                header = decode_header(&read_header_codeword(image, &h, grid, midpoint, strips));
                if header.is_some() {
                    break;
                }
            }
            let Some(message) = header else {
                continue;
            };
            if header_grid(&message) != (grid.cols, grid.rows) {
                continue;
            }
            if message[1] >> 4 != MODEM_VERSION {
                return done(Err(Failure::UnsupportedVersion));
            }
            let Some(bits) = constellation::bits_of(message[2] as u32) else {
                return done(Err(Failure::UnknownConstellation));
            };
            let symbols = 1usize << bits;
            let mut palette = [0i32; 3 * constellation::MAX_SYMBOLS];
            for s in 0..symbols {
                palette[s * 3..s * 3 + 3].copy_from_slice(&read_patch(
                    image,
                    &h,
                    grid,
                    2 + s as u32,
                ));
            }
            return done(Ok(Acquired {
                header: message,
                homography: h,
                palette,
                symbols,
            }));
        }
    }
    done(Err(if saw_contrast {
        Failure::NoHeader
    } else {
        Failure::LowContrast
    }))
}
