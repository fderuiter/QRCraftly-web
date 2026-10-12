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

//! Finding the four corner fiducials (dark rings with a hollow centre and a
//! dark core whose area tells which corner is which), and the projective map
//! from cell coordinates to pixels.
//!
//! Integer work (the Otsu threshold, labelling) and `f64` arithmetic in the
//! order the TypeScript receiver used, so the centres are the same bits.

use alloc::vec::Vec;

use crate::colour::luma;
use crate::fmath::{abs, cos, sin, sqrt};
use crate::Image;

/// A point in image pixels; pixel `(i, j)` covers `[i, i + 1) x [j, j + 1)`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Blob {
    area: u32,
    sum_x: f64,
    sum_y: f64,
    min_x: u32,
    max_x: u32,
    min_y: u32,
    max_y: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Ring {
    centre: Point,
    area: u32,
    core_area: u32,
    /// The ring's dark component in `Scratch::blobs`.
    blob: u32,
}

/// Four fiducial centres, clockwise on screen, the one with the biggest core
/// first, and the core areas in the same order.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Fiducials {
    pub points: [Point; 4],
    pub core_areas: [u32; 4],
}

/// Buffers the search reuses from frame to frame.
#[derive(Default)]
pub struct Scratch {
    luma: Vec<u8>,
    runs: Vec<Run>,
    ids: Vec<u32>,
    blobs: Vec<Blob>,
    centres: Vec<(f64, f64)>,
    rings: Vec<Ring>,
    /// The blob centres filed by square (see [`BucketIndex`]).
    buckets: BucketIndex,
    /// The threshold and image size of the last whole-image labelling, for
    /// [`locate_fiducials_strict`].
    threshold: u8,
    width: usize,
    height: usize,
    /// Rings that passed [`check_ring`], over every stage of the strict search.
    verified: Vec<Verified>,
    /// The verified rings a stage picks four from.
    pool: Vec<Verified>,
    /// Per ring, the map from cells to pixels its outline gives (see [`ring_shapes`]).
    shapes: Vec<Option<[f64; 4]>>,
    /// Per ring, pixel count and first and second moments while they are summed.
    moments: Vec<[f64; 6]>,
    /// Per blob, the ring it is, or `u32::MAX`.
    ring_of: Vec<u32>,
}

/// Side, in pixels, of the squares blob centres are filed under for the core search.
const BUCKET: f64 = 32.0;

/// Blob centres filed in [`BUCKET`]-pixel squares, so a ring looks for its core
/// only among the blobs near it instead of among every blob in the image (#1161:
/// on a 4K capture of random data that loop was most of a whole-image search,
/// and minutes on a frame of pixel noise).
#[derive(Default)]
struct BucketIndex {
    cols: usize,
    rows: usize,
    /// Where each square's blobs start in `items`; one more entry than squares.
    start: Vec<u32>,
    /// Blob indices, square by square, each square's in ascending order.
    items: Vec<u32>,
    /// Next free slot per square while filing.
    fill: Vec<u32>,
}

impl BucketIndex {
    /// The square a point falls in, clamped to the grid.
    fn square(&self, x: f64, y: f64) -> (usize, usize) {
        // `as usize` truncates and saturates: below zero and NaN give 0.
        let bx = ((x / BUCKET) as usize).min(self.cols - 1);
        let by = ((y / BUCKET) as usize).min(self.rows - 1);
        (bx, by)
    }

    /// Files every centre.
    fn build(&mut self, centres: &[(f64, f64)]) {
        let (mut max_x, mut max_y) = (0.0f64, 0.0f64);
        for &(x, y) in centres {
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
        self.cols = (max_x / BUCKET) as usize + 1;
        self.rows = (max_y / BUCKET) as usize + 1;
        let squares = self.cols * self.rows;
        self.start.clear();
        self.start.resize(squares + 1, 0);
        for &(x, y) in centres {
            let (bx, by) = self.square(x, y);
            self.start[by * self.cols + bx + 1] += 1;
        }
        for i in 0..squares {
            self.start[i + 1] += self.start[i];
        }
        self.fill.clear();
        self.fill.extend_from_slice(&self.start[..squares]);
        self.items.clear();
        self.items.resize(centres.len(), 0);
        for (i, &(x, y)) in centres.iter().enumerate() {
            let (bx, by) = self.square(x, y);
            let slot = &mut self.fill[by * self.cols + bx];
            self.items[*slot as usize] = i as u32;
            *slot += 1;
        }
    }

    /// Calls `visit` with the index of every blob whose centre is within `reach` of
    /// (`cx`, `cy`) on both axes, and with others near it, in no particular order.
    fn near(&self, cx: f64, cy: f64, reach: f64, mut visit: impl FnMut(usize)) {
        // A pixel of slack on each side, so rounding in the comparison below cannot
        // drop a blob the full scan would have taken.
        let (bx0, by0) = self.square(cx - reach - 1.0, cy - reach - 1.0);
        let (bx1, by1) = self.square(cx + reach + 1.0, cy + reach + 1.0);
        for by in by0..=by1 {
            let row = by * self.cols;
            let from = self.start[row + bx0] as usize;
            let to = self.start[row + bx1 + 1] as usize;
            for &i in &self.items[from..to] {
                visit(i as usize);
            }
        }
    }
}

fn otsu_threshold(luma: &[u8]) -> u32 {
    let mut hist = [0u32; 256];
    for &v in luma {
        hist[v as usize] += 1;
    }
    otsu_of(&hist)
}

/// Otsu's threshold of a luma histogram.
fn otsu_of(hist: &[u32; 256]) -> u32 {
    let mut total = 0f64;
    let mut sum_all = 0f64;
    for (i, &h) in hist.iter().enumerate() {
        total += h as f64;
        sum_all += (i as u64 * h as u64) as f64;
    }
    let mut weight_back = 0f64;
    let mut sum_back = 0f64;
    let mut best = -1f64;
    let mut threshold = 127;
    for (t, &h) in hist.iter().enumerate() {
        weight_back += h as f64;
        if weight_back == 0.0 {
            continue;
        }
        let weight_front = total - weight_back;
        if weight_front == 0.0 {
            break;
        }
        sum_back += (t as u64 * h as u64) as f64;
        let mean_back = sum_back / weight_back;
        let mean_front = (sum_all - sum_back) / weight_front;
        let between =
            weight_back * weight_front * (mean_back - mean_front) * (mean_back - mean_front);
        if between > best {
            best = between;
            threshold = t as u32;
        }
    }
    threshold
}

/// A horizontal run of dark pixels `[x0, x1)` in row `y`, and the run it is joined to.
#[derive(Clone, Copy, Debug)]
struct Run {
    x0: u32,
    x1: u32,
    y: u32,
    parent: u32,
}

/// The root of a run's component, halving the path on the way.
fn root(runs: &mut [Run], mut at: u32) -> u32 {
    while runs[at as usize].parent != at {
        let parent = runs[at as usize].parent;
        let grand = runs[parent as usize].parent;
        runs[at as usize].parent = grand;
        at = grand;
    }
    at
}

/// Joins two components; the root is the run that comes first in raster order.
fn join(runs: &mut [Run], a: u32, b: u32) {
    let (ra, rb) = (root(runs, a), root(runs, b));
    if ra < rb {
        runs[rb as usize].parent = ra;
    } else if rb < ra {
        runs[ra as usize].parent = rb;
    }
}

/// The 4-connected components of the pixels at or below `threshold`, in the
/// raster order of their first pixel, by runs and union-find. The centre sums
/// are sums of halves far below 2^53, so they are exact in any order.
fn label_dark(scratch: &mut Scratch, width: usize, height: usize, threshold: u8) {
    let Scratch {
        luma,
        runs,
        ids,
        blobs,
        ..
    } = scratch;
    runs.clear();
    blobs.clear();
    let mut previous = 0..0;
    for y in 0..height {
        let row = &luma[y * width..(y + 1) * width];
        let first = runs.len();
        let mut x = 0;
        while x < width {
            if row[x] > threshold {
                x += 1;
                continue;
            }
            let x0 = x;
            while x < width && row[x] <= threshold {
                x += 1;
            }
            let index = runs.len() as u32;
            runs.push(Run {
                x0: x0 as u32,
                x1: x as u32,
                y: y as u32,
                parent: index,
            });
        }
        // Join each run to the runs above that share a column.
        let mut above = previous.start;
        for at in first..runs.len() {
            let (x0, x1) = (runs[at].x0, runs[at].x1);
            while above < previous.end && runs[above].x1 <= x0 {
                above += 1;
            }
            let mut k = above;
            while k < previous.end && runs[k].x0 < x1 {
                join(runs, at as u32, k as u32);
                k += 1;
            }
        }
        previous = first..runs.len();
    }
    // A root is the first run of its component, so after this every run points at its root.
    for at in 0..runs.len() {
        runs[at].parent = root(runs, at as u32);
    }
    // A run that is its own root starts a component; components come out in raster order.
    ids.clear();
    ids.resize(runs.len(), 0);
    for at in 0..runs.len() {
        let Run { x0, x1, y, parent } = runs[at];
        let len = x1 - x0;
        if parent as usize == at {
            ids[at] = blobs.len() as u32;
            blobs.push(Blob {
                area: 0,
                sum_x: 0.0,
                sum_y: 0.0,
                min_x: x0,
                max_x: x1 - 1,
                min_y: y,
                max_y: y,
            });
        }
        let blob = &mut blobs[ids[parent as usize] as usize];
        blob.area += len;
        blob.sum_x += (len as f64) * (x0 + x1) as f64 / 2.0;
        blob.sum_y += (len as f64) * (y as f64 + 0.5);
        blob.min_x = blob.min_x.min(x0);
        blob.max_x = blob.max_x.max(x1 - 1);
        blob.max_y = blob.max_y.max(y);
    }
}

/// Sorts a short slice the way V8's `Array.prototype.sort` does (a run, then
/// binary insertion), so a comparator that is not a consistent order still
/// gives the order the TypeScript receiver got. Only for fewer than 64 items.
pub fn js_sort_small<T: Copy>(items: &mut [T], compare: impl Fn(&T, &T) -> i32) {
    let n = items.len();
    if n < 2 {
        return;
    }
    let mut run = 2;
    let descending = compare(&items[1], &items[0]) < 0;
    let mut previous = items[1];
    while run < n {
        let order = compare(&items[run], &previous);
        if (descending && order >= 0) || (!descending && order < 0) {
            break;
        }
        previous = items[run];
        run += 1;
    }
    if descending {
        items[..run].reverse();
    }
    for start in run..n {
        let pivot = items[start];
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if compare(&pivot, &items[mid]) < 0 {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        items.copy_within(left..start, left + 1);
        items[left] = pivot;
    }
}

/// Orders four items clockwise on screen (image rows grow downwards), by
/// comparing directions from their mean.
fn clockwise<T: Copy>(items: &mut [T; 4], at: impl Fn(&T) -> Point) {
    let mut sx = 0.0;
    let mut sy = 0.0;
    for item in items.iter() {
        sx += at(item).x;
    }
    for item in items.iter() {
        sy += at(item).y;
    }
    let mid = Point {
        x: sx / 4.0,
        y: sy / 4.0,
    };
    let half = |p: Point| -> i32 { i32::from(p.y - mid.y >= 0.0 || (p.y - mid.y).is_nan()) };
    js_sort_small(items, |a, b| {
        let (pa, pb) = (at(a), at(b));
        let (ha, hb) = (half(pa), half(pb));
        if ha != hb {
            return ha - hb;
        }
        let cross = (pa.x - mid.x) * (pb.y - mid.y) - (pa.y - mid.y) * (pb.x - mid.x);
        if cross > 0.0 {
            -1
        } else if cross < 0.0 {
            1
        } else {
            0
        }
    });
}

/// Area of the convex quadrilateral through four points, or 0 when they are
/// not in convex position.
fn quad_span(points: [Point; 4]) -> f64 {
    let mut sorted = points;
    clockwise(&mut sorted, |p| *p);
    let mut area = 0.0;
    for i in 0..4 {
        let p = sorted[i];
        let q = sorted[(i + 1) % 4];
        let r = sorted[(i + 2) % 4];
        let turn = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
        if turn <= 0.0 {
            return 0.0;
        }
        area += p.x * q.y - q.x * p.y;
    }
    abs(area) / 2.0
}

/// Among the ring candidates, the four of similar size that span the most area.
fn best_quad(rings: &mut [Ring]) -> Option<[Ring; 4]> {
    rings.sort_by_key(|ring| core::cmp::Reverse(ring.area));
    let pool = &rings[..rings.len().min(40)];
    let n = pool.len();
    let mut best = None;
    let mut best_span = 0.0;
    let similar = |big: &Ring, small: &Ring| big.area as f64 <= 1.7 * small.area as f64;
    for a in 0..n {
        for b in a + 1..n {
            if !similar(&pool[a], &pool[b]) {
                break;
            }
            for c in b + 1..n {
                if !similar(&pool[a], &pool[c]) {
                    break;
                }
                for d in c + 1..n {
                    if !similar(&pool[a], &pool[d]) {
                        break;
                    }
                    let quad = [pool[a], pool[b], pool[c], pool[d]];
                    let span = quad_span(quad.map(|q| q.centre));
                    if span > best_span {
                        best_span = span;
                        best = Some(quad);
                    }
                }
            }
        }
    }
    best
}

/// Puts every dark component that looks like a fiducial ring, with a smaller
/// component near its centre for a core, in `scratch.rings`.
fn collect_rings(scratch: &mut Scratch) {
    collect_rings_with(scratch, false);
}

/// [`collect_rings`]; `relaxed` keeps any ring-like shape with a core, without
/// the tests that size a ring by its area (see [`locate_fiducials_strict`]).
fn collect_rings_with(scratch: &mut Scratch, relaxed: bool) {
    let Scratch {
        blobs,
        rings,
        centres,
        buckets,
        ..
    } = scratch;
    rings.clear();
    // Each blob's centre, computed once with the same division the search uses.
    centres.clear();
    centres.extend(blobs.iter().map(|b| {
        let area = b.area as f64;
        (b.sum_x / area, b.sum_y / area)
    }));
    buckets.build(centres);
    for (index, blob) in blobs.iter().enumerate() {
        let w = blob.max_x - blob.min_x + 1;
        let h = blob.max_y - blob.min_y + 1;
        if blob.area < 20 || w < 8 || h < 8 || w > 2 * h || h > 2 * w {
            continue;
        }
        let area = blob.area as f64;
        let fill = area / (w * h) as f64;
        if relaxed {
            // A ring thinned by a low threshold fills less of its box.
            if !(0.05..=0.75).contains(&fill) {
                continue;
            }
        } else {
            if !(0.15..=0.75).contains(&fill) {
                continue;
            }
            // A ring is 24 cells and spans 7 to 10 cells whichever way it is turned.
            let cell = sqrt(area / 24.0);
            let (wf, hf) = (w as f64, h as f64);
            if wf < 6.2 * cell || hf < 6.2 * cell || wf > 11.0 * cell || hf > 11.0 * cell {
                continue;
            }
        }
        let cx = blob.sum_x / area;
        let cy = blob.sum_y / area;
        let reach = 0.2 * w.max(h) as f64;
        let mut core_area = 0;
        let mut core_found = false;
        let mut nearest = f64::INFINITY;
        let mut nearest_index = usize::MAX;
        // A square distance this far above the reach's square has a root at or above the
        // reach whatever the rounding, so the root need not be taken.
        let far = reach * reach * (1.0 + 1e-9);
        // Only blobs filed near the ring can be within the reach. The squares are visited
        // out of index order, so a tie goes to the lower index, as it did in a scan of
        // every blob in order: the core, and so the result, is the same.
        buckets.near(cx, cy, reach, |other_index| {
            let other = &blobs[other_index];
            let other_area = other.area as f64;
            if other_index == index || other_area >= area * 0.7 || other_area < 0.03 * area {
                return;
            }
            let (ox, oy) = centres[other_index];
            let dx = ox - cx;
            let dy = oy - cy;
            let square = dx * dx + dy * dy;
            if square > far {
                return;
            }
            let distance = sqrt(square);
            if distance < reach
                && (distance < nearest || (distance == nearest && other_index < nearest_index))
            {
                nearest = distance;
                nearest_index = other_index;
                core_area = other.area;
                core_found = true;
            }
        });
        if !core_found {
            continue;
        }
        rings.push(Ring {
            centre: Point { x: cx, y: cy },
            area: blob.area,
            core_area,
            blob: index as u32,
        });
    }
}

/// Finds the four corner fiducials, or `None` when four similar rings are not found.
pub fn locate_fiducials(image: &Image, scratch: &mut Scratch) -> Option<Fiducials> {
    let (width, height) = (image.width, image.height);
    scratch.luma.clear();
    scratch.luma.extend(
        image
            .data
            .chunks_exact(4)
            .map(|px| luma(px[0] as u32, px[1] as u32, px[2] as u32) as u8),
    );
    let threshold = otsu_threshold(&scratch.luma) as u8;
    scratch.threshold = threshold;
    scratch.width = width;
    scratch.height = height;
    label_dark(scratch, width, height, threshold);
    collect_rings(scratch);
    let rings = &mut scratch.rings;
    let mut group = best_quad(rings)?;
    clockwise(&mut group, |c| c.centre);
    let mut first = 0;
    for i in 1..4 {
        if group[i].core_area > group[first].core_area {
            first = i;
        }
    }
    let mut out = Fiducials::default();
    for i in 0..4 {
        let ring = group[(first + i) % 4];
        out.points[i] = ring.centre;
        out.core_areas[i] = ring.core_area;
    }
    Some(out)
}

/// Whether cell (`dx`, `dy`) of fiducial `index`'s 9 x 9 block is dark: a 7 x 7
/// dark ring, a light ring and a core of 9, 7, 5 or 3 dark cells
/// (`fiducialCellIsDark` in `layout.ts`).
fn fiducial_dark(index: u32, dx: i32, dy: i32) -> bool {
    if !(1..=7).contains(&dx) || !(1..=7).contains(&dy) {
        return false;
    }
    if dx == 1 || dx == 7 || dy == 1 || dy == 7 {
        return true;
    }
    if !(3..=5).contains(&dx) || !(3..=5).contains(&dy) {
        return false;
    }
    let corner = (dx == 3 || dx == 5) && (dy == 3 || dy == 5);
    let edge_middle_vertical = dx == 4 && (dy == 3 || dy == 5);
    match index {
        0 => true,
        1 => !(corner && dx == dy),
        2 => !corner,
        _ => !corner && !edge_middle_vertical,
    }
}

/// Angles the strict ring check tries: 0 to 88 degrees in steps of 2 (a square
/// ring repeats every 90).
const STRICT_ANGLES: usize = 45;
/// Fewest luma levels between a candidate's dark and light cells.
const MIN_RING_CONTRAST: u32 = 40;
/// Most of a block's 81 cells that may disagree with the fiducial pattern.
const STRICT_TOLERANCE: u32 = 8;
/// Most rings, fewest disagreements first, the strict search picks four from.
const STRICT_POOL: usize = 24;
/// Most times the biggest of four verified rings may outsize the smallest. The
/// far side of a screen seen at an angle is smaller along both axes: with the far
/// edge 25% shorter than the near one, its rings have about 0.75^3 of the area,
/// and a threshold thins small rings more than big ones.
const STRICT_AREA_RATIO: f64 = 4.0;

/// What [`check_ring`] found.
#[derive(Clone, Copy, Debug)]
struct Check {
    /// Cells of the block that disagree with the fiducial pattern.
    misses: u32,
    /// Which fiducial the core reads as.
    core: u32,
    /// The candidate's own threshold between dark and light.
    threshold: u8,
}

/// A ring that passed [`check_ring`].
#[derive(Clone, Copy, Debug)]
struct Verified {
    ring: Ring,
    /// Cells of its block that disagree with the fiducial pattern.
    misses: u32,
    /// Which fiducial its core reads as.
    core: u32,
}

/// Checks a ring candidate cell by cell against the fiducial pattern. The 9 x 9
/// cells around `centre` are sampled through `shape` (a linear map from cells to
/// pixels, see [`ring_shapes`]) turned by each of [`STRICT_ANGLES`] angles, and
/// thresholded halfway between the darkest and the lightest tenth of them, so
/// each candidate sets its own threshold; the ring, the light ring
/// and the margin must match, and the core must match one of the four cores in
/// one of four quarter turns. The fewest disagreements, the core that fits
/// best and the threshold, or `None` when every angle disagrees on more than
/// [`STRICT_TOLERANCE`] cells.
fn check_ring(
    scratch: &Scratch,
    centre: Point,
    shape: &[f64; 4],
    trig: &[(f64, f64); STRICT_ANGLES],
) -> Option<Check> {
    let (width, height) = (scratch.width, scratch.height);
    // Where cell (u, v) of the block, counted from its centre, lands: `shape` takes the
    // ring's square to the ring seen, up to a turn (see [`ring_shapes`]).
    let at = |u: f64, v: f64| -> (f64, f64) {
        (
            centre.x + shape[0] * u + shape[1] * v,
            centre.y + shape[2] * u + shape[3] * v,
        )
    };
    // Off the image counts as light: a fiducial's margin is light.
    let sample = |x: f64, y: f64| -> u8 {
        if x < 0.0 || y < 0.0 || x >= width as f64 || y >= height as f64 {
            255
        } else {
            scratch.luma[y as usize * width + x as usize]
        }
    };
    // The candidate's own threshold, from its 81 cells unturned: a fiducial's block always
    // holds both dark and light cells, whatever the threshold that found it.
    let mut values = [0u8; 81];
    for (k, v) in values.iter_mut().enumerate() {
        let (x, y) = at((k % 9) as f64 - 4.0, (k / 9) as f64 - 4.0);
        *v = sample(x, y);
    }
    values.sort_unstable();
    let (low, high) = (values[8] as u32, values[72] as u32);
    if high < low + MIN_RING_CONTRAST {
        return None;
    }
    let threshold = ((low + high) / 2) as u8;
    let mut best: Option<Check> = None;
    for &(c, s) in trig.iter() {
        let mut dark = [false; 81];
        let mut misses = 0u32;
        for (k, seen) in dark.iter_mut().enumerate() {
            let (dx, dy) = ((k % 9) as i32, (k / 9) as i32);
            let (u, v) = (dx as f64 - 4.0, dy as f64 - 4.0);
            let (x, y) = at(u * c - v * s, u * s + v * c);
            let d = sample(x, y) <= threshold;
            *seen = d;
            let in_core = (3..=5).contains(&dx) && (3..=5).contains(&dy);
            if !in_core && d != fiducial_dark(0, dx, dy) {
                misses += 1;
                if misses > STRICT_TOLERANCE {
                    break;
                }
            }
        }
        if misses > STRICT_TOLERANCE {
            continue;
        }
        // The core in any quarter turn: which fiducial this is.
        let mut core = (u32::MAX, 0u32);
        for index in 0..4u32 {
            for turn in 0..4 {
                let mut core_misses = 0;
                for dy in -1..=1i32 {
                    for dx in -1..=1i32 {
                        let (rx, ry) = match turn {
                            0 => (dx, dy),
                            1 => (-dy, dx),
                            2 => (-dx, -dy),
                            _ => (dy, -dx),
                        };
                        let seen = dark[((dy + 4) * 9 + dx + 4) as usize];
                        if seen != fiducial_dark(index, rx + 4, ry + 4) {
                            core_misses += 1;
                        }
                    }
                }
                if core_misses < core.0 {
                    core = (core_misses, index);
                }
            }
        }
        let total = misses + core.0;
        if total <= STRICT_TOLERANCE && best.is_none_or(|b| total < b.misses) {
            best = Some(Check {
                misses: total,
                core: core.1,
                threshold,
            });
        }
    }
    best
}

/// The whole-image search again, for a frame whose four rings
/// [`locate_fiducials`] chose did not give a header (#1161, ADR 0047). On a large
/// grid, random data forms dark components that pass the ring test, often bigger
/// than the fiducials; a dark surround can pull the threshold low enough to thin
/// the real rings out of it; and on a screen seen at an angle the far rings are
/// much smaller than the near ones. Here every candidate must match the
/// fiducial pattern cell by cell ([`check_ring`]), which those data rings do not.
/// Rings that pass are kept from stage to stage, and after each stage the best
/// four ([`best_strict_quad`]) go to `reads`, which says whether they give a
/// frame. The stages, each only when the ones before gave none:
///
/// 1. the candidates [`locate_fiducials`] collected;
/// 2. candidates collected again by shape alone, without the size test;
/// 3. small dark components with a light ring around them, as the cores of
///    fiducials whose own ring merged with its surround (a blurred far ring,
///    grey, touching the bezel or the data), each checked at a few cell sizes
///    ([`verify_cores`]);
/// 4. stages 2 and 3 again under two other thresholds: Otsu's over everything
///    but the largest dark component that touches the image's edge (the bezel,
///    [`screen_threshold`]), and Otsu's over the pixels lighter than the first
///    threshold ([`upper_threshold`]);
/// 5. stage 3 again under a threshold where it could not run before for want of
///    a verified ring to size the cores by;
/// 6. the fourth fiducial, when three verified rings read as three different
///    fiducials, looked for around where they put it ([`complete_quad`]).
///
/// Runs on the scratch [`locate_fiducials`] left, so it must follow it on the
/// same image. The four that `reads` accepted, or `None`.
pub fn locate_fiducials_strict(
    scratch: &mut Scratch,
    mut reads: impl FnMut(&Fiducials) -> bool,
) -> Option<Fiducials> {
    let mut trig = [(0.0, 0.0); STRICT_ANGLES];
    for (k, t) in trig.iter_mut().enumerate() {
        let angle = k as f64 * core::f64::consts::PI / 90.0;
        *t = (cos(angle), sin(angle));
    }
    scratch.verified.clear();
    let mut last: Option<Fiducials> = None;
    let mut attempt = |scratch: &mut Scratch| -> Option<Fiducials> {
        let found = choose_strict(scratch)?;
        if last == Some(found) {
            return None;
        }
        last = Some(found);
        reads(&found).then_some(found)
    };
    let (width, height) = (scratch.width, scratch.height);
    let original = scratch.threshold;
    // The other thresholds, worked out before the first labelling is replaced.
    let others = [screen_threshold(scratch), upper_threshold(scratch)];
    verify_rings(scratch, &trig);
    if let Some(found) = attempt(scratch) {
        return Some(found);
    }
    let mut tried = [original; 3];
    let mut cores_skipped = [false; 3];
    for (k, threshold) in core::iter::once(Some(original)).chain(others).enumerate() {
        let Some(threshold) = threshold else {
            continue;
        };
        if k > 0 {
            if tried[..k].contains(&threshold) {
                continue;
            }
            scratch.threshold = threshold;
            label_dark(scratch, width, height, threshold);
        }
        tried[k] = threshold;
        collect_rings_with(scratch, true);
        verify_rings(scratch, &trig);
        if let Some(found) = attempt(scratch) {
            return Some(found);
        }
        cores_skipped[k] = !verify_cores(scratch, &trig);
        if let Some(found) = attempt(scratch) {
            return Some(found);
        }
    }
    // A labelling where stage 3 found no verified ring to size cores by may hold the
    // cores of the far rings (a lower threshold keeps a grey ring and the light ring
    // inside it apart): now that a later labelling verified a ring, look again.
    if scratch.verified.is_empty() {
        return None;
    }
    for k in 0..3 {
        if !cores_skipped[k] || tried[..k].contains(&tried[k]) {
            continue;
        }
        scratch.threshold = tried[k];
        label_dark(scratch, width, height, tried[k]);
        verify_cores(scratch, &trig);
        if let Some(found) = attempt(scratch) {
            return Some(found);
        }
    }
    complete_quad(scratch, &trig);
    attempt(scratch)
}

/// Otsu's threshold over the pixels lighter than the whole-image threshold: it
/// splits a screen's light cells from its grey ones, such as the rings and cores
/// of far, blurred fiducials, which a dark surround leaves on the light side of
/// the first threshold. `None` when too few pixels are lighter.
fn upper_threshold(scratch: &Scratch) -> Option<u8> {
    let mut hist = [0u32; 256];
    for &v in scratch.luma.iter() {
        if v > scratch.threshold {
            hist[v as usize] += 1;
        }
    }
    let count: u32 = hist.iter().sum();
    if (count as usize) < scratch.luma.len() / 16 {
        return None;
    }
    Some(otsu_of(&hist) as u8)
}

/// Adds a ring that passed [`check_ring`] to `scratch.verified`, unless one
/// already there is within a cell of it.
fn add_verified(verified: &mut Vec<Verified>, found: Verified) {
    let near = verified.iter().any(|v| {
        let (dx, dy) = (
            v.ring.centre.x - found.ring.centre.x,
            v.ring.centre.y - found.ring.centre.y,
        );
        dx * dx + dy * dy < v.ring.area as f64 / 24.0
    });
    if !near {
        verified.push(found);
    }
}

/// Checks every ring in `scratch.rings` against the fiducial pattern, through
/// the shape its outline gives ([`ring_shapes`]).
fn verify_rings(scratch: &mut Scratch, trig: &[(f64, f64); STRICT_ANGLES]) {
    ring_shapes(scratch);
    let mut verified = core::mem::take(&mut scratch.verified);
    for (ring, shape) in scratch.rings.iter().zip(scratch.shapes.iter()) {
        let Some(shape) = shape else {
            continue;
        };
        if let Some(Check { misses, core, .. }) = check_ring(scratch, ring.centre, shape, trig) {
            let ring = *ring;
            add_verified(&mut verified, Verified { ring, misses, core });
        }
    }
    scratch.verified = verified;
}

/// Step between the cell sizes a core is checked at.
const CORE_SCALE_STEP: f64 = 1.1;
/// Smallest cell, in pixels, a core is checked at.
const MIN_CORE_CELL: f64 = 1.5;
/// Largest core side, in pixels, checked.
const MAX_CORE_SIDE: u32 = 64;

/// Stage 3 of [`locate_fiducials_strict`]: every small dark component of the
/// current labelling is taken for a fiducial's core and checked against the
/// whole pattern at cell sizes in steps of [`CORE_SCALE_STEP`]. A thresholded
/// core is anything from about one cell across (blurred, under a low threshold)
/// to over three (a high one), so the sizes run from its side / 3.6 to its side,
/// and within 0.35 to 1.15 times the biggest verified ring's cell, since the far
/// rings of a screen seen at an angle are smaller than the near ones. The stage
/// only runs once an earlier one has verified a ring. Before the pattern check,
/// the light ring between core and ring must be light in eight directions. A core's centre is its
/// fiducial's centre: every core is symmetric under a half turn.
fn verify_cores(scratch: &mut Scratch, trig: &[(f64, f64); STRICT_ANGLES]) -> bool {
    let (width, height) = (scratch.width, scratch.height);
    let threshold = scratch.threshold;
    let mut verified = core::mem::take(&mut scratch.verified);
    // Only near rings already verified: a picture with no fiducial in it should not pay
    // for this stage.
    let Some(reference) = verified
        .iter()
        .map(|v| v.ring.area)
        .max()
        .map(|area| sqrt(area as f64 / 24.0))
    else {
        scratch.verified = verified;
        return false;
    };
    let light = |x: f64, y: f64| -> bool {
        x < 0.0
            || y < 0.0
            || x >= width as f64
            || y >= height as f64
            || scratch.luma[y as usize * width + x as usize] > threshold
    };
    for (index, blob) in scratch.blobs.iter().enumerate() {
        let w = blob.max_x - blob.min_x + 1;
        let h = blob.max_y - blob.min_y + 1;
        let side = w.max(h);
        if blob.area < 2 || side > MAX_CORE_SIDE {
            continue;
        }
        let low = (side as f64 / 3.6).max(MIN_CORE_CELL).max(0.35 * reference);
        let high = (side as f64).min(1.15 * reference);
        if low > high {
            continue;
        }
        let area = blob.area as f64;
        let centre = Point {
            x: blob.sum_x / area,
            y: blob.sum_y / area,
        };
        let mut best: Option<Verified> = None;
        let mut size = low;
        while size <= high {
            let cell = size;
            size *= CORE_SCALE_STEP;
            // The light ring between core and ring, in eight directions, at 2 cells from the
            // centre: the middle of the light ring along the axes, and on the diagonals the
            // outer tip of a core's corner cell, which blur at these cell sizes leaves light.
            // At 2.3 cells, clear of the corners, the samples came close enough to the ring
            // for blur to darken them, and fewer far cores were found on the development set.
            let gap = 2.0 * cell;
            let diagonal = gap * core::f64::consts::FRAC_1_SQRT_2;
            let around = [
                (gap, 0.0),
                (-gap, 0.0),
                (0.0, gap),
                (0.0, -gap),
                (diagonal, diagonal),
                (diagonal, -diagonal),
                (-diagonal, diagonal),
                (-diagonal, -diagonal),
            ];
            if !around
                .iter()
                .all(|&(dx, dy)| light(centre.x + dx, centre.y + dy))
            {
                continue;
            }
            let ring = Ring {
                centre,
                // What a ring of 24 cells this size would cover, for the size test.
                area: (24.0 * cell * cell) as u32,
                core_area: blob.area,
                blob: index as u32,
            };
            let shape = [cell, 0.0, 0.0, cell];
            if let Some(Check { misses, core, .. }) = check_ring(scratch, centre, &shape, trig) {
                if best.is_none_or(|b| misses < b.misses) {
                    best = Some(Verified { ring, misses, core });
                }
            }
        }
        if let Some(found) = best {
            add_verified(&mut verified, found);
        }
    }
    scratch.verified = verified;
    true
}

/// Fraction of the longer of its two edges the fourth fiducial is looked for
/// within, around where a parallelogram through the other three puts it: the
/// far corner of a screen seen at an angle sits short of that.
const COMPLETION_REACH: f64 = 0.2;
/// Least luma step between a candidate core and the light ring around it in the
/// completion search's quick test.
const COMPLETION_CONTRAST: u32 = 24;

/// Stage 6 of [`locate_fiducials_strict`]: when three verified rings read as
/// three different fiducials, the fourth is looked for in a window around where
/// a parallelogram through them puts it, at every position on a grid of a third
/// of a cell and at cell sizes between its two neighbours', with the cell-by-cell
/// check ([`check_ring`]) and its own threshold rather than a labelling, which
/// a far, blurred fiducial can fall through (a grey core that merges with its
/// ring under every global threshold). A quick test first: the light ring two
/// cells out must be lighter than the centre in eight directions. The centre
/// found is then refined to the centroid of the core's dark pixels. Adds what it
/// finds to `scratch.verified`.
fn complete_quad(scratch: &mut Scratch, trig: &[(f64, f64); STRICT_ANGLES]) {
    let (width, height) = (scratch.width, scratch.height);
    // The verified ring with the fewest disagreements for each fiducial.
    let mut known: [Option<Verified>; 4] = [None; 4];
    for v in scratch.verified.iter() {
        let slot = &mut known[v.core as usize];
        if slot.is_none_or(|k| v.misses < k.misses) {
            *slot = Some(*v);
        }
    }
    if known.iter().filter(|k| k.is_some()).count() != 3 {
        return;
    }
    let Some(missing) = known.iter().position(|k| k.is_none()) else {
        return;
    };
    // Fiducials 0 and 3, and 1 and 2, are opposite corners.
    let opposite = 3 - missing;
    let neighbours: [usize; 2] = match missing {
        0 | 3 => [1, 2],
        _ => [0, 3],
    };
    let (Some(o), Some(a), Some(b)) = (known[opposite], known[neighbours[0]], known[neighbours[1]])
    else {
        return;
    };
    let (o, a, b) = (o.ring.centre, a.ring, b.ring);
    let predicted = Point {
        x: a.centre.x + b.centre.x - o.x,
        y: a.centre.y + b.centre.y - o.y,
    };
    let edge = |p: Point| sqrt((p.x - o.x) * (p.x - o.x) + (p.y - o.y) * (p.y - o.y));
    let reach = COMPLETION_REACH * edge(a.centre).max(edge(b.centre));
    let (cell_a, cell_b) = (sqrt(a.area as f64 / 24.0), sqrt(b.area as f64 / 24.0));
    let low = (0.7 * cell_a.min(cell_b)).max(MIN_CORE_CELL);
    let high = 1.15 * cell_a.max(cell_b);
    let step = (low / 3.0).max(1.0);
    let luma = |x: f64, y: f64| -> u32 {
        if x < 0.0 || y < 0.0 || x >= width as f64 || y >= height as f64 {
            255
        } else {
            scratch.luma[y as usize * width + x as usize] as u32
        }
    };
    let mut best: Option<(Check, Point, f64)> = None;
    let mut y = predicted.y - reach;
    while y <= predicted.y + reach {
        let mut x = predicted.x - reach;
        while x <= predicted.x + reach {
            let centre = Point { x, y };
            let middle = luma(x, y);
            let mut cell = low;
            while cell <= high {
                let size = cell;
                cell *= CORE_SCALE_STEP;
                let gap = 2.0 * size;
                let diagonal = gap * core::f64::consts::FRAC_1_SQRT_2;
                let around = [
                    (gap, 0.0),
                    (-gap, 0.0),
                    (0.0, gap),
                    (0.0, -gap),
                    (diagonal, diagonal),
                    (diagonal, -diagonal),
                    (-diagonal, diagonal),
                    (-diagonal, -diagonal),
                ];
                if !around
                    .iter()
                    .all(|&(dx, dy)| luma(x + dx, y + dy) >= middle + COMPLETION_CONTRAST)
                {
                    continue;
                }
                let shape = [size, 0.0, 0.0, size];
                if let Some(check) = check_ring(scratch, centre, &shape, trig) {
                    if best.is_none_or(|b| check.misses < b.0.misses) {
                        best = Some((check, centre, size));
                    }
                }
            }
            x += step;
        }
        y += step;
    }
    let Some((check, centre, size)) = best else {
        return;
    };
    if check.core != missing as u32 {
        return;
    }
    // The core's dark pixels within one and a half cells: every core is symmetric under a
    // half turn, so their centroid is the fiducial's centre. A few rounds, since the
    // window moves with the estimate.
    let radius = 1.5 * size;
    let mut centre = centre;
    let mut core_area = 0;
    for _ in 0..3 {
        let (mut n, mut sx, mut sy) = (0u32, 0.0, 0.0);
        let x0 = (centre.x - radius).max(0.0) as usize;
        let y0 = (centre.y - radius).max(0.0) as usize;
        let x1 = ((centre.x + radius).max(0.0) as usize + 1).min(width);
        let y1 = ((centre.y + radius).max(0.0) as usize + 1).min(height);
        for py in y0..y1 {
            for px in x0..x1 {
                let (cx, cy) = (px as f64 + 0.5, py as f64 + 0.5);
                let (dx, dy) = (cx - centre.x, cy - centre.y);
                if dx * dx + dy * dy <= radius * radius
                    && scratch.luma[py * width + px] <= check.threshold
                {
                    n += 1;
                    sx += cx;
                    sy += cy;
                }
            }
        }
        if n == 0 {
            break;
        }
        core_area = n;
        centre = Point {
            x: sx / n as f64,
            y: sy / n as f64,
        };
    }
    let ring = Ring {
        centre,
        area: (24.0 * size * size) as u32,
        core_area,
        blob: u32::MAX,
    };
    add_verified(
        &mut scratch.verified,
        Verified {
            ring,
            misses: check.misses,
            core: check.core,
        },
    );
}

/// Otsu's threshold over the pixels outside the largest dark component that
/// touches the image's edge, from the labelling [`locate_fiducials`] left;
/// `None` when no dark component touches the edge.
fn screen_threshold(scratch: &Scratch) -> Option<u8> {
    let (width, height) = (scratch.width, scratch.height);
    let mut surround = None;
    let mut biggest = 0;
    for (i, b) in scratch.blobs.iter().enumerate() {
        let edge = b.min_x == 0
            || b.min_y == 0
            || b.max_x as usize == width - 1
            || b.max_y as usize == height - 1;
        if edge && b.area > biggest {
            biggest = b.area;
            surround = Some(i as u32);
        }
    }
    let surround = surround?;
    let mut hist = [0u32; 256];
    for &v in scratch.luma.iter() {
        hist[v as usize] += 1;
    }
    for run in scratch.runs.iter() {
        if scratch.ids[run.parent as usize] != surround {
            continue;
        }
        let row = run.y as usize * width;
        for &v in &scratch.luma[row + run.x0 as usize..row + run.x1 as usize] {
            hist[v as usize] -= 1;
        }
    }
    Some(otsu_of(&hist) as u8)
}

/// Picks four of the verified rings (see [`best_strict_quad`]) and numbers them.
fn choose_strict(scratch: &mut Scratch) -> Option<Fiducials> {
    let mut pool = core::mem::take(&mut scratch.pool);
    pool.clear();
    pool.extend_from_slice(&scratch.verified);
    // Fewest disagreements first; a stable sort keeps the order they were found in among equals.
    pool.sort_by_key(|v| v.misses);
    pool.truncate(STRICT_POOL);
    let chosen = best_strict_quad(&pool);
    scratch.pool = pool;
    let (mut group, distinct) = chosen?;
    clockwise(&mut group, |g| g.ring.centre);
    // Number from the ring whose core reads as fiducial 0, or else, as
    // `locate_fiducials` does, from the biggest core. `read_frame` tries all
    // four numberings either way.
    let mut first = 0;
    for i in 1..4 {
        let better = if distinct {
            group[i].core < group[first].core
        } else {
            group[i].ring.core_area > group[first].ring.core_area
        };
        if better {
            first = i;
        }
    }
    let mut out = Fiducials::default();
    for i in 0..4 {
        let ring = group[(first + i) % 4].ring;
        out.points[i] = ring.centre;
        out.core_areas[i] = ring.core_area;
    }
    Some(out)
}

/// The variance, in square cells along either axis, of the pixels of a fiducial's
/// dark ring (a 7 x 7 square less the 5 x 5 inside it): (7^4 - 5^4) / 12 / 24.
const RING_VARIANCE: f64 = 1776.0 / 288.0;

/// For each ring in `scratch.rings`, the linear map from cells (counted from the
/// block's centre) to pixels that its outline gives, up to a turn: the square
/// root of the ring's pixel covariance over [`RING_VARIANCE`]. A square ring seen
/// through any affine map `A` has covariance `A A^T` times that variance, so the
/// map recovers the cell size along each axis and the shear that perspective
/// adds, which a bounding box cannot. `None` for a degenerate ring.
fn ring_shapes(scratch: &mut Scratch) {
    let Scratch {
        runs,
        ids,
        blobs,
        rings,
        shapes,
        moments,
        ring_of,
        ..
    } = scratch;
    ring_of.clear();
    ring_of.resize(blobs.len(), u32::MAX);
    for (i, ring) in rings.iter().enumerate() {
        ring_of[ring.blob as usize] = i as u32;
    }
    moments.clear();
    moments.resize(rings.len(), [0.0; 6]);
    for run in runs.iter() {
        let i = ring_of[ids[run.parent as usize] as usize];
        if i == u32::MAX {
            continue;
        }
        let m = &mut moments[i as usize];
        let y = run.y as f64 + 0.5;
        for x in run.x0..run.x1 {
            let x = x as f64 + 0.5;
            m[0] += 1.0;
            m[1] += x;
            m[2] += y;
            m[3] += x * x;
            m[4] += x * y;
            m[5] += y * y;
        }
    }
    shapes.clear();
    shapes.extend(moments.iter().map(|m| {
        let n = m[0];
        let (mx, my) = (m[1] / n, m[2] / n);
        // A pixel is a unit square, which adds 1/12 to the variance of its centre.
        let a = (m[3] / n - mx * mx + 1.0 / 12.0) / RING_VARIANCE;
        let b = (m[4] / n - mx * my) / RING_VARIANCE;
        let c = (m[5] / n - my * my + 1.0 / 12.0) / RING_VARIANCE;
        let det = a * c - b * b;
        // Also refuses NaN, from a ring of no pixels.
        if det.is_nan() || det <= 0.0 || a <= 0.0 {
            return None;
        }
        // The symmetric square root of [[a, b], [b, c]].
        let root = sqrt(det);
        let t = sqrt(a + c + 2.0 * root);
        Some([(a + root) / t, b / t, b / t, (c + root) / t])
    }));
}

/// Whether four verified rings read as the four different fiducials, in the
/// frame's order around the quad (top-left, top-right, bottom-right,
/// bottom-left, either way round, so a mirrored picture also counts).
fn in_layout(mut group: [Verified; 4]) -> bool {
    clockwise(&mut group, |g| g.ring.centre);
    let cores = group.map(|g| g.core);
    let Some(start) = cores.iter().position(|&c| c == 0) else {
        return false;
    };
    let turned = [0, 1, 2, 3].map(|i| cores[(start + i) % 4]);
    turned == [0, 1, 3, 2] || turned == [0, 2, 3, 1]
}

/// Among verified rings, the four whose cores read as the four fiducials in the
/// frame's layout ([`in_layout`]), or failing that any four of similar size
/// (within [`STRICT_AREA_RATIO`]), that span the most area, and whether they
/// were in layout.
fn best_strict_quad(verified: &[Verified]) -> Option<([Verified; 4], bool)> {
    let n = verified.len();
    let mut best: Option<([usize; 4], bool, f64)> = None;
    for a in 0..n {
        for b in a + 1..n {
            for c in b + 1..n {
                for d in c + 1..n {
                    let pick = [a, b, c, d];
                    let distinct = in_layout(pick.map(|i| verified[i]));
                    // Four rings whose cores sit where the frame puts them need no size test;
                    // others must be of similar size.
                    let areas = pick.map(|i| verified[i].ring.area);
                    let lo = areas.iter().copied().min().unwrap_or(0);
                    let hi = areas.iter().copied().max().unwrap_or(0);
                    if !distinct && hi as f64 > STRICT_AREA_RATIO * lo as f64 {
                        continue;
                    }
                    let span = quad_span(pick.map(|i| verified[i].ring.centre));
                    if span <= 0.0 {
                        continue;
                    }
                    let better = match best {
                        None => true,
                        Some((_, best_distinct, best_span)) => {
                            (distinct && !best_distinct)
                                || (distinct == best_distinct && span > best_span)
                        }
                    };
                    if better {
                        best = Some((pick, distinct, span));
                    }
                }
            }
        }
    }
    best.map(|(pick, distinct, _)| (pick.map(|i| verified[i]), distinct))
}

/// Smallest window side, in pixels, a tracked search accepts.
const MIN_WINDOW: usize = 16;

/// Finds the four fiducials again near their centres in an earlier frame
/// (#1161): each is searched for only in the square of `radius` pixels around
/// its old centre, so a receiver that has locked on to a frame does not label
/// the whole image again. The numbering of `previous` is kept. `None` when a
/// window is off the image or holds no ring; the caller then searches the
/// whole frame with [`locate_fiducials`].
pub fn track_fiducials(
    image: &Image,
    scratch: &mut Scratch,
    previous: &Fiducials,
    radius: f64,
) -> Option<Fiducials> {
    let (width, height) = (image.width, image.height);
    // Also refuses a radius that is not a number.
    if radius.is_nan() || radius < MIN_WINDOW as f64 / 2.0 {
        return None;
    }
    let mut out = Fiducials::default();
    for (i, p) in previous.points.iter().enumerate() {
        if !p.x.is_finite() || !p.y.is_finite() {
            return None;
        }
        let span = |centre: f64, size: usize| -> (usize, usize) {
            let low = (centre - radius).max(0.0).min(size as f64) as usize;
            // One past the truncation covers the ceiling without `std`.
            let high = ((centre + radius).max(0.0).min(size as f64) as usize + 1).min(size);
            (low, high)
        };
        let (x0, x1) = span(p.x, width);
        let (y0, y1) = span(p.y, height);
        if x1 < x0 + MIN_WINDOW || y1 < y0 + MIN_WINDOW {
            return None;
        }
        let w = x1 - x0;
        scratch.luma.clear();
        for y in y0..y1 {
            let row = &image.data[(y * width + x0) * 4..(y * width + x1) * 4];
            scratch.luma.extend(
                row.chunks_exact(4)
                    .map(|px| luma(px[0] as u32, px[1] as u32, px[2] as u32) as u8),
            );
        }
        let threshold = otsu_threshold(&scratch.luma) as u8;
        label_dark(scratch, w, y1 - y0, threshold);
        collect_rings(scratch);
        let local = Point {
            x: p.x - x0 as f64,
            y: p.y - y0 as f64,
        };
        let square = |r: &Ring| {
            let (dx, dy) = (r.centre.x - local.x, r.centre.y - local.y);
            dx * dx + dy * dy
        };
        let mut best: Option<&Ring> = None;
        for ring in scratch.rings.iter() {
            if best.is_none_or(|b| square(ring) < square(b)) {
                best = Some(ring);
            }
        }
        let ring = best.filter(|r| square(r) <= radius * radius)?;
        out.points[i] = Point {
            x: ring.centre.x + x0 as f64,
            y: ring.centre.y + y0 as f64,
        };
        out.core_areas[i] = ring.core_area;
    }
    Some(out)
}

/// Solves the projective map from cell coordinates to image pixels through
/// four point pairs: `h0..h7, 1`, row-major. `None` when the points are degenerate.
#[allow(clippy::needless_range_loop)]
pub fn solve_homography(source: &[(f64, f64); 4], target: &[Point; 4]) -> Option<[f64; 9]> {
    let mut a = [[0f64; 9]; 8];
    for i in 0..4 {
        let (u, v) = source[i];
        let Point { x, y } = target[i];
        a[2 * i] = [u, v, 1.0, 0.0, 0.0, 0.0, -u * x, -v * x, x];
        a[2 * i + 1] = [0.0, 0.0, 0.0, u, v, 1.0, -u * y, -v * y, y];
    }
    for col in 0..8 {
        let mut pivot = col;
        for row in col + 1..8 {
            if abs(a[row][col]) > abs(a[pivot][col]) {
                pivot = row;
            }
        }
        if abs(a[pivot][col]) < 1e-12 {
            return None;
        }
        a.swap(col, pivot);
        for row in 0..8 {
            if row == col {
                continue;
            }
            let factor = a[row][col] / a[col][col];
            for k in col..9 {
                a[row][k] -= factor * a[col][k];
            }
        }
    }
    let mut h = [0f64; 9];
    for i in 0..8 {
        h[i] = a[i][8] / a[i][i];
    }
    h[8] = 1.0;
    Some(h)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ring search before the bucket index (#1161): every blob against every
    /// candidate, in index order. Kept to prove the index changes nothing.
    fn collect_rings_full_scan(scratch: &Scratch) -> Vec<Ring> {
        let blobs = &scratch.blobs;
        let centres: Vec<(f64, f64)> = blobs
            .iter()
            .map(|b| {
                let area = b.area as f64;
                (b.sum_x / area, b.sum_y / area)
            })
            .collect();
        let mut rings = Vec::new();
        for (index, blob) in blobs.iter().enumerate() {
            let w = blob.max_x - blob.min_x + 1;
            let h = blob.max_y - blob.min_y + 1;
            if blob.area < 20 || w < 8 || h < 8 || w > 2 * h || h > 2 * w {
                continue;
            }
            let area = blob.area as f64;
            let fill = area / (w * h) as f64;
            if !(0.15..=0.75).contains(&fill) {
                continue;
            }
            let cell = sqrt(area / 24.0);
            let (wf, hf) = (w as f64, h as f64);
            if wf < 6.2 * cell || hf < 6.2 * cell || wf > 11.0 * cell || hf > 11.0 * cell {
                continue;
            }
            let cx = blob.sum_x / area;
            let cy = blob.sum_y / area;
            let reach = 0.2 * w.max(h) as f64;
            let mut core_area = 0;
            let mut core_found = false;
            let mut nearest = f64::INFINITY;
            let far = reach * reach * (1.0 + 1e-9);
            for (other_index, other) in blobs.iter().enumerate() {
                let other_area = other.area as f64;
                if other_index == index || other_area >= area * 0.7 || other_area < 0.03 * area {
                    continue;
                }
                let (ox, oy) = centres[other_index];
                let dx = ox - cx;
                let dy = oy - cy;
                let square = dx * dx + dy * dy;
                if square > far {
                    continue;
                }
                let distance = sqrt(square);
                if distance < reach && distance < nearest {
                    nearest = distance;
                    core_area = other.area;
                    core_found = true;
                }
            }
            if core_found {
                rings.push(Ring {
                    centre: Point { x: cx, y: cy },
                    area: blob.area,
                    core_area,
                    blob: index as u32,
                });
            }
        }
        rings
    }

    /// Paints a fiducial's 9 x 9 block, `cell` pixels a cell, from (`x0`, `y0`).
    fn paint_fiducial(
        luma: &mut [u8],
        width: usize,
        x0: usize,
        y0: usize,
        cell: usize,
        index: u32,
    ) {
        let height = luma.len() / width;
        for dy in 0..9 * cell {
            for dx in 0..9 * cell {
                let (x, y) = (x0 + dx, y0 + dy);
                if x < width && y < height {
                    let dark = fiducial_dark(index, (dx / cell) as i32, (dy / cell) as i32);
                    luma[y * width + x] = if dark { 20 } else { 230 };
                }
            }
        }
    }

    /// Paints a ring of 7 x 7 cells of 3 pixels from (`x0`, `y0`) with two dots for a
    /// core, exactly as near its centre: the left one 10 pixels, the right one 14,
    /// which starts a row higher and so comes first in raster order.
    fn paint_tie_ring(luma: &mut [u8], width: usize, x0: usize, y0: usize) {
        let height = luma.len() / width;
        for dy in 0..27 {
            for dx in 0..27 {
                let (cx, cy) = (dx / 3, dy / 3);
                let inside = (1..=7).contains(&cx) && (1..=7).contains(&cy);
                let ring = cx == 1 || cx == 7 || cy == 1 || cy == 7;
                let dot = ((11..=15).contains(&dy) && matches!(dx, 9 | 10))
                    || ((10..=16).contains(&dy) && matches!(dx, 16 | 17));
                let (x, y) = (x0 + dx, y0 + dy);
                if x < width && y < height {
                    luma[y * width + x] = if inside && (ring || dot) { 20 } else { 230 };
                }
            }
        }
    }

    /// A random dark-and-light picture: blocks of random size, fiducial rings and
    /// rings with two equally near cores (a tie the index must break as the scan did).
    fn random_scene(seed: u32, width: usize, height: usize) -> Vec<u8> {
        let mut random = crate::codec::Mulberry32::new(seed);
        let mut luma = alloc::vec![0u8; width * height];
        let block = 1 + (random.next_u32() % 6) as usize;
        let mut y = 0;
        while y < height {
            let mut x = 0;
            while x < width {
                let v = if random.next_u32() & 1 == 0 { 25 } else { 225 };
                for yy in y..(y + block).min(height) {
                    for xx in x..(x + block).min(width) {
                        luma[yy * width + xx] = v;
                    }
                }
                x += block;
            }
            y += block;
        }
        for _ in 0..(random.next_u32() % 12) {
            let cell = 2 + (random.next_u32() % 5) as usize;
            let x0 = (random.next_u32() as usize) % width;
            let y0 = (random.next_u32() as usize) % height;
            paint_fiducial(&mut luma, width, x0, y0, cell, random.next_u32() % 4);
        }
        for _ in 0..(random.next_u32() % 4) {
            let x0 = (random.next_u32() as usize) % width;
            let y0 = (random.next_u32() as usize) % height;
            paint_tie_ring(&mut luma, width, x0, y0);
        }
        luma
    }

    #[test]
    fn the_bucket_index_finds_the_rings_a_full_scan_finds() {
        let mut scratch = Scratch::default();
        let mut rings_seen = 0;
        for seed in 0..160u32 {
            let width = 64 + (seed as usize * 37) % 700;
            let height = 48 + (seed as usize * 53) % 500;
            scratch.luma = random_scene(seed + 1, width, height);
            label_dark(&mut scratch, width, height, 127);
            collect_rings(&mut scratch);
            let expected = collect_rings_full_scan(&scratch);
            assert_eq!(scratch.rings, expected, "seed {seed}");
            rings_seen += expected.len();
        }
        // The scenes must hold rings, or the comparison proves nothing.
        assert!(rings_seen > 200, "{rings_seen} rings");
    }

    #[test]
    fn a_tie_between_cores_in_two_squares_goes_to_the_lower_index() {
        // The ring's centre is at x = 32.5: the left dot is filed in the first square,
        // the right one (the lower index) in the second, which is visited after it.
        let (width, height) = (80, 48);
        let mut scratch = Scratch {
            luma: alloc::vec![230u8; width * height],
            ..Scratch::default()
        };
        paint_tie_ring(&mut scratch.luma, width, 19, 10);
        label_dark(&mut scratch, width, height, 127);
        collect_rings(&mut scratch);
        assert_eq!(scratch.rings.len(), 1);
        assert_eq!(scratch.rings[0].core_area, 14);
        assert_eq!(scratch.rings, collect_rings_full_scan(&scratch));
    }

    #[test]
    fn homography_maps_the_four_points() {
        let source = [(4.5, 4.5), (115.5, 4.5), (115.5, 62.5), (4.5, 62.5)];
        let target = [
            Point { x: 30.0, y: 20.0 },
            Point { x: 500.0, y: 35.0 },
            Point { x: 480.0, y: 300.0 },
            Point { x: 25.0, y: 280.0 },
        ];
        let h = solve_homography(&source, &target).unwrap();
        for ((u, v), p) in source.iter().zip(&target) {
            let w = h[6] * u + h[7] * v + 1.0;
            assert!(((h[0] * u + h[1] * v + h[2]) / w - p.x).abs() < 1e-9);
            assert!(((h[3] * u + h[4] * v + h[5]) / w - p.y).abs() < 1e-9);
        }
        let flat = [Point::default(); 4];
        assert!(solve_homography(&source, &flat).is_none());
    }

    #[test]
    fn sorts_like_v8() {
        let mut v = [3, 1, 2, 0];
        js_sort_small(&mut v, |a, b| a - b);
        assert_eq!(v, [0, 1, 2, 3]);
        let mut v = [4, 3, 2, 1, 5];
        js_sort_small(&mut v, |a, b| a - b);
        assert_eq!(v, [1, 2, 3, 4, 5]);
        // Stable for equal keys.
        let mut v = [(1, 'a'), (0, 'b'), (1, 'c'), (0, 'd')];
        js_sort_small(&mut v, |a, b| a.0 - b.0);
        assert_eq!(v, [(0, 'b'), (0, 'd'), (1, 'a'), (1, 'c')]);
    }

    #[test]
    fn tracking_refuses_a_blank_frame_and_bad_hints() {
        let data = alloc::vec![200u8; 64 * 48 * 4];
        let image = Image {
            data: &data,
            width: 64,
            height: 48,
        };
        let previous = Fiducials {
            points: [Point { x: 10.0, y: 10.0 }; 4],
            core_areas: [9, 7, 5, 3],
        };
        let mut scratch = Scratch::default();
        assert!(track_fiducials(&image, &mut scratch, &previous, 20.0).is_none());
        assert!(track_fiducials(&image, &mut scratch, &previous, f64::NAN).is_none());
        let off = Fiducials {
            points: [Point { x: -500.0, y: 10.0 }; 4],
            ..previous
        };
        assert!(track_fiducials(&image, &mut scratch, &off, 20.0).is_none());
    }

    #[test]
    fn the_strict_search_numbers_rings_of_very_different_sizes() {
        // The near (left) fiducials at 5 pixels a cell and the far ones at 3: their
        // areas differ by more than the whole-image search allows in one quad.
        let (width, height) = (400, 240);
        let mut luma = alloc::vec![230u8; width * height];
        paint_fiducial(&mut luma, width, 20, 20, 5, 0);
        paint_fiducial(&mut luma, width, 340, 40, 3, 1);
        paint_fiducial(&mut luma, width, 20, 170, 5, 2);
        paint_fiducial(&mut luma, width, 340, 160, 3, 3);
        let data: Vec<u8> = luma.iter().flat_map(|&v| [v, v, v, 255]).collect();
        let image = Image {
            data: &data,
            width,
            height,
        };
        let mut scratch = Scratch::default();
        assert!(locate_fiducials(&image, &mut scratch).is_none());
        let found = locate_fiducials_strict(&mut scratch, |_| true).expect("four fiducials");
        // Clockwise from the top-left: centres of the 9 x 9 blocks.
        let truth = [(42.5, 42.5), (353.5, 53.5), (353.5, 173.5), (42.5, 192.5)];
        for (p, (x, y)) in found.points.iter().zip(truth) {
            assert!(
                (p.x - x).abs() < 0.6 && (p.y - y).abs() < 0.6,
                "{p:?} for ({x}, {y})"
            );
        }
        // A search whose every quad the header check refuses gives none.
        let mut tried = 0;
        locate_fiducials(&image, &mut scratch);
        let none = locate_fiducials_strict(&mut scratch, |_| {
            tried += 1;
            false
        });
        assert!(none.is_none());
        assert!(tried > 0);
    }

    #[test]
    fn finds_nothing_in_a_blank_frame() {
        let data = alloc::vec![200u8; 64 * 48 * 4];
        let image = Image {
            data: &data,
            width: 64,
            height: 48,
        };
        assert!(locate_fiducials(&image, &mut Scratch::default()).is_none());
    }
}
