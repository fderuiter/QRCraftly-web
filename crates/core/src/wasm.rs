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
//! The allocator is [`Heap`]: size-class free lists over a bump pointer that
//! rewinds when every allocation has been freed. A long-lived handle no longer
//! pins the memory freed around it (#1611). Linear memory only grows; it never shrinks.

use crate::heap::{Heap, Region};
use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;
use core::cell::UnsafeCell;
use core::ptr::{self, NonNull};

const PAGE: usize = 65_536;

extern "C" {
    /// First byte after the stack and static data, placed by the linker.
    static __heap_base: u8;
}

/// The module's linear memory above the stack and static data.
struct LinearMemory;

impl Region for LinearMemory {
    fn base(&self) -> usize {
        // Only the symbol's address is taken; it is never read.
        core::ptr::addr_of!(__heap_base) as usize
    }

    fn reserve(&mut self, end: usize) -> bool {
        let have = wasm32::memory_size(0) * PAGE;
        end <= have || wasm32::memory_grow(0, (end - have).div_ceil(PAGE)) != usize::MAX
    }
}

/// The module allocator. Use it through [`module_exports!`].
pub struct ModuleAllocator {
    heap: UnsafeCell<Heap>,
}

// WebAssembly modules here are single threaded: no shared memory, no atomics.
unsafe impl Sync for ModuleAllocator {}

impl ModuleAllocator {
    pub const fn new() -> Self {
        Self {
            heap: UnsafeCell::new(Heap::new()),
        }
    }
}

impl Default for ModuleAllocator {
    fn default() -> Self {
        Self::new()
    }
}

unsafe impl GlobalAlloc for ModuleAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: single threaded, no reference to the heap outlives this call, and
        // linear memory above `__heap_base` belongs to this allocator alone.
        unsafe { (*self.heap.get()).alloc(layout, &mut LinearMemory) }
            .map_or(ptr::null_mut(), NonNull::as_ptr)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let Some(block) = NonNull::new(ptr) else {
            return;
        };
        // SAFETY: as in `alloc`; the caller passes back a block from it.
        unsafe { (*self.heap.get()).dealloc(block, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let Some(block) = NonNull::new(ptr) else {
            return ptr::null_mut();
        };
        // SAFETY: as in `dealloc`; GlobalAlloc's contract bounds `new_size`.
        unsafe { (*self.heap.get()).realloc(block, layout, new_size, &mut LinearMemory) }
            .map_or(ptr::null_mut(), NonNull::as_ptr)
    }
}

/// Defines the global allocator, the panic handler and the shared exports.
/// Invoke it once at the root of every `cdylib` module crate.
#[macro_export]
macro_rules! module_exports {
    () => {
        #[global_allocator]
        static ALLOCATOR: $crate::wasm::ModuleAllocator = $crate::wasm::ModuleAllocator::new();

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
