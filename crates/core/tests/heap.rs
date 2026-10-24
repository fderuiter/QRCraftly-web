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

//! Host tests for the module allocator (#1611): memory freed while another
//! block stays live is reused, blocks never overlap, and alignment holds.

use core::alloc::Layout;
use qrcraftly_core::heap::{Heap, Region};

/// A fixed buffer standing in for linear memory; `reserved` plays memory.grow.
struct Buffer {
    memory: Vec<u64>,
    reserved: usize,
}

impl Buffer {
    fn new(bytes: usize) -> Self {
        Self {
            memory: vec![0; bytes / 8],
            reserved: 0,
        }
    }
}

impl Region for Buffer {
    fn base(&self) -> usize {
        self.memory.as_ptr() as usize
    }

    fn reserve(&mut self, end: usize) -> bool {
        let limit = self.base() + self.memory.len() * 8;
        if end > limit {
            return false;
        }
        self.reserved = self.reserved.max(end - self.base());
        true
    }
}

struct Rng(u32);

impl Rng {
    fn below(&mut self, n: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 % n
    }
}

/// A live block filled with its own tag, so an overlap shows up as a wrong byte.
struct Block {
    ptr: *mut u8,
    layout: Layout,
    tag: u8,
}

fn take(heap: &mut Heap, region: &mut Buffer, size: usize, align: usize, tag: u8) -> Block {
    let layout = Layout::from_size_align(size, align).unwrap();
    // SAFETY: the buffer is used by this heap only.
    let ptr = unsafe { heap.alloc(layout, region) };
    assert!(!ptr.is_null(), "out of memory at {size} bytes");
    assert_eq!(ptr as usize % align, 0, "misaligned");
    // SAFETY: the block is live and `size` bytes long.
    unsafe { ptr.write_bytes(tag, size) };
    Block { ptr, layout, tag }
}

fn give(heap: &mut Heap, block: Block) {
    // SAFETY: the block is live and `layout.size()` bytes long.
    let bytes = unsafe { core::slice::from_raw_parts(block.ptr, block.layout.size()) };
    assert!(
        bytes.iter().all(|&b| b == block.tag),
        "block {} was overwritten",
        block.tag
    );
    // SAFETY: the block came from this heap with this layout.
    unsafe { heap.dealloc(block.ptr, block.layout) };
}

#[test]
fn a_long_lived_block_does_not_pin_the_memory_freed_around_it() {
    let mut region = Buffer::new(64 << 20);
    let mut heap = Heap::new();
    // The decoder handle: allocated first and kept for the whole run.
    let handle = take(&mut heap, &mut region, 400, 8, 0xAA);
    let mut rng = Rng(1611);
    let mut after_100 = 0;
    for frame in 0..10_000u32 {
        // One frame: its text, a parsed copy and a CBOR buffer, then all freed.
        let text = take(&mut heap, &mut region, 60 + rng.below(1_500) as usize, 1, 1);
        let parsed = take(&mut heap, &mut region, 16 + rng.below(800) as usize, 8, 2);
        let cbor = take(&mut heap, &mut region, 40 + rng.below(1_200) as usize, 1, 3);
        give(&mut heap, parsed);
        give(&mut heap, text);
        give(&mut heap, cbor);
        if frame == 99 {
            after_100 = heap.high_water(&region);
        }
    }
    let after_10k = heap.high_water(&region);
    // Three blocks of at most 2 KiB each class: the heap settles, it does not grow per frame.
    assert!(after_10k <= 16 << 10, "high water {after_10k} bytes");
    assert!(
        after_10k <= after_100 * 2,
        "{after_100} after 100 frames, {after_10k} after 10,000"
    );
    assert_eq!(heap.live(), 1);
    give(&mut heap, handle);
}

#[test]
fn random_alloc_free_and_realloc_never_overlap() {
    let mut region = Buffer::new(64 << 20);
    let mut heap = Heap::new();
    let mut rng = Rng(7);
    let mut live: Vec<Block> = Vec::new();
    for step in 0..20_000u32 {
        match rng.below(5) {
            0..=2 => {
                let size = 1 + rng.below(if step % 50 == 0 { 70_000 } else { 600 }) as usize;
                let align = 1 << rng.below(7);
                live.push(take(
                    &mut heap,
                    &mut region,
                    size,
                    align,
                    (step % 251) as u8 + 1,
                ));
            }
            3 if !live.is_empty() => {
                let at = rng.below(live.len() as u32) as usize;
                give(&mut heap, live.swap_remove(at));
            }
            _ if !live.is_empty() => {
                let at = rng.below(live.len() as u32) as usize;
                let block = &mut live[at];
                let old = block.layout.size();
                let new_size = 1 + rng.below(3_000) as usize;
                // SAFETY: the block is live and came from this heap with this layout.
                let ptr = unsafe { heap.realloc(block.ptr, block.layout, new_size, &mut region) };
                assert!(!ptr.is_null());
                assert_eq!(ptr as usize % block.layout.align(), 0);
                // SAFETY: the resized block holds `new_size` bytes; the kept prefix is checked.
                let kept = unsafe { core::slice::from_raw_parts(ptr, old.min(new_size)) };
                assert!(kept.iter().all(|&b| b == block.tag), "realloc lost data");
                // SAFETY: as above.
                unsafe { ptr.write_bytes(block.tag, new_size) };
                block.ptr = ptr;
                block.layout = Layout::from_size_align(new_size, block.layout.align()).unwrap();
            }
            _ => {}
        }
    }
    for block in live {
        give(&mut heap, block);
    }
    assert_eq!(heap.live(), 0);
}

#[test]
fn freeing_everything_rewinds_to_the_base() {
    let mut region = Buffer::new(1 << 20);
    let mut heap = Heap::new();
    let first = take(&mut heap, &mut region, 100, 8, 1);
    let at = first.ptr;
    let second = take(&mut heap, &mut region, 5_000, 16, 2);
    give(&mut heap, second);
    give(&mut heap, first);
    let again = take(&mut heap, &mut region, 3_000, 8, 3);
    assert_eq!(again.ptr, at);
    give(&mut heap, again);
}

#[test]
fn out_of_memory_returns_null() {
    let mut region = Buffer::new(1 << 16);
    let mut heap = Heap::new();
    let layout = Layout::from_size_align(1 << 17, 8).unwrap();
    // SAFETY: the buffer is used by this heap only.
    assert!(unsafe { heap.alloc(layout, &mut region) }.is_null());
    let huge = Layout::from_size_align(isize::MAX as usize, 1).unwrap();
    // SAFETY: as above.
    assert!(unsafe { heap.alloc(huge, &mut region) }.is_null());
    assert_eq!(heap.live(), 0);
}
