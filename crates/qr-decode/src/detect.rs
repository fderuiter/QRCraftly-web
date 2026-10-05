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

//! From finder candidates to sampled grids: choosing triples that form a
//! code, ordering them, estimating module size and dimension, finding the
//! alignment pattern and sampling every module through a perspective map.

use crate::finder::Finder;
use crate::image::{Binary, Luma};
use crate::math::{abs, distance, floor, round};
use crate::symbol::Grid;
use crate::transform::Projective;
use alloc::vec;
use alloc::vec::Vec;

/// Three finders as top-left, top-right and bottom-left.
#[derive(Clone, Copy, Debug)]
pub struct Triple {
    pub top_left: Finder,
    pub top_right: Finder,
    pub bottom_left: Finder,
    pub indexes: [usize; 3],
    score: f32,
}

/// Plausible finder triples, best first. A triple is plausible when its
/// module sizes agree, its two legs are of similar length and meet at
/// roughly a right angle.
pub fn triples(finders: &[Finder]) -> Vec<Triple> {
    let mut out = Vec::new();
    let n = finders.len();
    for i in 0..n {
        for j in i + 1..n {
            for k in j + 1..n {
                if let Some(t) = triple(finders, [i, j, k]) {
                    out.push(t);
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(core::cmp::Ordering::Equal)
    });
    out
}

fn triple(finders: &[Finder], idx: [usize; 3]) -> Option<Triple> {
    let p = [finders[idx[0]], finders[idx[1]], finders[idx[2]]];
    let sizes = [p[0].module, p[1].module, p[2].module];
    let (min, max) = (
        sizes.iter().cloned().fold(f32::MAX, f32::min),
        sizes.iter().cloned().fold(0.0, f32::max),
    );
    if max > 2.0 * min {
        return None;
    }
    // The corner opposite the longest side is the top-left.
    let d01 = p[0].distance(&p[1]);
    let d12 = p[1].distance(&p[2]);
    let d02 = p[0].distance(&p[2]);
    let (tl, a, b, hyp) = if d12 >= d01 && d12 >= d02 {
        (0, 1, 2, d12)
    } else if d02 >= d01 && d02 >= d12 {
        (1, 0, 2, d02)
    } else {
        (2, 0, 1, d01)
    };
    let (mut tr, mut bl) = (a, b);
    let leg_a = p[tl].distance(&p[tr]);
    let leg_b = p[tl].distance(&p[bl]);
    if leg_a < 1.0 || leg_b < 1.0 {
        return None;
    }
    let ratio = leg_a.max(leg_b) / leg_a.min(leg_b);
    if ratio > 2.0 {
        return None;
    }
    let cos = (leg_a * leg_a + leg_b * leg_b - hyp * hyp) / (2.0 * leg_a * leg_b);
    if abs(cos) > 0.45 {
        return None;
    }
    let module = (p[0].module + p[1].module + p[2].module) / 3.0;
    let modules_across = (leg_a + leg_b) / 2.0 / module + 7.0;
    if !(15.0..=200.0).contains(&modules_across) {
        return None;
    }
    // In image coordinates (y down) the top-right lies clockwise of the bottom-left.
    let cross =
        (p[tr].x - p[tl].x) * (p[bl].y - p[tl].y) - (p[tr].y - p[tl].y) * (p[bl].x - p[tl].x);
    if cross < 0.0 {
        core::mem::swap(&mut tr, &mut bl);
    }
    let confirmations = (p[0].count + p[1].count + p[2].count) as f32;
    let score = abs(cos) + (ratio - 1.0) + (max / min - 1.0) - 0.05 * confirmations.min(12.0);
    Some(Triple {
        top_left: p[tl],
        top_right: p[tr],
        bottom_left: p[bl],
        indexes: [idx[tl], idx[tr], idx[bl]],
        score,
    })
}

/// Length of the dark-light-dark run from (x0, y0) toward (x1, y1): from a
/// finder's centre to its outer edge. `None` when the line leaves the frame first.
fn run_toward(img: &Binary, x0: i32, y0: i32, x1: i32, y1: i32) -> Option<f32> {
    // Bresenham, stepping along the longer axis.
    let steep = (y1 - y0).abs() > (x1 - x0).abs();
    let (x0, y0, x1, y1) = if steep {
        (y0, x0, y1, x1)
    } else {
        (x0, y0, x1, y1)
    };
    let dx = (x1 - x0).abs();
    let dy = (y1 - y0).abs();
    let mut error = -dx / 2;
    let xstep = if x0 < x1 { 1 } else { -1 };
    let ystep = if y0 < y1 { 1 } else { -1 };
    let mut state = 0;
    let mut y = y0;
    let x_end = x1 + xstep;
    let mut x = x0;
    while x != x_end {
        let (rx, ry) = if steep { (y, x) } else { (x, y) };
        // State 0 looks for light, 1 for dark, 2 for light again.
        if (state == 1) == img.get_i(rx, ry) {
            if state == 2 {
                return Some(distance(x as f32, y as f32, x0 as f32, y0 as f32));
            }
            state += 1;
        }
        error += dy;
        if error > 0 {
            if y == y1 {
                break;
            }
            y += ystep;
            error -= dx;
        }
        x += xstep;
    }
    if state == 2 {
        return Some(distance(
            (x1 + xstep) as f32,
            y1 as f32,
            x0 as f32,
            y0 as f32,
        ));
    }
    None
}

/// A finder's full width (seven modules) measured toward another point and back.
fn finder_width(img: &Binary, from: &Finder, to_x: f32, to_y: f32) -> Option<f32> {
    let (fx, fy) = (from.x as i32, from.y as i32);
    let (tx, ty) = (to_x as i32, to_y as i32);
    let forward = run_toward(img, fx, fy, tx, ty)?;
    // Mirror the target through the centre, clipped to the frame.
    let (w, h) = (img.width as i32, img.height as i32);
    let mut ox = fx - (tx - fx);
    let mut oy = fy - (ty - fy);
    let mut scale = 1.0f32;
    if ox < 0 {
        scale = fx as f32 / (fx - ox) as f32;
        ox = 0;
    } else if ox >= w {
        scale = (w - 1 - fx) as f32 / (ox - fx) as f32;
        ox = w - 1;
    }
    oy = (fy as f32 - (fy - oy) as f32 * scale) as i32;
    scale = 1.0;
    if oy < 0 {
        scale = fy as f32 / (fy - oy) as f32;
        oy = 0;
    } else if oy >= h {
        scale = (h - 1 - fy) as f32 / (oy - fy) as f32;
        oy = h - 1;
    }
    ox = (fx as f32 + (ox - fx) as f32 * scale) as i32;
    let back = run_toward(img, fx, fy, ox, oy)?;
    Some(forward + back - 1.0)
}

/// Module size from the finders' widths measured toward each other.
fn module_size(img: &Binary, t: &Triple) -> f32 {
    let one_way = |a: &Finder, b: &Finder| -> Option<f32> {
        let ab = finder_width(img, a, b.x, b.y);
        let ba = finder_width(img, b, a.x, a.y);
        match (ab, ba) {
            (Some(x), Some(y)) => Some((x + y) / 14.0),
            (Some(x), None) | (None, Some(x)) => Some(x / 7.0),
            _ => None,
        }
    };
    let estimates = [
        one_way(&t.top_left, &t.top_right),
        one_way(&t.top_left, &t.bottom_left),
    ];
    match estimates {
        [Some(a), Some(b)] => (a + b) / 2.0,
        [Some(a), None] | [None, Some(a)] => a,
        _ => (t.top_left.module + t.top_right.module + t.bottom_left.module) / 3.0,
    }
}

/// Candidate symbol sizes for a triple, the likeliest first.
pub fn dimensions(img: &Binary, t: &Triple) -> (f32, Vec<usize>) {
    let module = module_size(img, t);
    let across = (t.top_left.distance(&t.top_right) + t.top_left.distance(&t.bottom_left)) / 2.0;
    let d = round(across / module) as i32 + 7;
    let candidates: &[i32] = match d.rem_euclid(4) {
        1 => &[0, 4, -4],
        0 => &[1, -3, 5],
        2 => &[-1, 3, -5],
        _ => &[-2, 2],
    };
    let sizes = candidates
        .iter()
        .map(|o| d + o)
        .filter(|s| (21..=177).contains(s))
        .map(|s| s as usize)
        .collect();
    (module, sizes)
}

/// Whether three runs read light-dark-light... as 1:1:1 at `module` pixels each.
fn alignment_ratio(c: &[u32; 3], module: f32) -> bool {
    let max = module / 2.0;
    c.iter().all(|&n| abs(module - n as f32) < max)
}

/// The centre of the bottom-right alignment pattern near (ex, ey), searching
/// `allowance` modules around it.
fn find_alignment(
    img: &Binary,
    module: f32,
    ex: f32,
    ey: f32,
    allowance: f32,
) -> Option<(f32, f32)> {
    let reach = allowance * module;
    let (w, h) = (img.width as f32, img.height as f32);
    let left = (ex - reach).max(0.0) as usize;
    let right = (ex + reach).min(w - 1.0) as usize;
    let top = (ey - reach).max(0.0) as usize;
    let bottom = (ey + reach).min(h - 1.0) as usize;
    if right <= left
        || bottom <= top
        || (right - left) as f32 <= module * 3.0
        || (bottom - top) as f32 <= module * 3.0
    {
        return None;
    }
    let mut best: Option<(f32, f32, f32)> = None;
    let middle = (top + bottom) / 2;
    let rows = bottom - top;
    for i in 0..rows {
        // Rows nearest the estimate first.
        let offset = i.div_ceil(2);
        let y = if i % 2 == 0 {
            middle + offset
        } else {
            middle.wrapping_sub(offset)
        };
        if y < top || y > bottom {
            continue;
        }
        // Runs of one colour along the row, as (start, length, dark).
        let mut runs: [(usize, u32, bool); 3] = [(0, 0, false); 3];
        let mut x = left;
        while x <= right {
            let dark = img.get(x, y);
            let start = x;
            while x <= right && img.get(x, y) == dark {
                x += 1;
            }
            runs = [runs[1], runs[2], (start, (x - start) as u32, dark)];
            // Light, dark, light, each about one module: the pattern's centre row.
            if !runs[0].2 && runs[1].2 && !runs[2].2 && runs[0].1 > 0 {
                let c = [runs[0].1, runs[1].1, runs[2].1];
                if alignment_ratio(&c, module) {
                    if let Some(p) = check_alignment(img, module, &c, x, y) {
                        let d = distance(p.0, p.1, ex, ey);
                        if best.is_none_or(|b| d < b.2) {
                            best = Some((p.0, p.1, d));
                        }
                    }
                }
            }
        }
        if let Some(b) = best {
            if b.2 < module {
                break;
            }
        }
    }
    best.map(|b| (b.0, b.1))
}

/// Confirms an alignment hit down its column; returns the centre.
fn check_alignment(
    img: &Binary,
    module: f32,
    c: &[u32; 3],
    end: usize,
    y: usize,
) -> Option<(f32, f32)> {
    let total = c[0] + c[1] + c[2];
    let cx = end as f32 - c[2] as f32 - c[1] as f32 / 2.0;
    let x = cx as usize;
    let max = 2 * c[1];
    let mut v = [0u32; 3];
    let mut i = y as isize;
    while i >= 0 && img.get(x, i as usize) && v[1] <= max {
        v[1] += 1;
        i -= 1;
    }
    if i < 0 || v[1] > max {
        return None;
    }
    while i >= 0 && !img.get(x, i as usize) && v[0] <= max {
        v[0] += 1;
        i -= 1;
    }
    if v[0] > max {
        return None;
    }
    let mut j = y + 1;
    while j < img.height && img.get(x, j) && v[1] <= max {
        v[1] += 1;
        j += 1;
    }
    if j == img.height || v[1] > max {
        return None;
    }
    while j < img.height && !img.get(x, j) && v[2] <= max {
        v[2] += 1;
        j += 1;
    }
    if v[2] > max {
        return None;
    }
    let vt = v[0] + v[1] + v[2];
    if 5 * vt.abs_diff(total) >= 2 * total || !alignment_ratio(&v, module) {
        return None;
    }
    Some((cx, j as f32 - v[2] as f32 - v[1] as f32 / 2.0))
}

/// Where a grid was sampled: its module-to-frame map and the points that fixed it.
pub struct Placement {
    pub size: usize,
    pub transform: Projective,
    pub alignment: Option<(f32, f32)>,
}

/// Fixes the module-to-frame map for a triple at `size` modules a side. With
/// `use_alignment`, the bottom-right alignment pattern anchors the fourth
/// corner when one is found; otherwise the map is the parallelogram the three
/// finders span.
pub fn place(img: &Binary, t: &Triple, module: f32, size: usize, use_alignment: bool) -> Placement {
    let d = size as f32;
    let (tl, tr, bl) = (&t.top_left, &t.top_right, &t.bottom_left);
    let mut alignment = None;
    if size > 21 && use_alignment {
        let bx = tr.x - tl.x + bl.x;
        let by = tr.y - tl.y + bl.y;
        let correction = 1.0 - 3.0 / (d - 7.0);
        let ex = tl.x + correction * (bx - tl.x);
        let ey = tl.y + correction * (by - tl.y);
        for allowance in [4.0, 8.0, 16.0] {
            if let Some(p) = find_alignment(img, module, ex, ey, allowance) {
                alignment = Some(p);
                break;
            }
        }
    }
    let (corner, image_corner) = match alignment {
        Some(p) => ((d - 6.5, d - 6.5), p),
        None => ((d - 3.5, d - 3.5), (tr.x - tl.x + bl.x, tr.y - tl.y + bl.y)),
    };
    let transform = Projective::quad_to_quad(
        [(3.5, 3.5), (d - 3.5, 3.5), corner, (3.5, d - 3.5)],
        [(tl.x, tl.y), (tr.x, tr.y), image_corner, (bl.x, bl.y)],
    );
    Placement {
        size,
        transform,
        alignment,
    }
}

/// How many timing-pattern modules (row and column 6 between the finders)
/// read as they should, out of how many: a cheap test before sampling the
/// whole grid. Noise matches about half; a real code nearly all. The pattern
/// is symmetric, so a mirrored code scores the same.
pub fn timing_score(img: &Binary, p: &Placement) -> (usize, usize) {
    let n = p.size;
    let (mut matches, mut total) = (0, 0);
    for i in 8..n.saturating_sub(8) {
        for (r, c) in [(6, i), (i, 6)] {
            let (x, y) = p.transform.apply(c as f32 + 0.5, r as f32 + 0.5);
            let dark = img.get_i(floor(x) as i32, floor(y) as i32);
            total += 1;
            matches += usize::from(dark == i.is_multiple_of(2));
        }
    }
    (matches, total)
}

/// How close to its threshold a module's brightness may be before it counts as weak.
const WEAK_MARGIN: i32 = 12;

/// Samples every module centre. `None` when the grid runs off the frame.
pub fn sample(img: &Binary, luma: &Luma, p: &Placement) -> Option<Grid> {
    let n = p.size;
    let (w, h) = (img.width as f32, img.height as f32);
    let mut bits = vec![0u8; n * n];
    let mut weak = vec![0u8; n * n];
    for r in 0..n {
        for c in 0..n {
            let (x, y) = p.transform.apply(c as f32 + 0.5, r as f32 + 0.5);
            // Allow a pixel of slack at the edges, as rounding can put a border module just outside.
            if !(x >= -1.0 && y >= -1.0 && x <= w && y <= h) {
                return None;
            }
            let xi = (floor(x).max(0.0) as usize).min(img.width - 1);
            let yi = (floor(y).max(0.0) as usize).min(img.height - 1);
            let i = r * n + c;
            bits[i] = u8::from(img.get(xi, yi));
            if luma.width == img.width {
                let margin = luma.get(xi, yi) as i32 - img.threshold(xi, yi) as i32;
                weak[i] = u8::from(margin.abs() < WEAK_MARGIN);
            }
        }
    }
    Some(Grid {
        size: n,
        bits,
        weak,
    })
}
