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

//! Colour cross-talk (#1147): fitting `observed = matrix · emitted + offset`
//! to the eight corners of the colour cube in closed form, inverting it, and
//! splitting a camera frame into the three emitted channels.
//!
//! Only `+ - * /` on `f64`, in the order the TypeScript receiver used, so
//! every engine returns the same bits.

use crate::fmath::{abs, js_max, js_round, uint8_clamp};

/// A 3x3 matrix, row-major: row `i` is what camera channel `i` sees of each emitted channel.
pub type Matrix3 = [f64; 9];

/// Black, the primaries, the secondaries and white, in this order.
pub const SWATCHES: [[u8; 3]; 8] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
    [1, 1, 1],
];

/// Smallest swing, in levels of 255, a channel must show between its own off and on.
pub const MIN_CHANNEL_SWING: f64 = 40.0;
/// Largest residual, in levels, between the fitted model and any swatch.
pub const MAX_FIT_RESIDUAL: f64 = 40.0;
/// Smallest ratio of the determinant to the product of the diagonal.
const MIN_CONDITION: f64 = 0.25;

/// The fitted camera response and its inverse.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Model {
    pub matrix: Matrix3,
    pub offset: [f64; 3],
    pub inverse: Matrix3,
    pub white: [f64; 3],
    pub residual: f64,
}

fn times(m: &Matrix3, e: [f64; 3]) -> [f64; 3] {
    [
        m[0] * e[0] + m[1] * e[1] + m[2] * e[2],
        m[3] * e[0] + m[4] * e[1] + m[5] * e[2],
        m[6] * e[0] + m[7] * e[1] + m[8] * e[2],
    ]
}

/// Inverts a 3x3 matrix through its cofactors, or `None` when it is singular
/// or the channels are too mixed to separate.
pub fn invert(m: &Matrix3) -> Option<Matrix3> {
    let [a, b, c, d, e, f, g, h, i] = *m;
    let c00 = e * i - f * h;
    let c01 = f * g - d * i;
    let c02 = d * h - e * g;
    let det = a * c00 + b * c01 + c * c02;
    let diagonal = a * e * i;
    let usable = abs(det) > 0.0 && abs(det) >= MIN_CONDITION * abs(diagonal);
    if !usable {
        return None;
    }
    Some([
        c00 / det,
        (c * h - b * i) / det,
        (b * f - c * e) / det,
        c01 / det,
        (a * i - c * g) / det,
        (c * d - a * f) / det,
        c02 / det,
        (b * g - a * h) / det,
        (a * e - b * d) / det,
    ])
}

/// Fits the model to the eight swatches a camera saw (in [`SWATCHES`] order),
/// or `None` when the patch cannot be trusted.
pub fn fit(observed: &[[f64; 3]; 8]) -> Option<Model> {
    let mut matrix = [0f64; 9];
    let mut offset = [0f64; 3];
    for i in 0..3 {
        let mut total = 0.0;
        for swatch in observed {
            total += swatch[i];
        }
        for j in 0..3 {
            let mut on = 0.0;
            let mut off = 0.0;
            for (s, emitted) in SWATCHES.iter().enumerate() {
                if emitted[j] == 1 {
                    on += observed[s][i];
                } else {
                    off += observed[s][i];
                }
            }
            matrix[i * 3 + j] = (on - off) / 4.0;
        }
        offset[i] = total / 8.0 - (matrix[i * 3] + matrix[i * 3 + 1] + matrix[i * 3 + 2]) / 2.0;
    }
    for i in 0..3 {
        let swing = matrix[i * 3 + i];
        if swing.is_nan() || swing < MIN_CHANNEL_SWING {
            return None;
        }
        for j in 0..3 {
            if j != i && abs(matrix[i * 3 + j]) > swing {
                return None;
            }
        }
    }
    let inverse = invert(&matrix)?;
    let mut residual: f64 = 0.0;
    for (s, emitted) in SWATCHES.iter().enumerate() {
        let predicted = times(&matrix, emitted.map(f64::from));
        for i in 0..3 {
            residual = js_max(residual, abs(observed[s][i] - (predicted[i] + offset[i])));
        }
    }
    if residual > MAX_FIT_RESIDUAL {
        return None;
    }
    let sum = times(&matrix, [1.0, 1.0, 1.0]);
    Some(Model {
        matrix,
        offset,
        inverse,
        white: [sum[0] + offset[0], sum[1] + offset[1], sum[2] + offset[2]],
        residual: js_round(residual),
    })
}

/// Scales every camera channel so that white lands on `white`, matrix and
/// black level together, or `None` when the new white is unusable.
pub fn rescale_to_white(model: &Model, white: [f64; 3]) -> Option<Model> {
    let gain = [
        white[0] / model.white[0],
        white[1] / model.white[1],
        white[2] / model.white[2],
    ];
    if !gain.iter().all(|&g| g > 0.0 && g.is_finite()) {
        return None;
    }
    let mut matrix = model.matrix;
    for (i, &g) in gain.iter().enumerate() {
        for value in &mut matrix[i * 3..i * 3 + 3] {
            *value *= g;
        }
    }
    let inverse = invert(&matrix)?;
    Some(Model {
        matrix,
        inverse,
        offset: [
            model.offset[0] * gain[0],
            model.offset[1] * gain[1],
            model.offset[2] * gain[2],
        ],
        white,
        residual: model.residual,
    })
}

/// Splits `width * height` RGBA pixels into three planes (red, green, blue)
/// of `width * height` bytes each, one after another in `out`: each pixel
/// less `offset`, times `inverse`, times `scale`, stored as a
/// `Uint8ClampedArray` stores it.
pub fn split(rgba: &[u8], inverse: &Matrix3, offset: &[f64; 3], scale: f64, out: &mut [u8]) {
    let n = rgba.len() / 4;
    let (red, rest) = out.split_at_mut(n);
    let (green, blue) = rest.split_at_mut(n);
    for (k, px) in rgba.chunks_exact(4).enumerate() {
        let r = px[0] as f64 - offset[0];
        let g = px[1] as f64 - offset[1];
        let b = px[2] as f64 - offset[2];
        red[k] = uint8_clamp((inverse[0] * r + inverse[1] * g + inverse[2] * b) * scale);
        green[k] = uint8_clamp((inverse[3] * r + inverse[4] * g + inverse[5] * b) * scale);
        blue[k] = uint8_clamp((inverse[6] * r + inverse[7] * g + inverse[8] * b) * scale);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observe(matrix: &Matrix3, offset: [f64; 3]) -> [[f64; 3]; 8] {
        SWATCHES.map(|e| {
            let p = times(matrix, e.map(f64::from));
            [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]
        })
    }

    #[test]
    fn recovers_a_known_mixture() {
        let matrix = [180.0, 30.0, 10.0, 25.0, 170.0, 20.0, 5.0, 35.0, 160.0];
        let model = fit(&observe(&matrix, [12.0, 10.0, 14.0])).unwrap();
        for (a, b) in model.matrix.iter().zip(&matrix) {
            assert!((a - b).abs() < 1e-9);
        }
        assert_eq!(model.residual, 0.0);
        let rgba = [192, 35, 19, 255];
        let mut planes = [0u8; 3];
        split(&rgba, &model.inverse, &model.offset, 255.0, &mut planes);
        assert_eq!(planes, [255, 0, 0]);
    }

    #[test]
    fn refuses_weak_or_mixed_channels() {
        let weak = [20.0, 0.0, 0.0, 0.0, 170.0, 0.0, 0.0, 0.0, 160.0];
        assert!(fit(&observe(&weak, [0.0; 3])).is_none());
        let mixed = [100.0, 120.0, 0.0, 0.0, 170.0, 0.0, 0.0, 0.0, 160.0];
        assert!(fit(&observe(&mixed, [0.0; 3])).is_none());
    }

    #[test]
    fn rescales_to_a_new_white() {
        let matrix = [180.0, 30.0, 10.0, 25.0, 170.0, 20.0, 5.0, 35.0, 160.0];
        let model = fit(&observe(&matrix, [0.0; 3])).unwrap();
        let moved = rescale_to_white(
            &model,
            [model.white[0] * 0.9, model.white[1], model.white[2]],
        )
        .unwrap();
        assert!((moved.matrix[0] - 162.0).abs() < 1e-9);
        assert!(rescale_to_white(&model, [0.0, 1.0, 1.0]).is_none());
    }
}
