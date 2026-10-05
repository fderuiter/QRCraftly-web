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

//! Finder patterns: the three nested squares in a code's corners.
//!
//! Along any line through its centre a finder reads dark, light, dark, light,
//! dark in the ratio 1:1:3:1:1. Rows are scanned for that ratio; each hit is
//! checked again down the column, across the row and along the diagonal
//! through its centre, and nearby hits are merged into one candidate.

use crate::image::Binary;
use crate::math::{abs as fabs, distance};
use alloc::vec::Vec;

/// A finder pattern centre, its estimated module size in pixels, how many
/// scan lines confirmed it and how many of those fit the ratio without the
/// half pixel of slack.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Finder {
    pub x: f32,
    pub y: f32,
    pub module: f32,
    pub count: u32,
    pub tight: u32,
}

impl Finder {
    pub fn distance(&self, other: &Finder) -> f32 {
        distance(self.x, self.y, other.x, other.y)
    }

    fn near(&self, module: f32, x: f32, y: f32) -> bool {
        if fabs(y - self.y) <= module && fabs(x - self.x) <= module {
            let diff = fabs(module - self.module);
            return diff <= 1.0 || diff <= self.module;
        }
        false
    }

    fn merge(&self, x: f32, y: f32, module: f32, tight: bool) -> Finder {
        let n = self.count as f32;
        let total = n + 1.0;
        Finder {
            x: (n * self.x + x) / total,
            y: (n * self.y + y) / total,
            module: (n * self.module + module) / total,
            count: self.count + 1,
            tight: self.tight + u32::from(tight),
        }
    }
}

/// The most candidates kept, so a noisy frame cannot make detection quadratic in its noise.
pub const MAX_CANDIDATES: usize = 48;

/// Whether five run lengths are close enough to 1:1:3:1:1. Each run may be
/// off by `slack_quarters` quarters of a module, plus half a pixel when
/// `half_pixel`: runs are whole pixels while module edges are not, which
/// matters for small modules. Integer arithmetic throughout, as this runs at
/// every run boundary.
fn is_finder_ratio(counts: &[u32; 5], slack_quarters: u32, half_pixel: bool) -> bool {
    if counts.contains(&0) {
        return false;
    }
    let total: u32 = counts.iter().sum();
    if total < 7 {
        return false;
    }
    // |module - run| < module * slack + 0.5, with module = total / 7, times 28.
    let off = |run: u32, modules: u32| (modules * total).abs_diff(7 * run) * 4;
    let pixel = if half_pixel { 14 } else { 0 };
    let allowed = |modules: u32| modules * slack_quarters * total + pixel;
    off(counts[0], 1) < allowed(1)
        && off(counts[1], 1) < allowed(1)
        && off(counts[2], 3) < allowed(3)
        && off(counts[3], 1) < allowed(1)
        && off(counts[4], 1) < allowed(1)
}

fn centre_from_end(counts: &[u32; 5], end: usize) -> f32 {
    end as f32 - counts[4] as f32 - counts[3] as f32 - counts[2] as f32 / 2.0
}

struct Scanner<'a> {
    image: &'a Binary,
    found: Vec<Finder>,
}

impl Scanner<'_> {
    /// Re-measures the pattern down column `x` from row `y`; returns the
    /// centre row and whether it fits without the half pixel.
    fn check_vertical(&self, x: usize, y: usize, max: u32, original: u32) -> Option<(f32, bool)> {
        let img = self.image;
        let h = img.height;
        let mut c = [0u32; 5];
        let mut i = y as isize;
        while i >= 0 && img.get(x, i as usize) {
            c[2] += 1;
            i -= 1;
        }
        if i < 0 {
            return None;
        }
        while i >= 0 && !img.get(x, i as usize) && c[1] <= max {
            c[1] += 1;
            i -= 1;
        }
        if i < 0 || c[1] > max {
            return None;
        }
        while i >= 0 && img.get(x, i as usize) && c[0] <= max {
            c[0] += 1;
            i -= 1;
        }
        if c[0] > max {
            return None;
        }
        let mut j = y + 1;
        while j < h && img.get(x, j) {
            c[2] += 1;
            j += 1;
        }
        if j == h {
            return None;
        }
        while j < h && !img.get(x, j) && c[3] < max {
            c[3] += 1;
            j += 1;
        }
        if j == h || c[3] >= max {
            return None;
        }
        while j < h && img.get(x, j) && c[4] < max {
            c[4] += 1;
            j += 1;
        }
        if c[4] >= max {
            return None;
        }
        let total: u32 = c.iter().sum();
        // A tilted code stretches one axis; allow the column to differ from the row by 60%.
        if 5 * total.abs_diff(original) >= 3 * original || !is_finder_ratio(&c, 2, true) {
            return None;
        }
        Some((centre_from_end(&c, j), is_finder_ratio(&c, 2, false)))
    }

    /// Re-measures along row `y` from column `x`; returns the centre column,
    /// the run total and whether it fits without the half pixel.
    fn check_horizontal(
        &self,
        x: usize,
        y: usize,
        max: u32,
        original: u32,
    ) -> Option<(f32, u32, bool)> {
        let img = self.image;
        let w = img.width;
        let mut c = [0u32; 5];
        let mut i = x as isize;
        while i >= 0 && img.get(i as usize, y) {
            c[2] += 1;
            i -= 1;
        }
        if i < 0 {
            return None;
        }
        while i >= 0 && !img.get(i as usize, y) && c[1] <= max {
            c[1] += 1;
            i -= 1;
        }
        if i < 0 || c[1] > max {
            return None;
        }
        while i >= 0 && img.get(i as usize, y) && c[0] <= max {
            c[0] += 1;
            i -= 1;
        }
        if c[0] > max {
            return None;
        }
        let mut j = x + 1;
        while j < w && img.get(j, y) {
            c[2] += 1;
            j += 1;
        }
        if j == w {
            return None;
        }
        while j < w && !img.get(j, y) && c[3] < max {
            c[3] += 1;
            j += 1;
        }
        if j == w || c[3] >= max {
            return None;
        }
        while j < w && img.get(j, y) && c[4] < max {
            c[4] += 1;
            j += 1;
        }
        if c[4] >= max {
            return None;
        }
        let total: u32 = c.iter().sum();
        if 5 * total.abs_diff(original) >= original || !is_finder_ratio(&c, 2, true) {
            return None;
        }
        Some((centre_from_end(&c, j), total, is_finder_ratio(&c, 2, false)))
    }

    /// The same ratio along the down-right diagonal through the centre:
    /// `None` when it fails, else whether it fits without the half pixel.
    fn check_diagonal(&self, x: usize, y: usize) -> Option<bool> {
        let img = self.image;
        let (x, y) = (x as i32, y as i32);
        let mut c = [0u32; 5];
        let mut i = 0;
        while img.get_i(x - i, y - i) {
            c[2] += 1;
            i += 1;
            if x < i || y < i {
                return None;
            }
        }
        while x >= i && y >= i && !img.get_i(x - i, y - i) {
            c[1] += 1;
            i += 1;
        }
        if x < i || y < i {
            return None;
        }
        while x >= i && y >= i && img.get_i(x - i, y - i) {
            c[0] += 1;
            i += 1;
        }
        let (w, h) = (img.width as i32, img.height as i32);
        let mut i = 1;
        while x + i < w && y + i < h && img.get_i(x + i, y + i) {
            c[2] += 1;
            i += 1;
        }
        while x + i < w && y + i < h && !img.get_i(x + i, y + i) {
            c[3] += 1;
            i += 1;
        }
        while x + i < w && y + i < h && img.get_i(x + i, y + i) {
            c[4] += 1;
            i += 1;
        }
        is_finder_ratio(&c, 3, true).then(|| is_finder_ratio(&c, 3, false))
    }

    /// Confirms a row hit and records it; true when it was a finder.
    fn handle(&mut self, counts: &[u32; 5], row: usize, end: usize) -> bool {
        let total: u32 = counts.iter().sum();
        let mut cx = centre_from_end(counts, end);
        let Some((cy, tight_v)) = self.check_vertical(cx as usize, row, counts[2], total) else {
            return false;
        };
        let Some((x, horizontal, tight_h)) =
            self.check_horizontal(cx as usize, cy as usize, counts[2], total)
        else {
            return false;
        };
        cx = x;
        let Some(tight_d) = self.check_diagonal(cx as usize, cy as usize) else {
            return false;
        };
        let tight = is_finder_ratio(counts, 2, false) && tight_v && tight_h && tight_d;
        let module = horizontal as f32 / 7.0;
        if let Some(existing) = self.found.iter_mut().find(|f| f.near(module, cx, cy)) {
            *existing = existing.merge(cx, cy, module, tight);
        } else if self.found.len() < 4 * MAX_CANDIDATES {
            self.found.push(Finder {
                x: cx,
                y: cy,
                module,
                count: 1,
                tight: u32::from(tight),
            });
        }
        true
    }
}

/// Every finder pattern candidate in the frame, most confirmed first.
/// `dense` scans every other row instead of skipping by the expected module size.
pub fn find(image: &Binary, dense: bool) -> Vec<Finder> {
    let (w, h) = (image.width, image.height);
    let mut scanner = Scanner {
        image,
        found: Vec::new(),
    };
    // A version 20 code filling the frame still has finders 3 rows tall at this step.
    let step = if dense { 2 } else { (3 * h / (4 * 97)).max(3) };
    let mut y = step - 1;
    while y < h {
        let mut c = [0u32; 5];
        let mut state = 0usize;
        for x in 0..w {
            if image.get(x, y) {
                if state & 1 == 1 {
                    state += 1;
                }
                c[state] += 1;
            } else if state & 1 == 0 {
                if state == 4 {
                    if is_finder_ratio(&c, 2, true) && scanner.handle(&c, y, x) {
                        c = [0; 5];
                        state = 0;
                        continue;
                    }
                    c = [c[2], c[3], c[4], 1, 0];
                    state = 3;
                } else {
                    state += 1;
                    c[state] += 1;
                }
            } else {
                c[state] += 1;
            }
        }
        if state == 4 && is_finder_ratio(&c, 2, true) {
            scanner.handle(&c, y, w);
        }
        y += step;
    }
    let mut found = scanner.found;
    found.retain(|f| f.count > 1 || f.module >= 1.5);
    // Most confirmed first, then the closest fits; ties keep scan order.
    found.sort_by_key(|f| core::cmp::Reverse((f.count, f.tight)));
    found.truncate(MAX_CANDIDATES);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::Luma;
    use alloc::vec;

    /// Draws a 7-module finder with its top-left corner at (x, y).
    fn draw_finder(px: &mut [u8], width: usize, x: usize, y: usize, module: usize) {
        for r in 0..7 * module {
            for c in 0..7 * module {
                let (mr, mc) = (r / module, c / module);
                let dark = mr == 0
                    || mr == 6
                    || mc == 0
                    || mc == 6
                    || (2..=4).contains(&mr) && (2..=4).contains(&mc);
                if dark {
                    px[(y + r) * width + x + c] = 0;
                }
            }
        }
    }

    #[test]
    fn finds_three_finders() {
        let (w, h) = (200, 200);
        let mut px = vec![255u8; w * h];
        for (x, y) in [(20, 20), (150, 20), (20, 150)] {
            draw_finder(&mut px, w, x, y, 4);
        }
        let image = Binary::hybrid(&Luma {
            width: w,
            height: h,
            data: px,
        });
        let found = find(&image, false);
        assert_eq!(found.len(), 3, "{found:?}");
        for (x, y) in [(34.0, 34.0), (164.0, 34.0), (34.0, 164.0)] {
            let f = found
                .iter()
                .find(|f| fabs(f.x - x) < 1.5 && fabs(f.y - y) < 1.5)
                .unwrap_or_else(|| panic!("no finder near {x},{y}: {found:?}"));
            assert!(fabs(f.module - 4.0) < 0.6, "{f:?}");
        }
    }

    #[test]
    fn ignores_a_blank_frame_and_stripes() {
        let (w, h) = (120, 120);
        let blank = Binary::hybrid(&Luma {
            width: w,
            height: h,
            data: vec![200; w * h],
        });
        assert!(find(&blank, true).is_empty());
        let stripes = Binary::hybrid(&Luma {
            width: w,
            height: h,
            data: (0..w * h)
                .map(|i| if (i % w / 3) % 2 == 0 { 0 } else { 255 })
                .collect(),
        });
        assert!(find(&stripes, true).is_empty());
    }
}
