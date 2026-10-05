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
use crate::math::{abs, distance, floor, round, sqrt};
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

/// The `limit` best plausible finder triples, best first. A triple is
/// plausible when its module sizes agree, its two legs are of similar length
/// and meet at roughly a right angle.
pub fn triples(finders: &[Finder], limit: usize) -> Vec<Triple> {
    let mut out = Vec::new();
    let n = finders.len();
    // Every pair's distance once: there are far more triples than pairs.
    let mut distances = vec![0.0f32; n * n];
    for i in 0..n {
        for j in i + 1..n {
            let d = finders[i].distance(&finders[j]);
            distances[i * n + j] = d;
            distances[j * n + i] = d;
        }
    }
    let distance = |a: usize, b: usize| distances[a * n + b];
    // Kept sorted and cut to `limit` as it fills: a noisy frame can make
    // thousands, and only the best are ever tried. Ties keep scan order.
    for i in 0..n {
        for j in i + 1..n {
            for k in j + 1..n {
                let Some(t) = triple(finders, [i, j, k], &distance) else {
                    continue;
                };
                let at = out.partition_point(|o: &Triple| o.score <= t.score);
                if at < limit {
                    out.insert(at, t);
                    out.truncate(limit);
                }
            }
        }
    }
    out
}

fn triple(
    finders: &[Finder],
    idx: [usize; 3],
    distance: &impl Fn(usize, usize) -> f32,
) -> Option<Triple> {
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
    let d = |a: usize, b: usize| distance(idx[a], idx[b]);
    let (d01, d12, d02) = (d(0, 1), d(1, 2), d(0, 2));
    let (tl, a, b, hyp) = if d12 >= d01 && d12 >= d02 {
        (0, 1, 2, d12)
    } else if d02 >= d01 && d02 >= d12 {
        (1, 0, 2, d02)
    } else {
        (2, 0, 1, d01)
    };
    let (mut tr, mut bl) = (a, b);
    let (leg_a, leg_b) = (d(tl, tr), d(tl, bl));
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

/// Each finder's full width measured along the triple's two legs: the
/// top-left and top-right toward each other, the top-left and bottom-left
/// toward each other.
#[derive(Clone, Copy, Debug)]
pub struct Widths {
    tl_tr: Option<f32>,
    tr_tl: Option<f32>,
    tl_bl: Option<f32>,
    bl_tl: Option<f32>,
}

impl Widths {
    fn measure(img: &Binary, t: &Triple) -> Widths {
        let (tl, tr, bl) = (&t.top_left, &t.top_right, &t.bottom_left);
        Widths {
            tl_tr: finder_width(img, tl, tr.x, tr.y),
            tr_tl: finder_width(img, tr, tl.x, tl.y),
            tl_bl: finder_width(img, tl, bl.x, bl.y),
            bl_tl: finder_width(img, bl, tl.x, tl.y),
        }
    }
}

/// Module size from the finders' widths measured toward each other.
fn module_size(t: &Triple, widths: &Widths) -> f32 {
    let one_way = |ab: Option<f32>, ba: Option<f32>| -> Option<f32> {
        match (ab, ba) {
            (Some(x), Some(y)) => Some((x + y) / 14.0),
            (Some(x), None) | (None, Some(x)) => Some(x / 7.0),
            _ => None,
        }
    };
    let estimates = [
        one_way(widths.tl_tr, widths.tr_tl),
        one_way(widths.tl_bl, widths.bl_tl),
    ];
    match estimates {
        [Some(a), Some(b)] => (a + b) / 2.0,
        [Some(a), None] | [None, Some(a)] => a,
        _ => (t.top_left.module + t.top_right.module + t.bottom_left.module) / 3.0,
    }
}

/// The module size, candidate symbol sizes (the likeliest first) and the
/// finder widths they came from.
pub fn dimensions(img: &Binary, t: &Triple) -> (f32, Vec<usize>, Widths) {
    let widths = Widths::measure(img, t);
    let module = module_size(t, &widths);
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
    (module, sizes, widths)
}

/// Whether three runs read light-dark-light... as 1:1:1 at about `module` pixels each.
/// Perspective can make the pattern's own modules differ from the finders'
/// estimate, so the runs are measured against their own mean, which must be
/// near `module`, with half a pixel of slack for whole-pixel runs.
fn alignment_ratio(c: &[u32; 3], module: f32) -> bool {
    let local = (c[0] + c[1] + c[2]) as f32 / 3.0;
    if local < 0.6 * module || local > 1.6 * module {
        return false;
    }
    let max = local / 2.0 + 0.5;
    c.iter().all(|&n| abs(local - n as f32) < max)
}

/// Alignment pattern centres within `allowance` modules of (ex, ey), nearest
/// first, with hits from neighbouring rows of one pattern merged.
fn find_alignments(img: &Binary, module: f32, ex: f32, ey: f32, allowance: f32) -> Vec<(f32, f32)> {
    let mut found: Vec<(f32, f32)> = Vec::new();
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
        return found;
    }
    for y in top..=bottom {
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
                        if !found.iter().any(|f| distance(f.0, f.1, p.0, p.1) < module) {
                            let d = distance(p.0, p.1, ex, ey);
                            let at = found.partition_point(|f| distance(f.0, f.1, ex, ey) <= d);
                            found.insert(at, p);
                        }
                    }
                }
            }
        }
    }
    found
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

type Homogeneous = (f32, f32, f32);

fn cross(a: Homogeneous, b: Homogeneous) -> Homogeneous {
    (
        a.1 * b.2 - a.2 * b.1,
        a.2 * b.0 - a.0 * b.2,
        a.0 * b.1 - a.1 * b.0,
    )
}

/// The vanishing point of the line from finder `a` to finder `b`, `span`
/// modules apart, in homogeneous coordinates (at infinity when the code is
/// seen square on). Along one line a projective map is fixed by the two
/// centres and how wide each finder reads: the farther finder reads narrower.
fn vanishing(
    a: &Finder,
    b: &Finder,
    near: Option<f32>,
    far: Option<f32>,
    span: f32,
) -> Option<Homogeneous> {
    let (near, far) = (near?, far?);
    let length = a.distance(b);
    if length < 1.0 {
        return None;
    }
    // With t(m) = k m / (r m + 1) from a (m = 0) to b (m = span), the slopes
    // at the ends are k and k / (r span + 1)^2.
    let g = sqrt(near / far).clamp(0.5, 2.0);
    let r = (g - 1.0) / span;
    let k = length * g / span;
    let (ux, uy) = ((b.x - a.x) / length, (b.y - a.y) / length);
    Some((a.x * r + ux * k, a.y * r + uy * k, r))
}

/// The map from module to frame coordinates that the three finders alone
/// imply, perspective included: the fourth centre is where the line from
/// the top-right toward the columns' vanishing point meets the line from the
/// bottom-left toward the rows'. `None` when a finder cannot be measured.
pub fn perspective(t: &Triple, widths: &Widths, size: usize) -> Option<Projective> {
    let d = size as f32;
    let span = d - 7.0;
    let (tl, tr, bl) = (&t.top_left, &t.top_right, &t.bottom_left);
    let rows = vanishing(tl, tr, widths.tl_tr, widths.tr_tl, span)?;
    let columns = vanishing(tl, bl, widths.tl_bl, widths.bl_tl, span)?;
    let corner = cross(
        cross((tr.x, tr.y, 1.0), columns),
        cross((bl.x, bl.y, 1.0), rows),
    );
    if abs(corner.2) < 1e-6 {
        return None;
    }
    let br = (corner.0 / corner.2, corner.1 / corner.2);
    // A corner past twice the finders' span is a bad measurement, not perspective.
    let (px, py) = (tr.x - tl.x + bl.x, tr.y - tl.y + bl.y);
    if distance(br.0, br.1, px, py) > tl.distance(tr).max(tl.distance(bl)) {
        return None;
    }
    Some(Projective::quad_to_quad(
        [
            (3.5, 3.5),
            (d - 3.5, 3.5),
            (d - 3.5, d - 3.5),
            (3.5, d - 3.5),
        ],
        [(tl.x, tl.y), (tr.x, tr.y), br, (bl.x, bl.y)],
    ))
}

/// The most alignment pattern candidates tried for one placement.
pub const MAX_ALIGNMENTS: usize = 3;

/// Where the bottom-right alignment pattern of a triple at `size` modules a
/// side may be, likeliest first. A data pattern can sit nearer the estimate
/// than the real one, so several are kept.
pub fn alignments(
    img: &Binary,
    t: &Triple,
    module: f32,
    size: usize,
    map: Option<&Projective>,
) -> Vec<(f32, f32)> {
    if size <= 21 {
        return Vec::new();
    }
    let d = size as f32;
    let (ex, ey) = match map {
        Some(map) => map.apply(d - 6.5, d - 6.5),
        None => {
            let (tl, tr, bl) = (&t.top_left, &t.top_right, &t.bottom_left);
            let bx = tr.x - tl.x + bl.x;
            let by = tr.y - tl.y + bl.y;
            let correction = 1.0 - 3.0 / (d - 7.0);
            (
                tl.x + correction * (bx - tl.x),
                tl.y + correction * (by - tl.y),
            )
        }
    };
    for allowance in [4.0, 8.0, 16.0] {
        let mut found = find_alignments(img, module, ex, ey, allowance);
        if !found.is_empty() {
            found.truncate(MAX_ALIGNMENTS);
            return found;
        }
    }
    Vec::new()
}

/// Fixes the module-to-frame map for a triple at `size` modules a side. An
/// alignment pattern anchors the fourth corner when given; otherwise the map
/// is the parallelogram the three finders span.
pub fn place(
    t: &Triple,
    size: usize,
    alignment: Option<(f32, f32)>,
    map: Option<&Projective>,
) -> Placement {
    let d = size as f32;
    let (tl, tr, bl) = (&t.top_left, &t.top_right, &t.bottom_left);
    if let (None, Some(map)) = (alignment, map) {
        return Placement {
            size,
            transform: *map,
            alignment,
        };
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

/// Whether at least `percent` of the timing-pattern modules (row and column
/// 6 between the finders) read as they should: a cheap test before sampling
/// the whole grid. Noise matches about half; a real code nearly all. The
/// pattern is symmetric, so a mirrored code scores the same. Stops as soon as
/// the misses settle it.
pub fn timing_passes(img: &Binary, p: &Placement, percent: usize) -> bool {
    let n = p.size;
    let total = 2 * n.saturating_sub(16);
    // Fewer than `percent` match exactly when more than this many miss.
    let allowed = total - (total * percent).div_ceil(100);
    let mut misses = 0;
    for i in 8..n.saturating_sub(8) {
        for (r, c) in [(6, i), (i, 6)] {
            let (x, y) = p.transform.apply(c as f32 + 0.5, r as f32 + 0.5);
            let dark = img.get_i(floor(x) as i32, floor(y) as i32);
            if dark != i.is_multiple_of(2) {
                misses += 1;
                if misses > allowed {
                    return false;
                }
            }
        }
    }
    true
}

/// How close to its threshold a module's brightness may be before it counts as weak.
pub(crate) const WEAK_MARGIN: i32 = 12;

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
