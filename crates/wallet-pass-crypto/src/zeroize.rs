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

//! Zeroization utilities for sensitive memory buffers.

/// Zeroes out a slice of bytes using volatile writes so the compiler cannot optimize it away.
pub fn zeroize_bytes(slice: &mut [u8]) {
    for byte in slice.iter_mut() {
        unsafe { core::ptr::write_volatile(byte, 0) };
    }
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
}

/// Zeroes out a slice of u32s using volatile writes.
pub fn zeroize_u32s(slice: &mut [u32]) {
    for word in slice.iter_mut() {
        unsafe { core::ptr::write_volatile(word, 0) };
    }
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
}

/// A wrapper around `alloc::vec::Vec<u8>` that zeroizes its buffer on drop.
pub struct ZeroizingVec {
    vec: alloc::vec::Vec<u8>,
}

impl Default for ZeroizingVec {
    fn default() -> Self {
        Self::new()
    }
}

impl ZeroizingVec {
    pub fn new() -> Self {
        Self {
            vec: alloc::vec::Vec::new(),
        }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            vec: alloc::vec::Vec::with_capacity(capacity),
        }
    }

    pub fn from_vec(vec: alloc::vec::Vec<u8>) -> Self {
        Self { vec }
    }

    pub fn into_vec(mut self) -> alloc::vec::Vec<u8> {
        let mut v = alloc::vec::Vec::new();
        core::mem::swap(&mut self.vec, &mut v);
        core::mem::forget(self);
        v
    }
}

impl core::ops::Deref for ZeroizingVec {
    type Target = alloc::vec::Vec<u8>;
    fn deref(&self) -> &Self::Target {
        &self.vec
    }
}

impl core::ops::DerefMut for ZeroizingVec {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.vec
    }
}

impl Drop for ZeroizingVec {
    fn drop(&mut self) {
        zeroize_bytes(&mut self.vec);
    }
}
