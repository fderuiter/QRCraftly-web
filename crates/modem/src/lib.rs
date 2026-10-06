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

//! QRCraftly Optical's kernels (#1198): everything the colour modem
//! (`src/packages/optical-modem`) and the colour layer of the QR transfer
//! (`src/packages/optical-transfer`) compute per frame. The TypeScript side
//! keeps the shell: drawing frames, the channel simulator, the GPU kernel,
//! the camera and the profile ladder.
//!
//! - [`locate`]: the corner fiducials and the homography.
//! - [`sample`]: the per-cell decode kernel (the constellation slicer).
//! - [`frame`]: acquiring a frame and reading its header.
//! - [`codec`] and [`rs`]: the frame codec over the shared Reed-Solomon code.
//! - [`constellation`]: the symbol colours.
//! - [`probe`]: the channel probe's per-frame analysis.
//! - [`crosstalk`]: colour cross-talk unmixing.
//!
//! Every call goes through a receiver, `Rx`, made once with `modem_rx_new`.
//! It owns every buffer the kernels use and keeps them from frame to frame,
//! so nothing is allocated per frame once the largest frame has been seen
//! (the module's allocator only reclaims memory when everything is freed).
//! The caller writes into and reads from these buffers:
//!
//! - the image (`modem_rx_image`): RGBA pixels, row by row;
//! - `input` and `output` (`modem_rx_input`, `modem_rx_output`): bytes;
//! - the grid (`modem_rx_grid`): per data cell a symbol, then per cell a
//!   confidence, then per cell three mean bytes;
//! - the state (`modem_rx_state`): a probe pattern's running totals;
//! - `io` (`modem_rx_io`): 256 `f64` for small numbers. Slots 0 to 7 hold the
//!   fiducial centres, 8 to 11 their core areas, 12 to 20 the homography (as
//!   `f32` values), 21 to 68 the palette (red, green, blue per symbol), 72 to
//!   127 a call's other results and 128 to 255 a call's other arguments.
//!
//! Integer arithmetic decides what a receiver reads; coordinates use `f32`
//! steps in a fixed order and the rest `f64` in the order the TypeScript
//! receiver used, so every engine gives the same bits.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod codec;
pub mod colour;
pub mod constellation;
pub mod crosstalk;
pub mod fmath;
pub mod frame;
pub mod layout;
pub mod locate;
pub mod probe;
pub mod rs;
pub mod sample;

use alloc::boxed::Box;
use alloc::vec::Vec;

use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_OK};

use crate::layout::{Grid, BAND_ROWS};

/// RGBA pixels, laid out like a canvas `ImageData`.
pub struct Image<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
}

/// `io` slot of the four fiducial centres (x, y pairs).
pub const IO_FIDUCIALS: usize = 0;
/// `io` slot of the four core areas.
pub const IO_CORES: usize = 8;
/// `io` slot of the homography, nine values.
pub const IO_HOMOGRAPHY: usize = 12;
/// `io` slot of the palette, three values per symbol.
pub const IO_PALETTE: usize = 21;
/// `io` slot of a call's other results.
pub const IO_OUT: usize = 72;
/// `io` slot of a call's other arguments.
pub const IO_IN: usize = 128;

/// Widest or tallest image accepted.
const MAX_SIDE: usize = 8192;
/// Most pixels in one image.
const MAX_PIXELS: usize = 1 << 25;

/// One receiver: every buffer the kernels use, kept from call to call.
pub struct Rx {
    io: [f64; 256],
    image: Vec<u8>,
    width: usize,
    height: usize,
    input: Vec<u8>,
    output: Vec<u8>,
    grid: Vec<u8>,
    state: Vec<f64>,
    header: [u8; frame::HEADER_MESSAGE_BYTES],
    locate: locate::Scratch,
    decode: codec::DecodeScratch,
    stream: Vec<u8>,
    message: Vec<u8>,
}

impl Rx {
    fn new() -> Rx {
        Rx {
            io: [0.0; 256],
            image: Vec::new(),
            width: 0,
            height: 0,
            input: Vec::new(),
            output: Vec::new(),
            grid: Vec::new(),
            state: Vec::new(),
            header: [0; frame::HEADER_MESSAGE_BYTES],
            locate: locate::Scratch::default(),
            decode: codec::DecodeScratch::default(),
            stream: Vec::new(),
            message: Vec::new(),
        }
    }

    fn image(&self) -> Image<'_> {
        Image {
            data: &self.image,
            width: self.width,
            height: self.height,
        }
    }

    fn homography(&self) -> [f32; 9] {
        core::array::from_fn(|i| self.io[IO_HOMOGRAPHY + i] as f32)
    }

    fn has_image(&self) -> bool {
        self.width > 0 && self.height > 0
    }
}

/// Resizes a buffer to exactly `len` items, keeping its capacity, and returns it.
fn sized<T: Copy + Default>(buffer: &mut Vec<T>, len: usize) -> &mut [T] {
    if buffer.len() < len {
        buffer.resize(len, T::default());
    } else {
        buffer.truncate(len);
    }
    &mut buffer[..]
}

/// # Safety
/// `rx` is null or came from [`modem_rx_new`] and was not freed.
unsafe fn rx_mut<'a>(rx: *mut Rx) -> Option<&'a mut Rx> {
    // SAFETY: guaranteed by the caller.
    unsafe { rx.as_mut() }
}

/// Creates a receiver.
#[no_mangle]
pub extern "C" fn modem_rx_new() -> *mut Rx {
    Box::into_raw(Box::new(Rx::new()))
}

/// Releases a receiver.
///
/// # Safety
/// `rx` is null or came from [`modem_rx_new`] and was not freed.
#[no_mangle]
pub unsafe extern "C" fn modem_rx_free(rx: *mut Rx) {
    if !rx.is_null() {
        // SAFETY: guaranteed by the caller.
        drop(unsafe { Box::from_raw(rx) });
    }
}

/// The 256 `f64` of `io`.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_io(rx: *mut Rx) -> *mut f64 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) => rx.io.as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// Makes room for a `width` by `height` RGBA image and returns where to
/// write it, or null for a size out of range.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_image(rx: *mut Rx, width: usize, height: usize) -> *mut u8 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return core::ptr::null_mut();
    };
    if width == 0
        || height == 0
        || width > MAX_SIDE
        || height > MAX_SIDE
        || width * height > MAX_PIXELS
    {
        rx.width = 0;
        rx.height = 0;
        return core::ptr::null_mut();
    }
    rx.width = width;
    rx.height = height;
    sized(&mut rx.image, width * height * 4).as_mut_ptr()
}

/// Makes `input` `len` bytes long and returns where to write it.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_input(rx: *mut Rx, len: usize) -> *mut u8 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) if len <= MAX_PIXELS * 4 => sized(&mut rx.input, len).as_mut_ptr(),
        _ => core::ptr::null_mut(),
    }
}

/// Where the last call's `output` is.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_output(rx: *mut Rx) -> *const u8 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) => rx.output.as_ptr(),
        None => core::ptr::null(),
    }
}

/// Makes the grid hold `cells` cells (five bytes each) and returns it.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_grid(rx: *mut Rx, cells: usize) -> *mut u8 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) if cells <= MAX_PIXELS => sized(&mut rx.grid, cells * 5).as_mut_ptr(),
        _ => core::ptr::null_mut(),
    }
}

/// Makes the state hold `len` values and returns it.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_state(rx: *mut Rx, len: usize) -> *mut f64 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) if len <= 1 << 16 => sized(&mut rx.state, len).as_mut_ptr(),
        _ => core::ptr::null_mut(),
    }
}

/// The 18 message bytes of the last header [`modem_rx_acquire`] read.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_header(rx: *mut Rx) -> *const u8 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) => rx.header.as_ptr(),
        None => core::ptr::null(),
    }
}

/// Finds a frame in the image. The geometries to try are `count` pairs of
/// columns and rows at `io[128..]`. Returns 0 when a frame was acquired (the
/// header message, homography and palette are then filled in), 1 for no
/// fiducials, 2 for no header, 3 for low contrast, 4 for an unsupported
/// version, 5 for an unknown constellation and -1 for bad arguments. The
/// fiducials are filled in whenever they were found; the core areas are -1
/// otherwise.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_acquire(rx: *mut Rx, count: usize) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return -1;
    };
    if !rx.has_image() || count == 0 || count > 64 {
        return -1;
    }
    let mut geometries = [Grid { cols: 0, rows: 0 }; 64];
    for (i, slot) in geometries.iter_mut().enumerate().take(count) {
        let (cols, rows) = (rx.io[IO_IN + 2 * i], rx.io[IO_IN + 2 * i + 1]);
        match Grid::new(cols as u32, rows as u32) {
            Some(grid) if cols == grid.cols as f64 && rows == grid.rows as f64 => *slot = grid,
            _ => return -1,
        }
    }
    let image = Image {
        data: &rx.image,
        width: rx.width,
        height: rx.height,
    };
    let found = frame::acquire(&image, &geometries[..count], &mut rx.locate);
    match found.fiducials {
        Some(fiducials) => {
            for (i, p) in fiducials.points.iter().enumerate() {
                rx.io[IO_FIDUCIALS + 2 * i] = p.x;
                rx.io[IO_FIDUCIALS + 2 * i + 1] = p.y;
            }
            for (i, &area) in fiducials.core_areas.iter().enumerate() {
                rx.io[IO_CORES + i] = area as f64;
            }
        }
        None => rx.io[IO_CORES..IO_CORES + 4].fill(-1.0),
    }
    match found.result {
        Ok(acquired) => {
            rx.header = acquired.header;
            for (i, &v) in acquired.homography.iter().enumerate() {
                rx.io[IO_HOMOGRAPHY + i] = v as f64;
            }
            for (i, &v) in acquired.palette[..acquired.symbols * 3].iter().enumerate() {
                rx.io[IO_PALETTE + i] = v as f64;
            }
            0
        }
        Err(failure) => failure as i32,
    }
}

/// Runs the decode kernel over the image: `symbols` palette colours at
/// `io[21..]`, the homography at `io[12..]`, `cols` cells across,
/// `data_rows` rows from frame row `row_offset`. The grid gets the result.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rx_sample(
    rx: *mut Rx,
    cols: u32,
    data_rows: u32,
    row_offset: u32,
    symbols: u32,
) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    let cells = cols as usize * data_rows as usize;
    if !rx.has_image() || cols == 0 || cells > MAX_PIXELS || !(1..=16).contains(&symbols) {
        return STATUS_BAD_INPUT;
    }
    let h = rx.homography();
    let mut palette = [0i32; 48];
    for (i, v) in palette.iter_mut().enumerate().take(symbols as usize * 3) {
        *v = rx.io[IO_PALETTE + i] as i32;
    }
    let grid = sized(&mut rx.grid, cells * 5);
    let (symbol_out, rest) = grid.split_at_mut(cells);
    let (confidence, means) = rest.split_at_mut(cells);
    let image = Image {
        data: &rx.image,
        width: rx.width,
        height: rx.height,
    };
    sample::sample_grid(
        &image,
        &h,
        cols,
        row_offset,
        &palette[..symbols as usize * 3],
        symbol_out,
        confidence,
        means,
    );
    STATUS_OK
}

/// Decodes every block of a frame from the grid. `threshold` below 0
/// decodes hard. `output` gets a flag per block, then each block's data
/// (zero for a block that failed); `io[72..75]` get the blocks repaired, the
/// erasures used and the bytes repaired.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn modem_rx_decode(
    rx: *mut Rx,
    bits: u32,
    cols: u32,
    rows: u32,
    packet_bytes: u32,
    parity: u32,
    session: u32,
    seq: u32,
    threshold: f64,
) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    let Some(capacity) = codec::Capacity::new(bits, cols, rows, packet_bytes, parity) else {
        return STATUS_BAD_INPUT;
    };
    let cells = capacity.data_cells;
    if rx.grid.len() != cells * 5 {
        return STATUS_BAD_INPUT;
    }
    let output = sized(&mut rx.output, capacity.blocks + capacity.payload_bytes());
    let (ok, data) = output.split_at_mut(capacity.blocks);
    let threshold = if threshold >= 0.0 {
        Some(threshold)
    } else {
        None
    };
    let decoded = codec::decode(
        &capacity,
        &rx.grid[..cells],
        &rx.grid[cells..2 * cells],
        session,
        seq,
        threshold,
        ok,
        data,
        &mut rx.decode,
    );
    rx.io[IO_OUT] = decoded.blocks_ok as f64;
    rx.io[IO_OUT + 1] = decoded.erasures as f64;
    rx.io[IO_OUT + 2] = decoded.corrected as f64;
    STATUS_OK
}

/// Encodes one frame's data cells from the `payload_len` bytes in `input`;
/// `output` gets one symbol per data cell.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn modem_frame_encode(
    rx: *mut Rx,
    bits: u32,
    cols: u32,
    rows: u32,
    packet_bytes: u32,
    parity: u32,
    session: u32,
    seq: u32,
) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    let Some(capacity) = codec::Capacity::new(bits, cols, rows, packet_bytes, parity) else {
        return STATUS_BAD_INPUT;
    };
    let symbols = sized(&mut rx.output, capacity.data_cells);
    if codec::encode(
        &capacity,
        &rx.input,
        session,
        seq,
        symbols,
        &mut rx.stream,
        &mut rx.message,
    ) {
        STATUS_OK
    } else {
        STATUS_BAD_INPUT
    }
}

/// Reed-Solomon encodes the message in `input` with `parity` check bytes into `output`.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rs_encode(rx: *mut Rx, parity: u32) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    let n = rx.input.len() + parity as usize;
    if n > 255 {
        return STATUS_BAD_INPUT;
    }
    let out = sized(&mut rx.output, n);
    if rs::encode(&rx.input, parity as usize, out) {
        STATUS_OK
    } else {
        STATUS_BAD_INPUT
    }
}

/// Reed-Solomon decodes the `len`-byte codeword at the start of `input`; the
/// rest of `input` lists erased positions, a byte each. `output` gets the
/// message. Returns the positions repaired, or -1 when the codeword is beyond
/// the code or the arguments are out of range.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_rs_decode(rx: *mut Rx, len: u32, parity: u32) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return -1;
    };
    let (len, parity) = (len as usize, parity as usize);
    if len > 255 || len > rx.input.len() || parity > len {
        return -1;
    }
    let (word_in, erased) = rx.input.split_at(len);
    let mut erasures = [0usize; 255];
    if erased.len() > 255 {
        return -1;
    }
    for (slot, &e) in erasures.iter_mut().zip(erased) {
        *slot = e as usize;
    }
    let mut word = [0u8; 255];
    word[..len].copy_from_slice(word_in);
    match rs::decode(&mut word[..len], parity, &erasures[..erased.len()]) {
        Some(repaired) => {
            sized(&mut rx.output, len - parity).copy_from_slice(&word[..len - parity]);
            repaired as i32
        }
        None => -1,
    }
}

/// Writes the colours of constellation `id` to `io[72..]` (red, green, blue
/// per symbol) and its smallest OKLab gap to `io[120]`. Returns the symbol
/// count, or 0 for an unknown id.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_constellation(rx: *mut Rx, id: u32) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return 0;
    };
    let Some((symbols, size, min_distance)) = constellation::constellation(id) else {
        return 0;
    };
    for (s, rgb) in symbols[..size].iter().enumerate() {
        for (c, &level) in rgb.iter().enumerate() {
            rx.io[IO_OUT + s * 3 + c] = level as f64;
        }
    }
    rx.io[IO_OUT + 48] = min_distance;
    size as i32
}

/// Solves the homography through the four cell coordinates (u, v pairs) at
/// `io[128..136]` and the four image points (x, y pairs) at `io[136..144]`
/// into `io[72..81]`. Returns 1, or 0 when the points are degenerate.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_homography(rx: *mut Rx) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return 0;
    };
    let io = &rx.io;
    let source = core::array::from_fn(|i| (io[IO_IN + 2 * i], io[IO_IN + 2 * i + 1]));
    let target = core::array::from_fn(|i| locate::Point {
        x: io[IO_IN + 8 + 2 * i],
        y: io[IO_IN + 8 + 2 * i + 1],
    });
    match locate::solve_homography(&source, &target) {
        Some(h) => {
            rx.io[IO_OUT..IO_OUT + 9].copy_from_slice(&h);
            1
        }
        None => 0,
    }
}

/// Sorts one probe grid frame (the grid against the two variants' symbols,
/// one after the other in `input`) and adds a clean frame's cells to the
/// state (`probe::grid_state_len(size)` values). Returns 0 clean, 1 torn,
/// 2 blended or -1 for bad arguments; `io[72]` gets a clean frame's mean confidence.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_probe_grid(
    rx: *mut Rx,
    cols: u32,
    data_rows: u32,
    size: u32,
) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return -1;
    };
    let cells = cols as usize * data_rows as usize;
    let size = size as usize;
    if cols == 0
        || !(2..=16).contains(&size)
        || rx.grid.len() != cells * 5
        || rx.input.len() != cells * 2
        || rx.state.len() != probe::grid_state_len(size)
        || rx.grid[..cells]
            .iter()
            .chain(&rx.input)
            .any(|&s| s as usize >= size)
    {
        return -1;
    }
    let (own, other) = rx.input.split_at(cells);
    let (status, confidence) = probe::ingest_grid(
        &rx.grid[..cells],
        &rx.grid[cells..2 * cells],
        &rx.grid[2 * cells..],
        own,
        other,
        cols as usize,
        data_rows as usize,
        size,
        &mut rx.state,
    );
    rx.io[IO_OUT] = confidence;
    status as i32
}

/// The mean colour of the grid's `cells` cells, in OKLab, into `io[72..75]`.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_probe_flicker(rx: *mut Rx, cells: u32) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    let cells = cells as usize;
    if cells == 0 || rx.grid.len() != cells * 5 {
        return STATUS_BAD_INPUT;
    }
    let lab = probe::flicker_colour(&rx.grid[2 * cells..]);
    rx.io[IO_OUT..IO_OUT + 3].copy_from_slice(&lab);
    STATUS_OK
}

/// Measures the slanted edge of a `cols` by `rows` probe frame through the
/// homography at `io[12..]`: the line spread deviation and MTF50 into
/// `io[72..74]`. Returns 1, or 0 when the edge was not found.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_probe_edge(rx: *mut Rx, cols: u32, rows: u32) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return 0;
    };
    if !rx.has_image() || rows < 2 * BAND_ROWS {
        return 0;
    }
    match probe::measure_edge(&rx.image(), &rx.homography(), cols, rows) {
        Some((sigma, mtf50)) => {
            rx.io[IO_OUT] = sigma;
            rx.io[IO_OUT + 1] = mtf50;
            1
        }
        None => 0,
    }
}

/// The size of one cell in the camera image, from the homography at `io[12..]`.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_probe_cell_size(rx: *mut Rx, cols: u32, rows: u32) -> f64 {
    // SAFETY: forwarded.
    match unsafe { rx_mut(rx) } {
        Some(rx) => probe::camera_cell_size(&rx.homography(), cols, rows),
        None => f64::NAN,
    }
}

/// The mutual information, in bits per cell, of the `size x size` confusion
/// counts in the state (from value 2, as `modem_probe_grid` keeps them).
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_probe_mutual_information(rx: *mut Rx, size: u32) -> f64 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return f64::NAN;
    };
    let size = size as usize;
    if !(1..=16).contains(&size) || rx.state.len() < 2 + size * size {
        return f64::NAN;
    }
    probe::mutual_information(&rx.state[2..2 + size * size], size)
}

fn write_model(io: &mut [f64; 256], model: &crosstalk::Model) {
    io[IO_OUT..IO_OUT + 9].copy_from_slice(&model.matrix);
    io[IO_OUT + 9..IO_OUT + 12].copy_from_slice(&model.offset);
    io[IO_OUT + 12..IO_OUT + 21].copy_from_slice(&model.inverse);
    io[IO_OUT + 21..IO_OUT + 24].copy_from_slice(&model.white);
    io[IO_OUT + 24] = model.residual;
}

/// Fits the cross-talk model to the eight swatches at `io[128..152]` (red,
/// green, blue each). Returns 1 and writes the matrix, offset, inverse,
/// white and residual to `io[72..97]`, or 0 when the patch cannot be trusted.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_crosstalk_fit(rx: *mut Rx) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return 0;
    };
    let observed = core::array::from_fn(|s| core::array::from_fn(|c| rx.io[IO_IN + s * 3 + c]));
    match crosstalk::fit(&observed) {
        Some(model) => {
            write_model(&mut rx.io, &model);
            1
        }
        None => 0,
    }
}

/// Rescales the model (matrix, offset, white and residual at `io[128..144]`)
/// to the white at `io[144..147]`. Returns 1 and writes the new model as
/// [`modem_crosstalk_fit`] does, or 0 when the new white is unusable.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_crosstalk_rescale(rx: *mut Rx) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return 0;
    };
    let io = &rx.io;
    let model = crosstalk::Model {
        matrix: core::array::from_fn(|i| io[IO_IN + i]),
        offset: core::array::from_fn(|i| io[IO_IN + 9 + i]),
        inverse: [0.0; 9],
        white: core::array::from_fn(|i| io[IO_IN + 12 + i]),
        residual: io[IO_IN + 15],
    };
    let white = core::array::from_fn(|i| io[IO_IN + 16 + i]);
    match crosstalk::rescale_to_white(&model, white) {
        Some(next) => {
            write_model(&mut rx.io, &next);
            1
        }
        None => 0,
    }
}

/// Splits the `pixels` RGBA pixels in `input` into three planes in `output`,
/// with the inverse at `io[128..137]`, the offset at `io[137..140]` and the
/// scale at `io[140]`.
///
/// # Safety
/// As [`modem_rx_free`].
#[no_mangle]
pub unsafe extern "C" fn modem_crosstalk_split(rx: *mut Rx, pixels: usize) -> i32 {
    // SAFETY: forwarded.
    let Some(rx) = (unsafe { rx_mut(rx) }) else {
        return STATUS_BAD_INPUT;
    };
    if pixels > MAX_PIXELS || rx.input.len() != pixels * 4 {
        return STATUS_BAD_INPUT;
    }
    let inverse = core::array::from_fn(|i| rx.io[IO_IN + i]);
    let offset = core::array::from_fn(|i| rx.io[IO_IN + 9 + i]);
    let scale = rx.io[IO_IN + 12];
    let out = sized(&mut rx.output, pixels * 3);
    crosstalk::split(&rx.input, &inverse, &offset, scale, out);
    STATUS_OK
}
