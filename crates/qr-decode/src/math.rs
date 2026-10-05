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

//! The float operations `core` lacks without `std`, written out so the host
//! tests and the WebAssembly build run exactly the same arithmetic.

/// Above this every `f32` is already a whole number.
const WHOLE: f32 = 8_388_608.0;

pub fn abs(x: f32) -> f32 {
    f32::from_bits(x.to_bits() & 0x7fff_ffff)
}

fn trunc(x: f32) -> f32 {
    if abs(x) >= WHOLE || x.is_nan() {
        x
    } else {
        x as i32 as f32
    }
}

pub fn floor(x: f32) -> f32 {
    let t = trunc(x);
    if t > x {
        t - 1.0
    } else {
        t
    }
}

/// Halves away from zero, as `f32::round` does.
pub fn round(x: f32) -> f32 {
    let t = trunc(x);
    if abs(x - t) >= 0.5 {
        t + if x < 0.0 { -1.0 } else { 1.0 }
    } else {
        t
    }
}

/// Newton's method in `f64` from an exponent-halving guess; five steps
/// settle well below `f32` precision for any positive finite input.
pub fn sqrt(x: f32) -> f32 {
    if x.is_nan() || x < 0.0 {
        return f32::NAN;
    }
    if x == 0.0 || x.is_infinite() {
        return x;
    }
    let v = x as f64;
    let mut g = f64::from_bits((v.to_bits() >> 1) + (1023u64 << 51));
    for _ in 0..5 {
        g = 0.5 * (g + v / g);
    }
    g as f32
}

pub fn distance(ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let (dx, dy) = (ax - bx, ay - by);
    sqrt(dx * dx + dy * dy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_halves_away_from_zero() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -3.0);
        assert_eq!(round(2.49), 2.0);
        assert_eq!(floor(-0.5), -1.0);
        assert_eq!(distance(0.0, 0.0, 3.0, 4.0), 5.0);
    }

    #[test]
    fn matches_std() {
        let mut x = 1.0e-6f32;
        while x < 1.0e7 {
            assert_eq!(sqrt(x), x.sqrt(), "sqrt {x}");
            assert_eq!(floor(x), x.floor());
            assert_eq!(floor(-x), (-x).floor());
            assert_eq!(round(x), x.round());
            assert_eq!(round(-x), (-x).round());
            x *= 1.37;
        }
        assert!(sqrt(-1.0).is_nan());
        assert_eq!(abs(-2.5), 2.5);
    }
}
