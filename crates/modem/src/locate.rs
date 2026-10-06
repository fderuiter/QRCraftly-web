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
use crate::fmath::{abs, sqrt};
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

#[derive(Clone, Copy, Debug, Default)]
pub struct Ring {
    centre: Point,
    area: u32,
    core_area: u32,
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
}

fn otsu_threshold(luma: &[u8]) -> u32 {
    let mut hist = [0u32; 256];
    for &v in luma {
        hist[v as usize] += 1;
    }
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
    label_dark(scratch, width, height, threshold);
    let Scratch {
        blobs,
        rings,
        centres,
        ..
    } = scratch;
    rings.clear();
    // Each blob's centre, computed once with the same division the search uses.
    centres.clear();
    centres.extend(blobs.iter().map(|b| {
        let area = b.area as f64;
        (b.sum_x / area, b.sum_y / area)
    }));
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
        // A ring is 24 cells and spans 7 to 10 cells whichever way it is turned.
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
        // A square distance this far above the reach's square has a root at or above the
        // reach whatever the rounding, so the root need not be taken.
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
        if !core_found {
            continue;
        }
        rings.push(Ring {
            centre: Point { x: cx, y: cy },
            area: blob.area,
            core_area,
        });
    }
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
