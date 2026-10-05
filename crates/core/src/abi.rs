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

//! The calling convention every module shares with `src/packages/wasm-runtime`.
//!
//! Exports are plain `extern "C"` functions over linear memory: the caller
//! copies input in with `alloc`, passes pointer and length, reads output the
//! same way and calls `free`. Functions that can fail return one of the status
//! codes below; the loader turns them into typed errors.

/// Bumped when the shared exports (`alloc`, `free`, `abi_version`) change shape.
pub const ABI_VERSION: u32 = 1;

/// The call succeeded.
pub const STATUS_OK: i32 = 0;
/// The input was malformed or out of range.
pub const STATUS_BAD_INPUT: i32 = 1;
/// The module could not allocate memory.
pub const STATUS_OUT_OF_MEMORY: i32 = 2;
/// An output buffer was too small.
pub const STATUS_BUFFER_TOO_SMALL: i32 = 3;
/// The data does not fit the requested symbol (for example a QR code longer than version 40 holds).
pub const STATUS_DATA_TOO_LONG: i32 = 4;
