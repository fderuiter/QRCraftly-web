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

//! Floating point math utilities for `no_std` on WebAssembly and host.

const WHOLE64: f64 = 4_503_599_627_370_496.0;

pub fn abs_f32(x: f32) -> f32 {
    f32::from_bits(x.to_bits() & 0x7fff_ffff)
}

pub fn abs_f64(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & 0x7fff_ffff_ffff_ffff)
}

pub fn trunc(x: f64) -> f64 {
    if abs_f64(x) >= WHOLE64 || x.is_nan() {
        x
    } else {
        (x as i64) as f64
    }
}

pub fn floor(x: f64) -> f64 {
    let t = trunc(x);
    if t > x {
        t - 1.0
    } else {
        t
    }
}

pub fn ceil(x: f64) -> f64 {
    let t = trunc(x);
    if t < x {
        t + 1.0
    } else {
        t
    }
}

pub fn round(x: f64) -> f64 {
    let t = trunc(x);
    let diff = abs_f64(x - t);
    if diff >= 0.5 {
        t + if x < 0.0 { -1.0 } else { 1.0 }
    } else {
        t
    }
}

pub fn sqrt(x: f64) -> f64 {
    if x.is_nan() || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 || x.is_infinite() {
        return x;
    }
    let mut g = f64::from_bits((x.to_bits() >> 1) + (1023u64 << 51));
    for _ in 0..8 {
        g = 0.5 * (g + x / g);
    }
    g
}

pub fn to_uint8_clamp(x: f64) -> u8 {
    if x <= 0.0 || x.is_nan() {
        0
    } else if x >= 255.0 {
        255
    } else {
        let f = floor(x);
        let diff = x - f;
        if diff < 0.5 {
            f as u8
        } else if diff > 0.5 {
            (f + 1.0) as u8
        } else {
            let fi = f as u64;
            if fi % 2 == 1 {
                (f + 1.0) as u8
            } else {
                f as u8
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_uint8_clamp() {
        assert_eq!(to_uint8_clamp(-5.0), 0);
        assert_eq!(to_uint8_clamp(300.0), 255);
        assert_eq!(to_uint8_clamp(2.5), 2);
        assert_eq!(to_uint8_clamp(3.5), 4);
        assert_eq!(to_uint8_clamp(235.4), 235);
        assert_eq!(to_uint8_clamp(235.6), 236);
    }

    #[test]
    fn test_floor_ceil() {
        assert_eq!(floor(2.7), 2.0);
        assert_eq!(floor(-2.7), -3.0);
        assert_eq!(ceil(2.1), 3.0);
        assert_eq!(ceil(-2.1), -2.0);
    }
}
