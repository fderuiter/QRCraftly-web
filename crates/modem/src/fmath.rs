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

//! The float operations `core` lacks without `std`, with JavaScript's
//! semantics where the modem relied on them.
//!
//! `sqrt` and `floor` are exact: `floor` by truncation, `sqrt` correctly
//! rounded as IEEE 754 (and `Math.sqrt`) requires, from a Newton estimate
//! settled with integer arithmetic. `sin`, `cos` and `log2` are ports of
//! fdlibm (FreeBSD `msun`), the code V8 and SpiderMonkey use for `Math.sin`,
//! `Math.cos` and `Math.log2`. Everything is `+ - * /` and integer work, so
//! the host tests and every engine compute the same bits. `sin`, `cos` and
//! `log2` feed the probe's report numbers only, never anything that decides
//! what a receiver reads.

/// 2^52: every `f64` at least this large is a whole number.
const WHOLE: f64 = 4_503_599_627_370_496.0;

/// Rounds towards negative infinity.
#[inline]
pub fn floor(x: f64) -> f64 {
    if x.is_nan() || abs(x) >= WHOLE {
        return x;
    }
    let t = x as i64 as f64;
    if t == x {
        x
    } else if t > x {
        t - 1.0
    } else {
        t
    }
}

/// The integer square root of `n`, from an estimate within a few units.
fn settle_isqrt(n: u128, estimate: u64) -> (u64, u128) {
    let mut q = estimate as u128;
    while q * q > n {
        q -= 1;
    }
    while (q + 1) * (q + 1) <= n {
        q += 1;
    }
    (q as u64, n - q * q)
}

/// The square root, correctly rounded (round half to even), like `Math.sqrt`.
pub fn sqrt(x: f64) -> f64 {
    if x.is_nan() || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 || x == f64::INFINITY {
        return x;
    }
    let bits = x.to_bits();
    let mut exponent = ((bits >> 52) & 0x7ff) as i32;
    let mut mantissa = bits & ((1 << 52) - 1);
    if exponent == 0 {
        let shift = mantissa.leading_zeros() - 11;
        mantissa <<= shift;
        exponent = 1 - shift as i32;
    } else {
        mantissa |= 1 << 52;
    }
    // x = mantissa * 2^e with an even e and mantissa in [2^52, 2^54).
    let mut e = exponent - 1075;
    if e & 1 != 0 {
        mantissa <<= 1;
        e -= 1;
    }
    // sqrt(mantissa * 2^56) is in [2^54, 2^55): 53 bits, a round bit and one more.
    let n = (mantissa as u128) << 56;
    let m = mantissa as f64;
    let mut g = f64::from_bits((m.to_bits() >> 1) + (1023u64 << 51));
    for _ in 0..6 {
        g = 0.5 * (g + m / g);
    }
    let (q, rem) = settle_isqrt(n, (g * 268_435_456.0) as u64);
    let dropped = q & 3;
    let mut significand = q >> 2;
    let round_up = dropped > 2 || (dropped == 2 && (rem != 0 || significand & 1 == 1));
    if round_up {
        significand += 1;
    }
    let mut scale = e / 2 - 26;
    if significand == 1 << 53 {
        significand >>= 1;
        scale += 1;
    }
    // significand * 2^scale, with significand in [2^52, 2^53): always a normal number.
    let biased = (scale + 52 + 1023) as u64;
    f64::from_bits((biased << 52) | (significand & ((1 << 52) - 1)))
}

#[inline]
pub fn abs(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & 0x7fff_ffff_ffff_ffff)
}

/// `Math.round`: the nearest integer, halves towards positive infinity.
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = floor(x);
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `Math.max` of two numbers: NaN wins.
#[inline]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// `Math.min` of two numbers: NaN wins.
#[inline]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// What storing `x` in a `Uint8ClampedArray` keeps: NaN is 0, the range is
/// clamped and halves round to even.
pub fn uint8_clamp(x: f64) -> u8 {
    if x.is_nan() || x <= 0.0 {
        return 0;
    }
    if x >= 255.0 {
        return 255;
    }
    let f = floor(x);
    let half = f + 0.5;
    let up = half < x || (x == half && !(f as u32).is_multiple_of(2));
    let rounded = if up { f + 1.0 } else { f };
    rounded as u8
}

fn high_word(x: f64) -> i32 {
    (x.to_bits() >> 32) as u32 as i32
}

fn low_word(x: f64) -> u32 {
    x.to_bits() as u32
}

fn with_high_word(x: f64, high: u32) -> f64 {
    f64::from_bits((u64::from(high) << 32) | (x.to_bits() & 0xffff_ffff))
}

fn from_words(high: u32, low: u32) -> f64 {
    f64::from_bits((u64::from(high) << 32) | u64::from(low))
}

const S1: f64 = f64::from_bits(0xBFC5_5555_5555_5549);
const S2: f64 = f64::from_bits(0x3F81_1111_1110_F8A6);
const S3: f64 = f64::from_bits(0xBF2A_01A0_19C1_61D5);
const S4: f64 = f64::from_bits(0x3EC7_1DE3_57B1_FE7D);
const S5: f64 = f64::from_bits(0xBE5A_E5E6_8A2B_9CEB);
const S6: f64 = f64::from_bits(0x3DE5_D93A_5ACF_D57C);

/// fdlibm `__kernel_sin` on [-pi/4, pi/4]; `y` is the tail of `x`.
fn kernel_sin(x: f64, y: f64, iy: bool) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix < 0x3e40_0000 && x as i32 == 0 {
        return x;
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if !iy {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

const C1: f64 = f64::from_bits(0x3FA5_5555_5555_554C);
const C2: f64 = f64::from_bits(0xBF56_C16C_16C1_5177);
const C3: f64 = f64::from_bits(0x3EFA_01A0_19CB_1590);
const C4: f64 = f64::from_bits(0xBE92_7E4F_809C_52AD);
const C5: f64 = f64::from_bits(0x3E21_EE9E_BDB4_B1C4);
const C6: f64 = f64::from_bits(0xBDA8_FAE9_BE88_38D4);

/// fdlibm `__kernel_cos` on [-pi/4, pi/4]; `y` is the tail of `x`.
fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix < 0x3e40_0000 && x as i32 == 0 {
        return 1.0;
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3fd3_3333 {
        1.0 - (0.5 * z - (z * r - x * y))
    } else {
        let qx = if ix > 0x3fe9_0000 {
            0.28125
        } else {
            from_words((ix - 0x0020_0000) as u32, 0)
        };
        let iz = 0.5 * z - qx;
        let a = 1.0 - qx;
        a - (iz - (z * r - x * y))
    }
}

const INVPIO2: f64 = f64::from_bits(0x3FE4_5F30_6DC9_C883);
const PIO2_1: f64 = f64::from_bits(0x3FF9_21FB_5440_0000);
const PIO2_1T: f64 = f64::from_bits(0x3DD0_B461_1A62_6331);
const PIO2_2: f64 = f64::from_bits(0x3DD0_B461_1A60_0000);
const PIO2_2T: f64 = f64::from_bits(0x3BA3_198A_2E03_7073);
const PIO2_3: f64 = f64::from_bits(0x3BA3_198A_2E00_0000);
const PIO2_3T: f64 = f64::from_bits(0x397B_839A_2520_49C1);

const NPIO2_HW: [i32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
    0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
    0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];

/// fdlibm `__ieee754_rem_pio2` for |x| up to 2^19 pi/2 (larger arguments
/// use the same steps, less precisely; the probe never passes one).
fn rem_pio2(x: f64) -> (i32, f64, f64) {
    let hx = high_word(x);
    let ix = hx & 0x7fff_ffff;
    if ix <= 0x3fe9_21fb {
        return (0, x, 0.0);
    }
    if ix < 0x4002_d97c {
        return if hx > 0 {
            let mut z = x - PIO2_1;
            if ix != 0x3ff9_21fb {
                let y0 = z - PIO2_1T;
                (1, y0, (z - y0) - PIO2_1T)
            } else {
                z -= PIO2_2;
                let y0 = z - PIO2_2T;
                (1, y0, (z - y0) - PIO2_2T)
            }
        } else {
            let mut z = x + PIO2_1;
            if ix != 0x3ff9_21fb {
                let y0 = z + PIO2_1T;
                (-1, y0, (z - y0) + PIO2_1T)
            } else {
                z += PIO2_2;
                let y0 = z + PIO2_2T;
                (-1, y0, (z - y0) + PIO2_2T)
            }
        };
    }
    let t = abs(x);
    let n = (t * INVPIO2 + 0.5) as i32;
    let f_n = n as f64;
    let mut r = t - f_n * PIO2_1;
    let mut w = f_n * PIO2_1T;
    let mut y0;
    if (1..32).contains(&n) && ix != NPIO2_HW[(n - 1) as usize] {
        y0 = r - w;
    } else {
        let j = ix >> 20;
        y0 = r - w;
        let mut i = j - ((high_word(y0) >> 20) & 0x7ff);
        if i > 16 {
            let t = r;
            w = f_n * PIO2_2;
            r = t - w;
            w = f_n * PIO2_2T - ((t - r) - w);
            y0 = r - w;
            i = j - ((high_word(y0) >> 20) & 0x7ff);
            if i > 49 {
                let t = r;
                w = f_n * PIO2_3;
                r = t - w;
                w = f_n * PIO2_3T - ((t - r) - w);
                y0 = r - w;
            }
        }
    }
    let y1 = (r - y0) - w;
    if hx < 0 {
        (-n, -y0, -y1)
    } else {
        (n, y0, y1)
    }
}

/// `Math.sin`, as fdlibm computes it.
pub fn sin(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix <= 0x3fe9_21fb {
        return kernel_sin(x, 0.0, false);
    }
    if ix >= 0x7ff0_0000 {
        return f64::NAN;
    }
    let (n, y0, y1) = rem_pio2(x);
    match n & 3 {
        0 => kernel_sin(y0, y1, true),
        1 => kernel_cos(y0, y1),
        2 => -kernel_sin(y0, y1, true),
        _ => -kernel_cos(y0, y1),
    }
}

/// `Math.cos`, as fdlibm computes it.
pub fn cos(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix <= 0x3fe9_21fb {
        return kernel_cos(x, 0.0);
    }
    if ix >= 0x7ff0_0000 {
        return f64::NAN;
    }
    let (n, y0, y1) = rem_pio2(x);
    match n & 3 {
        0 => kernel_cos(y0, y1),
        1 => -kernel_sin(y0, y1, true),
        2 => -kernel_cos(y0, y1),
        _ => kernel_sin(y0, y1, true),
    }
}

const LG1: f64 = f64::from_bits(0x3FE5_5555_5555_5593);
const LG2: f64 = f64::from_bits(0x3FD9_9999_9997_FA04);
const LG3: f64 = f64::from_bits(0x3FD2_4924_9422_9359);
const LG4: f64 = f64::from_bits(0x3FCC_71C5_1D8E_78AF);
const LG5: f64 = f64::from_bits(0x3FC7_4664_96CB_03DE);
const LG6: f64 = f64::from_bits(0x3FC3_9A09_D078_C69F);
const LG7: f64 = f64::from_bits(0x3FC2_F112_DF3E_5244);
const TWO54: f64 = f64::from_bits(0x4350_0000_0000_0000);
const IVLN2HI: f64 = f64::from_bits(0x3FF7_1547_6520_0000);
const IVLN2LO: f64 = f64::from_bits(0x3DE7_05FC_2EEF_A200);

fn k_log1p(f: f64) -> f64 {
    let s = f / (2.0 + f);
    let z = s * s;
    let w = z * z;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    let r = t2 + t1;
    let hfsq = 0.5 * f * f;
    s * (hfsq + r)
}

/// `Math.log2`, as fdlibm (FreeBSD `e_log2.c`) computes it.
pub fn log2(x: f64) -> f64 {
    let mut x = x;
    let mut hx = high_word(x);
    let lx = low_word(x);
    let mut k: i32 = 0;
    if hx < 0x0010_0000 {
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return f64::NEG_INFINITY;
        }
        if hx < 0 {
            return f64::NAN;
        }
        k -= 54;
        x *= TWO54;
        hx = high_word(x);
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    if hx == 0x3ff0_0000 && low_word(x) == 0 {
        return 0.0;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000f_ffff;
    let i = (hx + 0x95f64) & 0x10_0000;
    x = with_high_word(x, (hx | (i ^ 0x3ff0_0000)) as u32);
    k += i >> 20;
    let y = k as f64;
    let f = x - 1.0;
    let hfsq = 0.5 * f * f;
    let r = k_log1p(f);
    let hi = f64::from_bits((f - hfsq).to_bits() & 0xffff_ffff_0000_0000);
    let lo = (f - hi) - hfsq + r;
    let mut val_hi = hi * IVLN2HI;
    let mut val_lo = (lo + hi) * IVLN2LO + lo * IVLN2HI;
    let w = y + val_hi;
    val_lo += (y - w) + val_hi;
    val_hi = w;
    val_lo + val_hi
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ulps(a: f64, b: f64) -> u64 {
        if a == b {
            return 0;
        }
        (a.to_bits() as i64 - b.to_bits() as i64).unsigned_abs()
    }

    #[test]
    fn follows_javascript_rounding() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(42.5), 43.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(uint8_clamp(f64::NAN), 0);
        assert_eq!(uint8_clamp(-3.0), 0);
        assert_eq!(uint8_clamp(300.0), 255);
        assert_eq!(uint8_clamp(2.5), 2);
        assert_eq!(uint8_clamp(3.5), 4);
        assert_eq!(uint8_clamp(3.4), 3);
        assert!(js_max(1.0, f64::NAN).is_nan());
        assert_eq!(js_max(1.0, 2.0), 2.0);
        assert_eq!(js_min(1.0, 2.0), 1.0);
    }

    #[test]
    fn sqrt_and_floor_are_exact() {
        let mut state = 0x1198_u64;
        for i in 0..200_000 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            // Any positive finite double, subnormals included, and some small integers.
            let x = if i % 4 == 0 {
                (state % 100_000) as f64
            } else {
                f64::from_bits(state & 0x7fef_ffff_ffff_ffff)
            };
            assert_eq!(sqrt(x).to_bits(), x.sqrt().to_bits(), "sqrt {x:e}");
            let y = f64::from_bits(state) / 1e290;
            if y.is_finite() {
                assert_eq!(floor(y).to_bits(), y.floor().to_bits(), "floor {y:e}");
            }
        }
        for x in [0.0, 1.0, 2.0, 4.0, 0.25, 1e-320, f64::MAX, f64::INFINITY] {
            assert_eq!(sqrt(x).to_bits(), x.sqrt().to_bits(), "sqrt {x:e}");
        }
        assert!(sqrt(-1.0).is_nan() && sqrt(f64::NAN).is_nan());
        assert_eq!(floor(-0.5), -1.0);
        assert_eq!(floor(-0.0).to_bits(), (-0.0f64).to_bits());
        assert_eq!(floor(2.0), 2.0);
        assert!(floor(f64::NAN).is_nan());
    }

    #[test]
    fn trigonometry_and_logarithm_agree_with_the_platform() {
        let mut x = -700.0;
        while x < 700.0 {
            assert!(ulps(sin(x), x.sin()) <= 1, "sin {x}");
            assert!(ulps(cos(x), x.cos()) <= 1, "cos {x}");
            x += 0.0137;
        }
        let mut x = 1.0e-300;
        while x < 1.0e300 {
            assert!(ulps(log2(x), x.log2()) <= 1, "log2 {x}");
            x *= 1.37;
        }
        assert_eq!(log2(1.0), 0.0);
        assert_eq!(log2(8.0), 3.0);
        assert_eq!(log2(0.0), f64::NEG_INFINITY);
        assert!(log2(-1.0).is_nan());
        assert_eq!(sin(0.0), 0.0);
        assert_eq!(cos(0.0), 1.0);
    }
}
