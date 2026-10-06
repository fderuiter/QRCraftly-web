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

//! Where the receiver looks in a frame (ADR 0028), in cells. The same
//! formulas as `createLayout` in `src/packages/optical-modem/lib/layout.ts`,
//! which draws the frames.

/// Side of the square block each corner fiducial occupies, in cells.
pub const FIDUCIAL_SIZE: u32 = 9;
/// Rows in the top band and in the bottom band.
pub const BAND_ROWS: u32 = 9;
/// Fewest columns a frame can have.
pub const MIN_COLS: u32 = 104;
/// Fewest rows a frame can have.
pub const MIN_ROWS: u32 = 40;
/// Bits of the header codeword.
pub const HEADER_BITS: usize = 336;

/// A frame's grid, checked against the smallest frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grid {
    pub cols: u32,
    pub rows: u32,
}

impl Grid {
    pub fn new(cols: u32, rows: u32) -> Option<Grid> {
        if cols < MIN_COLS || rows < MIN_ROWS || cols > 4096 || rows > 4096 {
            return None;
        }
        Some(Grid { cols, rows })
    }

    pub fn data_rows(&self) -> u32 {
        self.rows - 2 * BAND_ROWS
    }

    /// Column and row of cell `i` of calibration patch `p` (0 black, 1 white,
    /// 2 + s symbol `s`) in the top strip (`bottom` false) or the bottom one.
    pub fn patch_cell(&self, p: u32, i: u32, bottom: bool) -> (u32, u32) {
        let col = FIDUCIAL_SIZE + 2 * p + (i & 1);
        let row = if bottom {
            self.rows - 8 + (i >> 1)
        } else {
            1 + (i >> 1)
        };
        (col, row)
    }

    /// Header cells in one strip; cell `t` carries bit `t % HEADER_BITS`.
    pub fn header_cells(&self) -> u32 {
        (self.cols - 2 * FIDUCIAL_SIZE) * 4
    }

    /// Column and row of header cell `t` in the top strip or the bottom one.
    pub fn header_cell(&self, t: u32, bottom: bool) -> (u32, u32) {
        let col = FIDUCIAL_SIZE + (t >> 2);
        let row = if bottom {
            self.rows - 4 + (t & 3)
        } else {
            5 + (t & 3)
        };
        (col, row)
    }

    /// Centre of fiducial `index` (0 top-left, 1 top-right, 2 bottom-left,
    /// 3 bottom-right) in cell coordinates.
    pub fn fiducial_centre(&self, index: u32) -> (f64, f64) {
        let col = if index & 1 == 1 {
            self.cols - FIDUCIAL_SIZE
        } else {
            0
        };
        let row = if index >= 2 {
            self.rows - FIDUCIAL_SIZE
        } else {
            0
        };
        (col as f64 + 4.5, row as f64 + 4.5)
    }
}
