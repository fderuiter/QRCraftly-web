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

//! What every `cdylib` module needs on `wasm32-unknown-unknown`: an allocator,
//! a panic handler and the `alloc`/`free`/`abi_version` exports. A module gets
//! all of them with one line, `qrcraftly_core::module_exports!();`.
//!
//! The allocator is a bump allocator that rewinds when every allocation has been
//! freed. Calls into a module allocate, work and free, so memory is reused call
//! after call without a free list. Linear memory only grows; it never shrinks.

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;
use core::cell::UnsafeCell;

const PAGE: usize = 65_536;

extern "C" {
    /// First byte after the stack and static data, placed by the linker.
    static __heap_base: u8;
}

struct State {
    next: usize,
    live: usize,
}

/// The module allocator. Use it through [`module_exports!`].
pub struct BumpAllocator {
    state: UnsafeCell<State>,
}

// WebAssembly modules here are single threaded: no shared memory, no atomics.
unsafe impl Sync for BumpAllocator {}

impl BumpAllocator {
    pub const fn new() -> Self {
        Self {
            state: UnsafeCell::new(State { next: 0, live: 0 }),
        }
    }
}

impl Default for BumpAllocator {
    fn default() -> Self {
        Self::new()
    }
}

fn heap_base() -> usize {
    // Only the symbol's address is taken; it is never read.
    core::ptr::addr_of!(__heap_base) as usize
}

unsafe impl GlobalAlloc for BumpAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: single threaded, and no reference to the state outlives this call.
        let state = unsafe { &mut *self.state.get() };
        if state.next == 0 || state.live == 0 {
            state.next = heap_base();
        }
        let align = layout.align();
        let start = match state.next.checked_add(align - 1) {
            Some(v) => v & !(align - 1),
            None => return core::ptr::null_mut(),
        };
        let end = match start.checked_add(layout.size()) {
            Some(v) => v,
            None => return core::ptr::null_mut(),
        };
        let have = wasm32::memory_size(0) * PAGE;
        if end > have {
            let pages = (end - have).div_ceil(PAGE);
            if wasm32::memory_grow(0, pages) == usize::MAX {
                return core::ptr::null_mut();
            }
        }
        state.next = end;
        state.live += 1;
        start as *mut u8
    }

    unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {
        // SAFETY: as in `alloc`.
        let state = unsafe { &mut *self.state.get() };
        state.live = state.live.saturating_sub(1);
    }
}

/// Defines the global allocator, the panic handler and the shared exports.
/// Invoke it once at the root of every `cdylib` module crate.
#[macro_export]
macro_rules! module_exports {
    () => {
        #[global_allocator]
        static ALLOCATOR: $crate::wasm::BumpAllocator = $crate::wasm::BumpAllocator::new();

        /// A panic traps; the loader reports it as a typed error.
        #[panic_handler]
        fn panic(_info: &core::panic::PanicInfo) -> ! {
            core::arch::wasm32::unreachable()
        }

        /// Reserves `len` bytes and returns their address, or 0 when out of memory.
        #[no_mangle]
        pub extern "C" fn alloc(len: usize) -> *mut u8 {
            let Ok(layout) = core::alloc::Layout::from_size_align(len.max(1), 8) else {
                return core::ptr::null_mut();
            };
            // SAFETY: the layout has a non-zero size.
            unsafe { alloc::alloc::alloc(layout) }
        }

        /// Releases memory returned by `alloc` with the same length.
        ///
        /// # Safety
        /// `ptr` and `len` must come from one earlier `alloc` call.
        #[no_mangle]
        pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) {
            if ptr.is_null() {
                return;
            }
            if let Ok(layout) = core::alloc::Layout::from_size_align(len.max(1), 8) {
                // SAFETY: the caller passes back what `alloc` returned.
                unsafe { alloc::alloc::dealloc(ptr, layout) }
            }
        }

        /// The shared calling convention this module speaks.
        #[no_mangle]
        pub extern "C" fn abi_version() -> u32 {
            $crate::abi::ABI_VERSION
        }
    };
}
