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

//! The channel probe's per-frame analysis (ADR 0027): grid frames sorted
//! into clean, torn and blended and their cells tallied, the mean colour of
//! a flicker frame, the slanted-edge response, the camera's cell size and
//! the mutual information of a confusion matrix.
//!
//! These numbers go into the probe report, not into anything a receiver
//! decides with. Everything but the edge's Fourier transform and the
//! logarithm is `+ - * /` in the TypeScript order; those two use the fdlibm
//! ports in [`crate::fmath`].

use crate::colour::{luma, rgb_to_oklab};
use crate::fmath::{abs, cos, floor, js_max, js_min, log2, sin, sqrt};
use crate::layout::BAND_ROWS;
use crate::Image;

/// Bands the data area is cut into when looking for a tear between two frames.
const BANDS: usize = 8;
/// A band belongs to a variant when it matches it better than the other by this much.
const BAND_MARGIN: f64 = 0.1;
/// The slanted edge falls one pixel sideways for each this many pixels down.
pub const EDGE_RUN: f64 = 8.0;

/// Values in a grid pattern's running totals: cells, symbol errors, then the
/// `size x size` confusion counts, then per symbol the OKLab sample count,
/// sums and sums of squares.
pub fn grid_state_len(size: usize) -> usize {
    2 + size * size + size * 7
}

/// A grid frame's verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameStatus {
    Clean = 0,
    Torn = 1,
    Blended = 2,
}

/// Sorts one grid frame and, when it is clean, adds its cells to `state`.
/// Returns the verdict and, for a clean frame, its mean confidence.
#[allow(clippy::too_many_arguments)]
pub fn ingest_grid(
    symbols: &[u8],
    confidence: &[u8],
    means: &[u8],
    own: &[u8],
    other: &[u8],
    cols: usize,
    data_rows: usize,
    size: usize,
    state: &mut [f64],
) -> (FrameStatus, f64) {
    let rows_per_band = data_rows.div_ceil(BANDS);
    let mut own_hits = [0u32; BANDS];
    let mut other_hits = [0u32; BANDS];
    let mut cells_in_band = [0u32; BANDS];
    for i in 0..symbols.len() {
        let band = (BANDS - 1).min(i / cols / rows_per_band);
        cells_in_band[band] += 1;
        own_hits[band] += u32::from(symbols[i] == own[i]);
        other_hits[band] += u32::from(symbols[i] == other[i]);
    }
    let (mut own_bands, mut other_bands, mut used_bands) = (0, 0, 0);
    for b in 0..BANDS {
        if cells_in_band[b] == 0 {
            continue;
        }
        used_bands += 1;
        let d = (own_hits[b] as f64 - other_hits[b] as f64) / cells_in_band[b] as f64;
        if d > BAND_MARGIN {
            own_bands += 1;
        } else if d < -BAND_MARGIN {
            other_bands += 1;
        }
    }
    let status = if other_bands == 0 && own_bands == used_bands {
        FrameStatus::Clean
    } else if own_bands > 0 && other_bands > 0 {
        FrameStatus::Torn
    } else {
        FrameStatus::Blended
    };
    if status != FrameStatus::Clean {
        return (status, 0.0);
    }
    let stats_at = 2 + size * size;
    let mut sum_confidence = 0u64;
    for i in 0..symbols.len() {
        state[0] += 1.0;
        sum_confidence += confidence[i] as u64;
        let (sent, read) = (own[i] as usize, symbols[i] as usize);
        state[2 + sent * size + read] += 1.0;
        if read != sent {
            state[1] += 1.0;
        }
        if i % 4 == 0 {
            let lab = rgb_to_oklab(
                means[i * 3] as f64,
                means[i * 3 + 1] as f64,
                means[i * 3 + 2] as f64,
            );
            let stats = &mut state[stats_at + sent * 7..stats_at + sent * 7 + 7];
            stats[0] += 1.0;
            for c in 0..3 {
                stats[1 + c] += lab[c];
                stats[4 + c] += lab[c] * lab[c];
            }
        }
    }
    (status, sum_confidence as f64 / symbols.len() as f64)
}

/// The mean colour of a flicker frame's cells, in OKLab.
pub fn flicker_colour(means: &[u8]) -> [f64; 3] {
    let cells = means.len() / 3;
    let mut sum = [0u64; 3];
    for cell in means.chunks_exact(3) {
        for c in 0..3 {
            sum[c] += cell[c] as u64;
        }
    }
    let n = cells as f64;
    rgb_to_oklab(sum[0] as f64 / n, sum[1] as f64 / n, sum[2] as f64 / n)
}

/// Maps a cell coordinate to pixels through the homography, in `f64`.
fn map(h: &[f32; 9], u: f64, v: f64) -> (f64, f64) {
    let h = h.map(|x| x as f64);
    let w = h[6] * u + h[7] * v + 1.0;
    (
        (h[0] * u + h[1] * v + h[2]) / w,
        (h[3] * u + h[4] * v + h[5]) / w,
    )
}

fn bilinear_luma(image: &Image, x: f64, y: f64) -> f64 {
    let fx = js_min(image.width as f64 - 1.001, js_max(0.0, x - 0.5));
    let fy = js_min(image.height as f64 - 1.001, js_max(0.0, y - 0.5));
    let x0 = floor(fx);
    let y0 = floor(fy);
    let tx = fx - x0;
    let ty = fy - y0;
    let at = |px: f64, py: f64| -> f64 {
        if px.is_nan() || py.is_nan() {
            return 0.0;
        }
        let i = (py as usize * image.width + px as usize) * 4;
        luma(
            image.data[i] as u32,
            image.data[i + 1] as u32,
            image.data[i + 2] as u32,
        ) as f64
    };
    (at(x0, y0) * (1.0 - tx) + at(x0 + 1.0, y0) * tx) * (1.0 - ty)
        + (at(x0, y0 + 1.0) * (1.0 - tx) + at(x0 + 1.0, y0 + 1.0) * tx) * ty
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sum = 0.0;
    for &v in values {
        sum += v;
    }
    sum / values.len() as f64
}

const BINS_PER_CELL: usize = 16;
const REACH: usize = 6;
const BINS: usize = REACH * 2 * BINS_PER_CELL;

/// The slanted edge's line spread deviation and 50% contrast frequency, in
/// cells and cycles per cell, or `None` when the edge was not found.
pub fn measure_edge(image: &Image, h: &[f32; 9], cols: u32, rows: u32) -> Option<(f64, f64)> {
    let (cols, rows) = (cols as f64, rows as f64);
    let band = BAND_ROWS as f64;
    let mut sum = [0f64; BINS];
    let mut count = [0f64; BINS];
    let norm = sqrt(1.0 + 1.0 / (EDGE_RUN * EDGE_RUN));
    let centre_v = (band + rows - band) / 2.0;
    let v_start = band + 2.0;
    let v_end = rows - band - 2.0;
    let mut v = v_start;
    while v < v_end {
        let edge_u = cols / 2.0 + (v - centre_v) / EDGE_RUN;
        let mut u = cols / 2.0 - 14.0;
        while u < cols / 2.0 + 14.0 {
            let bin = floor(((u - edge_u) / norm + REACH as f64) * BINS_PER_CELL as f64);
            if bin >= 0.0 && bin < BINS as f64 {
                let (x, y) = map(h, u, v);
                sum[bin as usize] += bilinear_luma(image, x, y);
                count[bin as usize] += 1.0;
            }
            u += 1.0 / 8.0;
        }
        v += 1.0 / 4.0;
    }
    let mut esf = [0f64; BINS];
    for i in 0..BINS {
        if count[i] == 0.0 {
            return None;
        }
        esf[i] = sum[i] / count[i];
    }
    let lo = mean(&esf[..BINS_PER_CELL]);
    let hi = mean(&esf[BINS - BINS_PER_CELL..]);
    if abs(hi - lo) < 24.0 {
        return None;
    }
    let mut lsf = [0f64; BINS - 1];
    for i in 1..BINS {
        lsf[i - 1] = js_max(0.0, (esf[i] - esf[i - 1]) / (hi - lo));
    }
    let mut total = 0.0;
    for &v in &lsf {
        total += v;
    }
    if total <= 0.0 {
        return None;
    }
    let mut centre = 0.0;
    for (i, &v) in lsf.iter().enumerate() {
        centre += v * i as f64;
    }
    centre /= total;
    let mut variance = 0.0;
    for (i, &v) in lsf.iter().enumerate() {
        variance += v * (i as f64 - centre) * (i as f64 - centre);
    }
    variance /= total;
    let sigma_cells = sqrt(variance) / BINS_PER_CELL as f64;
    let mut mtf50 = BINS_PER_CELL as f64 / 2.0;
    let mut previous = 1.0;
    for k in 1..=BINS / 2 {
        let f = k as f64 / BINS as f64;
        let mut re = 0.0;
        let mut im = 0.0;
        for (i, &value) in lsf.iter().enumerate() {
            let angle = 2.0 * core::f64::consts::PI * f * i as f64;
            re += value * cos(angle);
            im -= value * sin(angle);
        }
        let magnitude = sqrt(re * re + im * im) / total;
        if magnitude < 0.5 {
            let f_prev = (k - 1) as f64 / BINS as f64;
            mtf50 = (f_prev + ((previous - 0.5) / (previous - magnitude)) * (f - f_prev))
                * BINS_PER_CELL as f64;
            break;
        }
        previous = magnitude;
    }
    Some((sigma_cells, mtf50))
}

/// Size of one cell in the camera image around the middle of the frame, from the homography.
pub fn camera_cell_size(h: &[f32; 9], cols: u32, rows: u32) -> f64 {
    let u = cols as f64 / 2.0;
    let v = rows as f64 / 2.0;
    let (px, py) = map(h, u, v);
    let (qx, qy) = map(h, u + 1.0, v);
    let (rx, ry) = map(h, u, v + 1.0);
    sqrt(abs((qx - px) * (ry - py) - (qy - py) * (rx - px)))
}

/// Plug-in estimate of the mutual information between the symbol sent and
/// the symbol read, the sent symbols equally likely, from a `size x size`
/// confusion matrix of counts (sent by row). In bits per cell.
#[allow(clippy::needless_range_loop)]
pub fn mutual_information(confusion: &[f64], size: usize) -> f64 {
    let mut row_totals = [0f64; 16];
    let mut active = 0u32;
    for x in 0..size {
        let mut total = 0.0;
        for y in 0..size {
            total += confusion[x * size + y];
        }
        row_totals[x] = total;
        active += u32::from(total > 0.0);
    }
    if active == 0 {
        return 0.0;
    }
    let active = active as f64;
    let joint = |x: usize, y: usize| {
        if row_totals[x] > 0.0 {
            confusion[x * size + y] / row_totals[x] / active
        } else {
            0.0
        }
    };
    let mut read = [0f64; 16];
    for (y, r) in read.iter_mut().enumerate().take(size) {
        let mut s = 0.0;
        for x in 0..size {
            s += joint(x, y);
        }
        *r = s;
    }
    let mut bits = 0.0;
    for x in 0..size {
        for y in 0..size {
            let j = joint(x, y);
            if j > 0.0 {
                bits += j * log2(j / ((1.0 / active) * read[y]));
            }
        }
    }
    bits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutual_information_of_clean_and_noisy_channels() {
        let identity = [5.0, 0.0, 0.0, 0.0, 7.0, 0.0, 0.0, 0.0, 3.0];
        assert!((mutual_information(&identity, 3) - 3f64.log2()).abs() < 1e-12);
        let useless = [1.0, 1.0, 1.0, 1.0];
        assert_eq!(mutual_information(&useless, 2), 0.0);
        assert_eq!(mutual_information(&[0.0; 4], 2), 0.0);
    }

    #[test]
    fn sorts_grid_frames() {
        let cols = 10;
        let rows = 16;
        let n = cols * rows;
        let own: alloc::vec::Vec<u8> = (0..n).map(|i| (i % 4) as u8).collect();
        let other: alloc::vec::Vec<u8> = (0..n).map(|i| ((i + 1) % 4) as u8).collect();
        let confidence = alloc::vec![100u8; n];
        let means = alloc::vec![128u8; n * 3];
        let mut state = alloc::vec![0f64; grid_state_len(4)];
        let (status, mean_confidence) = ingest_grid(
            &own,
            &confidence,
            &means,
            &own,
            &other,
            cols,
            rows,
            4,
            &mut state,
        );
        assert_eq!(status, FrameStatus::Clean);
        assert_eq!(mean_confidence, 100.0);
        assert_eq!(state[0], n as f64);
        assert_eq!(state[1], 0.0);
        let mut torn = own.clone();
        torn[n / 2..].copy_from_slice(&other[n / 2..]);
        assert_eq!(
            ingest_grid(
                &torn,
                &confidence,
                &means,
                &own,
                &other,
                cols,
                rows,
                4,
                &mut state
            )
            .0,
            FrameStatus::Torn
        );
        assert_eq!(state[0], n as f64);
    }
}
