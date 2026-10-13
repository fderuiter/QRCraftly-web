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

//! Torn captures (ADR 0049). A screen refresh during the camera's rolling
//! readout leaves the rows above one camera row from frame `n` and those
//! below it from frame `n + 1`. Both halves are valid frames, so the wrong
//! half's cells reach the code as confident errors, and because every block
//! has bytes in every row (`codec::encode`), one torn capture used to lose
//! every block once the tear covered more rows than half the check bytes.
//!
//! The receiver here changes nothing in the frame format. It splits the cells
//! at a cut across the camera's rows, decodes each side against its own frame
//! sequence with the other side's bytes erased, and finds the cut by trying
//! cuts on two blocks of each side. When no straight cut finishes either side,
//! it tries cuts slanted against the camera's rows too: a phone turned against
//! the screen reads its sensor across the screen's rows, and the refresh tears
//! the picture on a slant. A capture whose other side is too small
//! to decode alone can be finished by the next capture, which shows that
//! frame on the other side of the tear (`Carry`). The block tag (ADR 0043)
//! binds session, sequence and index, so a wrong cut or a wrong sequence
//! guess gives no block, never a wrong one.

use alloc::vec::Vec;

use crate::codec::{self, BlockScratch, Capacity, ALL_ATTEMPTS};
use crate::fmath;
use crate::layout::{Grid, BAND_ROWS};

/// Row of the top header strip's centre (rows 5 to 8).
const TOP_STRIP_ROW: f64 = 7.0;
/// Rows from the bottom edge to the bottom header strip's centre.
const BOTTOM_STRIP_FROM_END: f64 = 2.0;
/// Steps between the first and the last cut tried.
const CUT_STEPS: u32 = 64;
/// Most cuts tried along one slant, whose cells span more positions than a
/// straight cut's.
const MAX_CUT_STEPS: u32 = 4 * CUT_STEPS;
/// Steps between the cuts a slant is first tried at: only a slant at which
/// one of them decodes is tried at every step. At the tear's slant the cuts
/// that decode span many steps.
const COARSE: u32 = 4;
/// Slants of the cut tried when no straight cut finishes a side, in degrees
/// from the camera's rows, nearest first. A phone turned a quarter against
/// the screen reads its sensor across the screen's rows, so the refresh tears
/// the picture on a slant (about 25 degrees for a 16 ms readout of a screen
/// that fills the picture).
const SLANTS: [f32; 12] = [
    10.0, -10.0, 20.0, -20.0, 30.0, -30.0, 40.0, -40.0, 50.0, -50.0, 60.0, -60.0,
];

/// Cells of an earlier capture of the frame a side shows, as that capture
/// sampled them: they fill in the rows the current capture shows from
/// another frame.
pub struct Carry<'a> {
    /// The frame's sequence.
    pub seq: u32,
    /// The side of the earlier capture's cut the frame was on: 0 above, 1 below.
    pub side: usize,
    /// The earlier capture's homography.
    pub homography: [f32; 9],
    pub symbols: &'a [u8],
    pub confidence: &'a [u8],
}

/// The stream of one capture, before de-whitening, with where each byte lies
/// across the camera's rows.
#[derive(Default)]
struct View {
    stream: Vec<u8>,
    sure: Vec<u8>,
    /// Each data cell's position across the camera's rows and along them,
    /// in rows (see [`Axis`]).
    across: Vec<f32>,
    along: Vec<f32>,
    /// Lowest and highest position of the cells of each byte, in rows along
    /// the cut's normal at the slant last placed (see [`place`]).
    lo: Vec<f32>,
    hi: Vec<f32>,
}

/// Scratch the torn decoder reuses from frame to frame.
#[derive(Default)]
pub struct TearScratch {
    current: View,
    carry: View,
    sides: [Vec<u8>; 2],
    carry_stream: Vec<u8>,
    block: BlockScratch,
    /// A side's block flags and data at a slanted cut, until they are known
    /// to beat the straight cut's.
    spare_ok: Vec<u8>,
    spare_out: Vec<u8>,
}

/// What one side of the cut gave.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Side {
    pub blocks_ok: u32,
    /// Bytes handed to the code as erasures, over the blocks repaired.
    pub erasures: u32,
    /// Bytes the code repaired, over the blocks repaired.
    pub corrected: u32,
    /// Blocks whose first repair the tag refused.
    pub refused: u32,
    /// The cut the side was decoded at, in rows along the tear's normal; `None`
    /// when no cut decoded its trial blocks.
    pub cut: Option<f32>,
    /// The cut's slant from the camera's rows, in degrees.
    pub slant: f32,
}

/// Positions across the camera's rows, scaled so that the top header strip's
/// centre is at row 7 and the bottom one's at `rows - 2`. A rolling shutter
/// tears along the sensor's rows, which lie along the image's rows or, in an
/// image the browser turned, its columns: of those two, the axis the grid's
/// rows run along. A line of constant position is then one camera row.
struct Axis {
    h: [f64; 9],
    use_y: bool,
    top: f64,
    scale: f64,
}

impl Axis {
    fn new(homography: &[f32; 9], grid: &Grid) -> Option<Axis> {
        let h = homography.map(|v| v as f64);
        let (cu, cv) = (grid.cols as f64 / 2.0, grid.rows as f64 / 2.0);
        let mut axis = Axis {
            h,
            use_y: true,
            top: 0.0,
            scale: 1.0,
        };
        let (ax, ay) = axis.point(cu, cv);
        let (bx, by) = axis.point(cu + 1.0, cv);
        axis.use_y = fmath::abs(bx - ax) >= fmath::abs(by - ay);
        let bottom_row = grid.rows as f64 - BOTTOM_STRIP_FROM_END;
        let top = axis.coordinate(cu, TOP_STRIP_ROW);
        let bottom = axis.coordinate(cu, bottom_row);
        let scale = (bottom_row - TOP_STRIP_ROW) / (bottom - top);
        if !scale.is_finite() || scale == 0.0 {
            return None;
        }
        axis.top = top;
        axis.scale = scale;
        Some(axis)
    }

    fn point(&self, u: f64, v: f64) -> (f64, f64) {
        let h = &self.h;
        let w = h[6] * u + h[7] * v + 1.0;
        (
            (h[0] * u + h[1] * v + h[2]) / w,
            (h[3] * u + h[4] * v + h[5]) / w,
        )
    }

    fn coordinate(&self, u: f64, v: f64) -> f64 {
        let (x, y) = self.point(u, v);
        if self.use_y {
            y
        } else {
            x
        }
    }

    /// The position of the point at column `u`, row `v` of the grid across
    /// the camera's rows, and along them (from the image's edge, at the
    /// same scale).
    fn key(&self, u: f64, v: f64) -> (f32, f32) {
        let (x, y) = self.point(u, v);
        let (across, along) = if self.use_y { (y, x) } else { (x, y) };
        (
            (TOP_STRIP_ROW + (across - self.top) * self.scale) as f32,
            (along * self.scale) as f32,
        )
    }
}

/// Reads a capture's stream and places each data cell on the camera.
fn build_view(
    view: &mut View,
    capacity: &Capacity,
    grid: &Grid,
    axis: &Axis,
    symbols: &[u8],
    confidence: &[u8],
) {
    codec::read_stream(
        capacity,
        symbols,
        confidence,
        &mut view.stream,
        &mut view.sure,
    );
    let cols = grid.cols as usize;
    view.across.clear();
    view.along.clear();
    for c in 0..capacity.data_cells {
        let (col, row) = (c % cols, c / cols);
        let (across, along) = axis.key(col as f64 + 0.5, (BAND_ROWS as usize + row) as f64 + 0.5);
        view.across.push(across);
        view.along.push(along);
    }
}

/// Places each byte of a view along the normal of a cut slanted by `slant`
/// (its sine and cosine) from the camera's rows. Returns the lowest and
/// highest position of any cell.
fn place(view: &mut View, capacity: &Capacity, slant: (f32, f32)) -> (f32, f32) {
    let (sin, cos) = slant;
    let bits = capacity.bits_per_cell;
    view.lo.clear();
    view.hi.clear();
    let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
    for byte in 0..capacity.stream_bytes {
        let cells = byte * 8 / bits..=(byte * 8 + 7) / bits;
        let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
        for (&a, &b) in view.across[cells.clone()].iter().zip(&view.along[cells]) {
            let k = if sin == 0.0 { a } else { a * cos - b * sin };
            lo = if k < lo { k } else { lo };
            hi = if k > hi { k } else { hi };
        }
        min = if lo < min { lo } else { min };
        max = if hi > max { hi } else { max };
        view.lo.push(lo);
        view.hi.push(hi);
    }
    (min, max)
}

/// Whether stream byte `j` of a view lies wholly on `side` of `cut`.
#[inline]
fn owns(view: &View, side: usize, j: usize, cut: f32) -> bool {
    if side == 0 {
        view.hi[j] < cut
    } else {
        view.lo[j] >= cut
    }
}

/// One side's sources: the current capture's de-whitened stream, and an
/// earlier capture's when it carried this side's frame.
struct Sources<'a> {
    side: usize,
    current: &'a View,
    stream: &'a [u8],
    carry: Option<(&'a View, &'a [u8], usize)>,
}

/// Buffers for one block.
struct Work<'a> {
    received: [u8; 255],
    sure: [u8; 255],
    word: [u8; 255],
    block: &'a mut BlockScratch,
}

impl Sources<'_> {
    /// Gathers block `b` at `cut` and repairs it with the first `attempts`
    /// sets of erasures; a block with more bytes erased than check bytes is
    /// not tried.
    #[allow(clippy::too_many_arguments)]
    fn decode(
        &self,
        capacity: &Capacity,
        b: usize,
        cut: f32,
        session: u32,
        seq: u32,
        threshold: Option<f64>,
        attempts: usize,
        work: &mut Work,
    ) -> codec::BlockOutcome {
        if self.gather(capacity, b, cut, &mut work.received, &mut work.sure) > capacity.parity {
            return codec::BlockOutcome::default();
        }
        codec::decode_block(
            capacity,
            &work.received,
            &work.sure,
            session,
            seq,
            b as u32,
            threshold,
            attempts,
            &mut work.word,
            work.block,
        )
    }

    /// Gathers block `b` at `cut`: each byte from the capture whose side of
    /// the cut it lies on, or as an erasure. Returns the bytes erased.
    fn gather(
        &self,
        capacity: &Capacity,
        b: usize,
        cut: f32,
        received: &mut [u8; 255],
        sure: &mut [u8; 255],
    ) -> usize {
        let mut erased = 0;
        for i in 0..capacity.block_bytes {
            let j = i * capacity.blocks + b;
            received[i] = self.stream[j];
            sure[i] = if owns(self.current, self.side, j, cut) {
                self.current.sure[j]
            } else if let Some((view, stream, _)) = self
                .carry
                .filter(|&(view, _, side)| owns(view, side, j, cut))
            {
                received[i] = stream[j];
                view.sure[j]
            } else {
                erased += 1;
                0
            };
        }
        erased
    }
}

/// The sine and cosine of a slant in degrees.
fn slant(degrees: f32) -> (f32, f32) {
    let radians = degrees as f64 * core::f64::consts::PI / 180.0;
    (fmath::sin(radians) as f32, fmath::cos(radians) as f32)
}

/// Places a capture's view, and an earlier capture's when given, along the
/// normal of a cut slanted from the camera's rows by an angle with sine and
/// cosine `slant`. Returns the
/// first cut to try, the span the cuts cover and the steps across it: from
/// `first` to `last` in [`CUT_STEPS`] for a straight cut, and across every
/// cell at the same step, up to [`MAX_CUT_STEPS`], for a slanted one.
fn place_views(
    current: &mut View,
    carry: Option<&mut View>,
    capacity: &Capacity,
    slant: (f32, f32),
    first: f32,
    last: f32,
) -> (f32, f32, u32) {
    let (min, max) = place(current, capacity, slant);
    if let Some(view) = carry {
        place(view, capacity, slant);
    }
    if slant.0 == 0.0 {
        return (first, last - first, CUT_STEPS);
    }
    let span = max - min;
    let steps = (span / (last - first) * CUT_STEPS as f32 + 1.0).clamp(1.0, MAX_CUT_STEPS as f32);
    (min, span, steps as u32)
}

/// Decodes a torn capture: the cells above a cut against `seqs[0]` and those
/// below it against `seqs[1]`, each with the other side's bytes erased. The
/// cut of each side is the middle of the longest run of cuts at which two
/// trial blocks (the first and the last) decode; with no such cut, the side
/// gives nothing. `known` flags, per side, blocks already decoded, which are
/// skipped (an empty slice skips none). `carry` fills in the side whose
/// sequence it names. Writes each side's block flags and data into `ok` and
/// `out` as [`codec::decode`] does. `None` when the homography gives no
/// direction across the rows.
#[allow(clippy::too_many_arguments)]
pub fn decode_torn(
    capacity: &Capacity,
    grid: &Grid,
    homography: &[f32; 9],
    symbols: &[u8],
    confidence: &[u8],
    session: u32,
    seqs: [u32; 2],
    threshold: Option<f64>,
    known: [&[u8]; 2],
    carry: Option<&Carry>,
    ok: [&mut [u8]; 2],
    out: [&mut [u8]; 2],
    scratch: &mut TearScratch,
) -> Option<[Side; 2]> {
    let axis = Axis::new(homography, grid)?;
    let carry_axis = match carry {
        Some(c) => Some(Axis::new(&c.homography, grid)?),
        None => None,
    };
    let TearScratch {
        current,
        carry: carry_view,
        sides: side_streams,
        carry_stream,
        block,
        spare_ok,
        spare_out,
    } = scratch;
    build_view(current, capacity, grid, &axis, symbols, confidence);
    for (stream, &seq) in side_streams.iter_mut().zip(&seqs) {
        stream.clear();
        stream.extend_from_slice(&current.stream);
        codec::whiten(stream, session, seq);
    }
    if let (Some(c), Some(a)) = (carry, &carry_axis) {
        build_view(carry_view, capacity, grid, a, c.symbols, c.confidence);
        carry_stream.clear();
        carry_stream.extend_from_slice(&carry_view.stream);
        codec::whiten(carry_stream, session, c.seq);
    }
    // An erasure is a byte under the threshold, and every byte from the other side has 0.
    let threshold = Some(match threshold {
        Some(t) if t >= 1.0 => t,
        _ => 1.0,
    });
    let first = (BAND_ROWS - 1) as f32;
    let last = (grid.rows - BAND_ROWS + 1) as f32;
    let trials: &[usize] = if capacity.blocks > 1 {
        &[0, capacity.blocks - 1]
    } else {
        &[0]
    };
    let carried = carry.is_some();
    let carry_sides = seqs.map(|seq| carry.filter(|c| c.seq == seq).map(|c| c.side));
    let mut work = Work {
        received: [0u8; 255],
        sure: [0u8; 255],
        word: [0u8; 255],
        block,
    };
    fn sources<'a>(
        side: usize,
        current: &'a View,
        streams: &'a [Vec<u8>; 2],
        carry: Option<(&'a View, &'a [u8], usize)>,
    ) -> Sources<'a> {
        Sources {
            side,
            current,
            stream: &streams[side],
            carry,
        }
    }
    let mut result = [Side::default(); 2];
    // A straight cut first, along the camera's rows.
    place_views(
        current,
        carried.then_some(&mut *carry_view),
        capacity,
        (0.0, 1.0),
        first,
        last,
    );
    let mut done = [false; 2];
    for side in 0..2 {
        ok[side].fill(0);
        out[side].fill(0);
        let from = sources(
            side,
            current,
            side_streams,
            carry_sides[side].map(|s| (&*carry_view, &carry_stream[..], s)),
        );
        if let Some((cut, _)) = longest_run(
            &from,
            capacity,
            trials,
            session,
            seqs[side],
            threshold,
            first,
            last - first,
            CUT_STEPS,
            1,
            &mut work,
        ) {
            result[side] = decode_side(
                &from,
                capacity,
                cut,
                session,
                seqs[side],
                threshold,
                known[side],
                ok[side],
                out[side],
                &mut work,
            );
        }
        done[side] = (0..capacity.blocks)
            .all(|b| ok[side][b] != 0 || known[side].get(b).is_some_and(|&k| k != 0));
    }
    // A side the straight cut finished shows that the tear is straight.
    // Otherwise each side that is not finished takes the slant whose longest
    // run of cuts is longest: a phone turned against the screen tears the
    // picture on a slant.
    if done.contains(&true) {
        return Some(result);
    }
    let mut best: [Option<(f32, f32, u32)>; 2] = [None, None];
    for degrees in SLANTS {
        let (from, span, steps) = place_views(
            current,
            carried.then_some(&mut *carry_view),
            capacity,
            slant(degrees),
            first,
            last,
        );
        for (side, best) in best.iter_mut().enumerate() {
            let sources = sources(
                side,
                current,
                side_streams,
                carry_sides[side].map(|s| (&*carry_view, &carry_stream[..], s)),
            );
            let run = |stride: u32, work: &mut Work| {
                longest_run(
                    &sources, capacity, trials, session, seqs[side], threshold, from, span, steps,
                    stride, work,
                )
            };
            if let Some((cut, len)) = run(COARSE, &mut work).and_then(|_| run(1, &mut work)) {
                if best.is_none_or(|(_, _, l)| len > l) {
                    *best = Some((degrees, cut, len));
                }
            }
        }
    }
    for (side, best) in best.into_iter().enumerate() {
        let Some((degrees, cut, _)) = best else {
            continue;
        };
        place_views(
            current,
            carried.then_some(&mut *carry_view),
            capacity,
            slant(degrees),
            first,
            last,
        );
        spare_ok.clear();
        spare_ok.resize(ok[side].len(), 0);
        spare_out.clear();
        spare_out.resize(out[side].len(), 0);
        let mut slanted = decode_side(
            &sources(
                side,
                current,
                side_streams,
                carry_sides[side].map(|s| (&*carry_view, &carry_stream[..], s)),
            ),
            capacity,
            cut,
            session,
            seqs[side],
            threshold,
            known[side],
            spare_ok,
            spare_out,
            &mut work,
        );
        if slanted.blocks_ok > result[side].blocks_ok {
            ok[side].copy_from_slice(spare_ok);
            out[side].copy_from_slice(spare_out);
            slanted.slant = degrees;
            result[side] = slanted;
        }
    }
    Some(result)
}

/// The longest run of cuts, `steps` steps across `span` from `from` tried
/// every `stride` steps, at which every trial block decodes: the middle cut
/// of the run and its length in cuts tried.
#[allow(clippy::too_many_arguments)]
fn longest_run(
    sources: &Sources,
    capacity: &Capacity,
    trials: &[usize],
    session: u32,
    seq: u32,
    threshold: Option<f64>,
    from: f32,
    span: f32,
    steps: u32,
    stride: u32,
    work: &mut Work,
) -> Option<(f32, u32)> {
    let cut_at = |i: u32| from + span * i as f32 / steps as f32;
    let (mut start, mut len, mut run) = (0u32, 0u32, 0u32);
    for i in (0..=steps).step_by(stride as usize) {
        let cut = cut_at(i);
        if trials.iter().all(|&b| {
            sources
                .decode(capacity, b, cut, session, seq, threshold, 1, work)
                .repaired
                .is_some()
        }) {
            run += 1;
            if run > len {
                len = run;
                start = i + stride - run * stride;
            }
        } else {
            run = 0;
        }
    }
    (len > 0).then(|| (cut_at(start + (len - 1) / 2 * stride), len))
}

/// Decodes every block of a side at `cut` that `known` does not flag,
/// writing flags and data into `ok` and `out` as [`codec::decode`] does.
#[allow(clippy::too_many_arguments)]
fn decode_side(
    sources: &Sources,
    capacity: &Capacity,
    cut: f32,
    session: u32,
    seq: u32,
    threshold: Option<f64>,
    known: &[u8],
    ok: &mut [u8],
    out: &mut [u8],
    work: &mut Work,
) -> Side {
    let mut found = Side {
        cut: Some(cut),
        ..Side::default()
    };
    for b in 0..capacity.blocks {
        if known.get(b).is_some_and(|&k| k != 0) {
            continue;
        }
        let outcome = sources.decode(
            capacity,
            b,
            cut,
            session,
            seq,
            threshold,
            ALL_ATTEMPTS,
            work,
        );
        if outcome.refused {
            found.refused += 1;
        }
        if let Some(corrected) = outcome.repaired {
            ok[b] = 1;
            out[b * capacity.packet_bytes..(b + 1) * capacity.packet_bytes]
                .copy_from_slice(&work.word[..capacity.packet_bytes]);
            found.blocks_ok += 1;
            found.erasures += outcome.erasures as u32;
            found.corrected += corrected as u32;
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: u32 = 0x5eed;

    /// A frame shape with 6 blocks a frame that repairs up to 24% erased bytes.
    fn shape() -> (Capacity, Grid) {
        (
            Capacity::new(2, 104, 58, 120, 40).unwrap(),
            Grid::new(104, 58).unwrap(),
        )
    }

    fn payload(c: &Capacity, offset: u8) -> Vec<u8> {
        (0..c.payload_bytes())
            .map(|i| (i as u8).wrapping_mul(29).wrapping_add(offset))
            .collect()
    }

    fn frame(c: &Capacity, seq: u32) -> (Vec<u8>, Vec<u8>) {
        let data = payload(c, seq as u8);
        let mut symbols = alloc::vec![0u8; c.data_cells];
        let (mut stream, mut message) = (Vec::new(), Vec::new());
        assert!(codec::encode(
            c,
            &data,
            SESSION,
            seq,
            &mut symbols,
            &mut stream,
            &mut message
        ));
        (data, symbols)
    }

    /// Four pixels a cell, turned a quarter when `turned` (grid rows then run
    /// down the image's columns).
    fn homography(turned: bool) -> [f32; 9] {
        if turned {
            [0.0, -4.0, 400.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0]
        } else {
            [4.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 1.0]
        }
    }

    /// The cells of frame `above` above `tear` (a fraction of the data rows)
    /// and of frame `below` under it.
    fn torn(c: &Capacity, grid: &Grid, above: &[u8], below: &[u8], tear: f64) -> Vec<u8> {
        let cols = grid.cols as usize;
        let rows = grid.data_rows() as f64;
        (0..c.data_cells)
            .map(|i| {
                if ((i / cols) as f64) < tear * rows {
                    above[i]
                } else {
                    below[i]
                }
            })
            .collect()
    }

    /// The cells of frame `above` above a line through `tear` of the data
    /// rows at the middle column, dropping `slope` rows per column, and of
    /// frame `below` under it: a phone turned against the screen.
    fn slanted(
        c: &Capacity,
        grid: &Grid,
        above: &[u8],
        below: &[u8],
        tear: f64,
        slope: f64,
    ) -> Vec<u8> {
        let cols = grid.cols as usize;
        let rows = grid.data_rows() as f64;
        (0..c.data_cells)
            .map(|i| {
                let (col, row) = ((i % cols) as f64, (i / cols) as f64);
                if row < tear * rows + slope * (col - cols as f64 / 2.0) {
                    above[i]
                } else {
                    below[i]
                }
            })
            .collect()
    }

    struct Run {
        sides: [Side; 2],
        ok: [Vec<u8>; 2],
        out: [Vec<u8>; 2],
    }

    fn run(symbols: &[u8], h: [f32; 9], seqs: [u32; 2], carry: Option<&Carry>) -> Run {
        let (c, grid) = shape();
        let confidence = alloc::vec![200u8; c.data_cells];
        let mut ok = [alloc::vec![0u8; c.blocks], alloc::vec![0u8; c.blocks]];
        let mut out = [
            alloc::vec![0u8; c.payload_bytes()],
            alloc::vec![0u8; c.payload_bytes()],
        ];
        let [ok0, ok1] = &mut ok;
        let [out0, out1] = &mut out;
        let sides = decode_torn(
            &c,
            &grid,
            &h,
            symbols,
            &confidence,
            SESSION,
            seqs,
            Some(32.0),
            [&[], &[]],
            carry,
            [ok0, ok1],
            [out0, out1],
            &mut TearScratch::default(),
        )
        .unwrap();
        Run { sides, ok, out }
    }

    fn all_ok(r: &Run, side: usize, data: &[u8]) -> bool {
        r.ok[side].iter().all(|&f| f == 1) && r.out[side] == data
    }

    #[test]
    fn decodes_the_big_side_of_a_tear_in_either_orientation() {
        let (c, grid) = shape();
        let (a, sa) = frame(&c, 9);
        let (_, sb) = frame(&c, 10);
        for turned in [false, true] {
            let symbols = torn(&c, &grid, &sa, &sb, 0.8);
            let r = run(&symbols, homography(turned), [9, 10], None);
            assert!(all_ok(&r, 0, &a), "turned {turned}");
            assert_eq!(r.sides[0].blocks_ok as usize, c.blocks);
            assert_eq!(r.sides[1].blocks_ok, 0);
            assert!(r.ok[1].iter().all(|&f| f == 0));
            let cut = r.sides[0].cut.unwrap();
            assert!(cut > 9.0 && cut < 58.0 - 9.0);
        }
        // The bottom side, the other way up.
        let symbols = torn(&c, &grid, &sb, &sa, 0.15);
        let r = run(&symbols, homography(false), [10, 9], None);
        assert!(all_ok(&r, 1, &a));
        assert_eq!(r.sides[0].blocks_ok, 0);
    }

    #[test]
    fn a_slanted_tear_is_cut_on_a_slant() {
        let (c, grid) = shape();
        let (a, sa) = frame(&c, 9);
        let (_, sb) = frame(&c, 10);
        for (slope, turned) in [(0.3, false), (-0.3, false), (0.3, true)] {
            let symbols = slanted(&c, &grid, &sa, &sb, 0.9, slope);
            // No straight cut leaves few enough of frame 10's bytes in frame 9's side.
            let r = run(&symbols, homography(turned), [9, 10], None);
            assert!(all_ok(&r, 0, &a), "slope {slope} turned {turned}");
            assert_ne!(r.sides[0].slant, 0.0);
            assert_eq!(r.sides[1].blocks_ok, 0);
        }
        // A straight tear is still cut straight.
        let symbols = torn(&c, &grid, &sa, &sb, 0.8);
        assert_eq!(
            run(&symbols, homography(false), [9, 10], None).sides[0].slant,
            0.0
        );
    }

    #[test]
    fn an_earlier_capture_completes_a_frame_torn_on_a_slant() {
        let (c, grid) = shape();
        let (_, sa) = frame(&c, 9);
        let (b, sb) = frame(&c, 10);
        let (_, sc) = frame(&c, 11);
        let first = slanted(&c, &grid, &sa, &sb, 0.5, 0.5);
        let second = slanted(&c, &grid, &sb, &sc, 0.5, 0.5);
        let alone = run(&second, homography(false), [10, 11], None);
        assert_eq!(alone.sides[0].blocks_ok + alone.sides[1].blocks_ok, 0);
        let confidence = alloc::vec![200u8; c.data_cells];
        let carry = Carry {
            seq: 10,
            side: 1,
            homography: homography(false),
            symbols: &first,
            confidence: &confidence,
        };
        let r = run(&second, homography(false), [10, 11], Some(&carry));
        assert!(all_ok(&r, 0, &b));
        assert_ne!(r.sides[0].slant, 0.0);
    }

    #[test]
    fn a_frame_that_is_not_torn_decodes_whole_on_its_side() {
        let (c, _) = shape();
        let (a, sa) = frame(&c, 9);
        let r = run(&sa, homography(false), [8, 9], None);
        assert!(all_ok(&r, 1, &a));
        assert_eq!(r.sides[0].blocks_ok, 0);
    }

    #[test]
    fn wrong_sequences_give_no_block() {
        let (c, grid) = shape();
        let (_, sa) = frame(&c, 9);
        let (_, sb) = frame(&c, 10);
        let symbols = torn(&c, &grid, &sa, &sb, 0.8);
        let r = run(&symbols, homography(false), [11, 12], None);
        assert_eq!(r.sides[0].blocks_ok + r.sides[1].blocks_ok, 0);
        assert!(r.ok.iter().flatten().all(|&f| f == 0));
        assert!(r.out.iter().flatten().all(|&v| v == 0));
    }

    #[test]
    fn an_earlier_capture_completes_a_frame_torn_near_the_middle() {
        let (c, grid) = shape();
        let (_, sa) = frame(&c, 9);
        let (b, sb) = frame(&c, 10);
        let (_, sc) = frame(&c, 11);
        let first = torn(&c, &grid, &sa, &sb, 0.55);
        let second = torn(&c, &grid, &sb, &sc, 0.55);
        // Alone, neither side of either capture holds enough of its frame.
        let alone = run(&second, homography(false), [10, 11], None);
        assert_eq!(alone.sides[0].blocks_ok + alone.sides[1].blocks_ok, 0);
        let confidence = alloc::vec![200u8; c.data_cells];
        let carry = Carry {
            seq: 10,
            side: 1,
            homography: homography(false),
            symbols: &first,
            confidence: &confidence,
        };
        let r = run(&second, homography(false), [10, 11], Some(&carry));
        assert!(all_ok(&r, 0, &b));
        assert_eq!(r.sides[1].blocks_ok, 0);
        // An earlier capture of another frame adds nothing.
        let stale = Carry { seq: 12, ..carry };
        let r = run(&second, homography(false), [10, 11], Some(&stale));
        assert_eq!(r.sides[0].blocks_ok + r.sides[1].blocks_ok, 0);
    }

    #[test]
    fn odd_homographies_and_thresholds_give_no_wrong_block() {
        let (c, grid) = shape();
        let (a, sa) = frame(&c, 9);
        let (_, sb) = frame(&c, 10);
        let symbols = torn(&c, &grid, &sa, &sb, 0.8);
        let confidence = alloc::vec![200u8; c.data_cells];
        let nan = f32::NAN;
        let homographies = [
            // The projective term crosses zero inside the grid: some cells land at infinity.
            [4.0, 0.0, 0.0, 0.0, 4.0, 0.0, -0.02, 0.0, 1.0],
            [nan, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 1.0],
            [4.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, nan],
            [f32::INFINITY, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 1.0],
            [1e-30, 0.0, 0.0, 0.0, 1e-30, 0.0, 0.0, 0.0, 1.0],
            [4.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 1.0],
        ];
        for h in homographies {
            for threshold in [None, Some(f64::NAN), Some(-1.0), Some(0.0), Some(1e9)] {
                let carry = Carry {
                    seq: 9,
                    side: 0,
                    homography: h,
                    symbols: &sb,
                    confidence: &confidence,
                };
                let mut ok = [alloc::vec![0u8; c.blocks], alloc::vec![0u8; c.blocks]];
                let mut out = [
                    alloc::vec![0u8; c.payload_bytes()],
                    alloc::vec![0u8; c.payload_bytes()],
                ];
                let [ok0, ok1] = &mut ok;
                let [out0, out1] = &mut out;
                let _ = decode_torn(
                    &c,
                    &grid,
                    &h,
                    &symbols,
                    &confidence,
                    SESSION,
                    [9, 10],
                    threshold,
                    [&[], &[]],
                    Some(&carry),
                    [ok0, ok1],
                    [out0, out1],
                    &mut TearScratch::default(),
                );
                // Side 1 shows frame 10 but too little of it; side 0 may only give frame 9's blocks.
                assert!(ok[1].iter().all(|&f| f == 0), "{h:?} {threshold:?}");
                let blocks = out[0].chunks(c.packet_bytes).zip(a.chunks(c.packet_bytes));
                for (&flag, (got, sent)) in ok[0].iter().zip(blocks) {
                    assert!(flag == 0 || got == sent, "{h:?} {threshold:?}");
                }
            }
        }
    }

    #[test]
    fn skips_known_blocks_and_refuses_a_degenerate_homography() {
        let (c, grid) = shape();
        let (_, sa) = frame(&c, 9);
        let confidence = alloc::vec![200u8; c.data_cells];
        let mut ok = [alloc::vec![0u8; c.blocks], alloc::vec![0u8; c.blocks]];
        let mut out = [
            alloc::vec![0u8; c.payload_bytes()],
            alloc::vec![0u8; c.payload_bytes()],
        ];
        let known = alloc::vec![1u8; c.blocks];
        let [ok0, ok1] = &mut ok;
        let [out0, out1] = &mut out;
        let sides = decode_torn(
            &c,
            &grid,
            &homography(false),
            &sa,
            &confidence,
            SESSION,
            [9, 10],
            None,
            [&known, &[]],
            None,
            [ok0, ok1],
            [out0, out1],
            &mut TearScratch::default(),
        )
        .unwrap();
        assert_eq!(sides[0].blocks_ok, 0);
        assert!(sides[0].cut.is_some());
        let [ok0, ok1] = &mut ok;
        let [out0, out1] = &mut out;
        assert!(decode_torn(
            &c,
            &grid,
            &[0.0; 9],
            &sa,
            &confidence,
            SESSION,
            [9, 10],
            None,
            [&[], &[]],
            None,
            [ok0, ok1],
            [out0, out1],
            &mut TearScratch::default(),
        )
        .is_none());
    }
}
