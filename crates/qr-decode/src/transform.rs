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

//! Projective transforms between a code's module grid and the frame.
//!
//! A camera sees the flat square of a code as an arbitrary quadrilateral. Four
//! point pairs fix the transform: the unit square is mapped to each
//! quadrilateral (Heckbert's closed form), and one of the two maps is inverted
//! through its adjugate.

/// A 3 x 3 projective map acting on row vectors `[x, y, 1]`.
#[derive(Clone, Copy, Debug)]
pub struct Projective {
    a11: f32,
    a12: f32,
    a13: f32,
    a21: f32,
    a22: f32,
    a23: f32,
    a31: f32,
    a32: f32,
    a33: f32,
}

impl Projective {
    /// Maps the unit square's corners (0,0), (1,0), (1,1), (0,1) to the four points given.
    pub fn square_to_quad(q: [(f32, f32); 4]) -> Projective {
        let [(x0, y0), (x1, y1), (x2, y2), (x3, y3)] = q;
        let dx3 = x0 - x1 + x2 - x3;
        let dy3 = y0 - y1 + y2 - y3;
        if dx3 == 0.0 && dy3 == 0.0 {
            return Projective {
                a11: x1 - x0,
                a21: x2 - x1,
                a31: x0,
                a12: y1 - y0,
                a22: y2 - y1,
                a32: y0,
                a13: 0.0,
                a23: 0.0,
                a33: 1.0,
            };
        }
        let (dx1, dx2, dy1, dy2) = (x1 - x2, x3 - x2, y1 - y2, y3 - y2);
        let denominator = dx1 * dy2 - dx2 * dy1;
        let a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
        let a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
        Projective {
            a11: x1 - x0 + a13 * x1,
            a21: x3 - x0 + a23 * x3,
            a31: x0,
            a12: y1 - y0 + a13 * y1,
            a22: y3 - y0 + a23 * y3,
            a32: y0,
            a13,
            a23,
            a33: 1.0,
        }
    }

    /// The inverse map up to scale, which is all a projective map needs.
    pub fn adjugate(&self) -> Projective {
        Projective {
            a11: self.a22 * self.a33 - self.a23 * self.a32,
            a21: self.a23 * self.a31 - self.a21 * self.a33,
            a31: self.a21 * self.a32 - self.a22 * self.a31,
            a12: self.a13 * self.a32 - self.a12 * self.a33,
            a22: self.a11 * self.a33 - self.a13 * self.a31,
            a32: self.a12 * self.a31 - self.a11 * self.a32,
            a13: self.a12 * self.a23 - self.a13 * self.a22,
            a23: self.a13 * self.a21 - self.a11 * self.a23,
            a33: self.a11 * self.a22 - self.a12 * self.a21,
        }
    }

    /// First `self`, then `next`.
    pub fn then(&self, next: &Projective) -> Projective {
        let (a, b) = (self, next);
        Projective {
            a11: a.a11 * b.a11 + a.a12 * b.a21 + a.a13 * b.a31,
            a12: a.a11 * b.a12 + a.a12 * b.a22 + a.a13 * b.a32,
            a13: a.a11 * b.a13 + a.a12 * b.a23 + a.a13 * b.a33,
            a21: a.a21 * b.a11 + a.a22 * b.a21 + a.a23 * b.a31,
            a22: a.a21 * b.a12 + a.a22 * b.a22 + a.a23 * b.a32,
            a23: a.a21 * b.a13 + a.a22 * b.a23 + a.a23 * b.a33,
            a31: a.a31 * b.a11 + a.a32 * b.a21 + a.a33 * b.a31,
            a32: a.a31 * b.a12 + a.a32 * b.a22 + a.a33 * b.a32,
            a33: a.a31 * b.a13 + a.a32 * b.a23 + a.a33 * b.a33,
        }
    }

    /// Maps the quadrilateral `from` onto the quadrilateral `to`, corner by corner.
    pub fn quad_to_quad(from: [(f32, f32); 4], to: [(f32, f32); 4]) -> Projective {
        Projective::square_to_quad(from)
            .adjugate()
            .then(&Projective::square_to_quad(to))
    }

    /// Maps `count` points along a row, (x0, y), (x0 + 1, y) and so on, passing
    /// each to `f` with its index. Cheaper than `apply` on each: the
    /// numerators step by a constant and each point takes one division.
    pub fn for_row(&self, x0: f32, y: f32, count: usize, mut f: impl FnMut(usize, f32, f32)) {
        let mut nx = self.a11 * x0 + self.a21 * y + self.a31;
        let mut ny = self.a12 * x0 + self.a22 * y + self.a32;
        let mut d = self.a13 * x0 + self.a23 * y + self.a33;
        for k in 0..count {
            let inverse = 1.0 / d;
            f(k, nx * inverse, ny * inverse);
            nx += self.a11;
            ny += self.a12;
            d += self.a13;
        }
    }

    pub fn apply(&self, x: f32, y: f32) -> (f32, f32) {
        let d = self.a13 * x + self.a23 * y + self.a33;
        (
            (self.a11 * x + self.a21 * y + self.a31) / d,
            (self.a12 * x + self.a22 * y + self.a32) / d,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::abs;

    fn close(a: (f32, f32), b: (f32, f32)) -> bool {
        abs(a.0 - b.0) < 1e-2 && abs(a.1 - b.1) < 1e-2
    }

    #[test]
    fn maps_corners_onto_corners() {
        let from = [(3.5, 3.5), (21.5, 3.5), (18.5, 18.5), (3.5, 21.5)];
        let to = [(100.0, 80.0), (300.0, 95.0), (270.0, 260.0), (90.0, 300.0)];
        let t = Projective::quad_to_quad(from, to);
        for (a, b) in from.iter().zip(to) {
            assert!(
                close(t.apply(a.0, a.1), b),
                "{a:?} -> {:?} want {b:?}",
                t.apply(a.0, a.1)
            );
        }
    }

    #[test]
    fn affine_squares_scale_linearly() {
        let t = Projective::quad_to_quad(
            [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
            [(10.0, 10.0), (30.0, 10.0), (30.0, 30.0), (10.0, 30.0)],
        );
        assert!(close(t.apply(0.5, 0.5), (20.0, 20.0)));
    }
}
