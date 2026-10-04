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

//! Shared maths for every QRCraftly WebAssembly module (#1182): GF(256),
//! Reed-Solomon encoding, CRC-32 and the module allocator.
//!
//! `no_std` plus nothing else: integer arithmetic only, so every browser and
//! every device computes the same bytes. Feature crates depend on this one and
//! never on anything outside the workspace.

#![no_std]
#![forbid(unsafe_op_in_unsafe_fn)]

pub mod abi;
pub mod crc32;
pub mod gf256;
pub mod reed_solomon;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
