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

//! The module allocator's bookkeeping (#1611), kept apart from wasm32 so the
//! host can test it.
//!
//! Blocks are rounded up to a power of two. A freed block goes on the free list
//! of its size and the next allocation of that size takes it back, so a long
//! lived handle (a decoder kept for a whole transfer) no longer stops memory
//! from being reused frame after frame. New blocks are bumped from the top, and
//! when every block has been freed the heap rewinds to its base, as before.

use core::alloc::Layout;
use core::ptr::{self, NonNull};

/// Smallest block, as a power of two: room for the free-list link on any target.
const MIN_SHIFT: u32 = 4;
/// One free list per power of two up to half the address space.
const CLASSES: usize = (usize::BITS - MIN_SHIFT) as usize;

/// The memory a [`Heap`] hands out: one range that starts at `base` and grows upwards.
pub trait Region {
    /// Address of the first byte the heap may use.
    fn base(&self) -> usize;
    /// Makes every byte below `end` usable, or returns false when memory cannot grow.
    fn reserve(&mut self, end: usize) -> bool;
}

/// Size-class free lists over a bump pointer.
pub struct Heap {
    /// Next unused address; 0 before the first allocation.
    next: usize,
    /// Blocks handed out and not yet freed.
    live: usize,
    /// Head of each class's free list (0 when empty). The link is stored in the block.
    free: [usize; CLASSES],
    /// Highest address ever handed out, for tests and measurements.
    high_water: usize,
}

impl Default for Heap {
    fn default() -> Self {
        Self::new()
    }
}

/// The class of a layout and its block size, or None when it is too large.
fn class_of(layout: Layout) -> Option<(usize, usize)> {
    let size = layout.size().max(layout.align()).max(1 << MIN_SHIFT);
    let block = size.checked_next_power_of_two()?;
    let class = (block.trailing_zeros() - MIN_SHIFT) as usize;
    (class < CLASSES).then_some((class, block))
}

impl Heap {
    pub const fn new() -> Self {
        Self {
            next: 0,
            live: 0,
            free: [0; CLASSES],
            high_water: 0,
        }
    }

    /// Bytes from the region's base to the highest address handed out so far.
    pub fn high_water(&self, region: &impl Region) -> usize {
        self.high_water.saturating_sub(region.base())
    }

    /// Blocks handed out and not yet freed.
    pub fn live(&self) -> usize {
        self.live
    }

    /// Returns a block for `layout`, or None when memory cannot grow.
    ///
    /// # Safety
    /// `region` must be the same region on every call, and the memory it reserves
    /// must be used by nothing but this heap.
    pub unsafe fn alloc(
        &mut self,
        layout: Layout,
        region: &mut impl Region,
    ) -> Option<NonNull<u8>> {
        let (class, block) = class_of(layout)?;
        if self.live == 0 {
            // Nothing is in use: start again from the base and forget the free lists.
            self.next = region.base();
            self.free = [0; CLASSES];
        }
        let head = NonNull::new(self.free[class] as *mut u8)
            .filter(|head| (head.as_ptr() as usize).is_multiple_of(layout.align()));
        if let Some(head) = head {
            // SAFETY: `head` is a freed block of this class, which holds the next link.
            self.free[class] = unsafe { ptr::read_unaligned(head.as_ptr().cast::<usize>()) };
            self.live += 1;
            return Some(head);
        }
        let start = self.next.checked_next_multiple_of(layout.align())?;
        let end = start.checked_add(block)?;
        if !region.reserve(end) {
            return None;
        }
        let block = NonNull::new(start as *mut u8)?;
        self.next = end;
        self.high_water = self.high_water.max(end);
        self.live += 1;
        Some(block)
    }

    /// Takes back a block.
    ///
    /// # Safety
    /// `block` must come from [`Heap::alloc`] (or [`Heap::realloc`]) on this heap
    /// with this `layout`, and must not be used again.
    pub unsafe fn dealloc(&mut self, block: NonNull<u8>, layout: Layout) {
        let Some((class, _)) = class_of(layout) else {
            return;
        };
        // SAFETY: the block is at least 16 bytes and no longer in use.
        unsafe { ptr::write_unaligned(block.as_ptr().cast::<usize>(), self.free[class]) };
        self.free[class] = block.as_ptr() as usize;
        self.live = self.live.saturating_sub(1);
    }

    /// Resizes a block, in place when its block size already fits or it is the top block.
    ///
    /// # Safety
    /// As for [`Heap::dealloc`]; `new_size` rounded up to `layout.align()` must not overflow.
    pub unsafe fn realloc(
        &mut self,
        block: NonNull<u8>,
        layout: Layout,
        new_size: usize,
        region: &mut impl Region,
    ) -> Option<NonNull<u8>> {
        let new_layout = Layout::from_size_align(new_size, layout.align()).ok()?;
        let (old_class, old_block) = class_of(layout)?;
        let (new_class, new_block) = class_of(new_layout)?;
        if new_class == old_class {
            return Some(block);
        }
        let start = block.as_ptr() as usize;
        if start + old_block == self.next {
            // The top block grows or shrinks where it is.
            let end = start.checked_add(new_block)?;
            if !region.reserve(end) {
                return None;
            }
            self.next = end;
            self.high_water = self.high_water.max(end);
            return Some(block);
        }
        // SAFETY: as documented for `alloc`.
        let moved = unsafe { self.alloc(new_layout, region) }?;
        // SAFETY: both blocks are live and distinct, and each holds at least this much.
        unsafe {
            ptr::copy_nonoverlapping(block.as_ptr(), moved.as_ptr(), layout.size().min(new_size))
        };
        // SAFETY: the caller hands the old block over.
        unsafe { self.dealloc(block, layout) };
        Some(moved)
    }
}
