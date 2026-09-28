# 80386 dynamic-memory slow-exit contract spike

This is an opt-in, standalone experiment. The ordinary 386 AT machine and its
existing native dispatcher do not call it. It tests whether a WASM block can
follow a data-dependent address without predicting that address or admitting a
static data window during decode.

`src/experimental/i80386-dynamic-memory-spike.js` decodes only flat protected-32
`MOV r32,[base]` and `MOV [base],r32` with two-byte ModR/M forms. It proves the
current CS code page and exact bytes, checks the AT event horizon, and mirrors
individual translations that the JS CPU has **already** cached. It never calls
`_translate`. The 64-slot WASM TLB tags each entry with linear page, translation
generation, CR3, CR4, user permission, writable and dirty state, and a separate
store-admission bit. A cached translation alone is insufficient: the physical
page must be ordinary kind-1 RAM above 1 MiB, inside the shared RAM capacity,
and safe to access wholly within one page. A write to a clean page exits so the
JS CPU can set the paging D bit. The host refuses stores to tracked page-table
pages and to every code page registered in this spike's block cache, including
the currently executing page. A future dispatcher must register **all** its
cached code pages before it can use this writer.

Before each native call, the host rechecks only the entries actually mirrored
into WASM, removing entries if the JS TLB line, generation, CR3/CR4, RAM kind,
page-table status, or code-page status changed. Registering a code page updates
store admission immediately. A guest/host page-table write that invalidates the
JS translation cache is observed before the next native call. There is no
concurrent guest execution during a WASM call. This conservative scan is
**O(mirrored entries) per call**, up to 64, and has not been shown to be a
speed path. It avoids copying the full 512-entry JS TLB at every call but does
not yet hook TLB fills for automatic mirroring.

The WASM runner checks the current effective address after all prior native
instructions. On a missing, cross-page, permission-failing, unclean, ROM, or
device access, or a store to tracked code/page-table RAM, it returns the count
of already completed instructions and exits **before** the faultable instruction.
The caller copies
that committed state back to the CPU and lets the ordinary `machine.step()`
execute the next instruction. JS remains responsible for page walks, A/D writes,
MMIO, exceptions, and fault delivery. The contract supports dependent accesses
to different cached pages; an individual access that crosses a page still exits.

Build the checked-in module with Clang/LLD 18:

```sh
clang --target=wasm32 -O3 -Wall -Wextra -Werror -nostdlib \
  -fuse-ld=/usr/bin/wasm-ld -Wl,--no-entry -Wl,--export-all \
  -Wl,--export-memory -Wl,--import-memory -Wl,--global-base=16779264 \
  -Wl,--initial-memory=16908288 -Wl,--max-memory=16908288 \
  -o wasm/i80386-dynamic-memory-spike.wasm \
  src/experimental/i80386-dynamic-memory-spike.c
node --test test/i80386-dynamic-memory-spike.test.mjs
```

The eleven focused differential tests include a three-instruction
store→load→dependent-load, a second-page miss and #PF after the first load
commits, clean D-bit fallback, code/page-table write refusal, cross-page and
MMIO exits, CR3/generation staleness, and a chip-deadline exit. A bounded
128-call two-load workload matches 256 ordinary 386 steps and the complete
4 MiB RAM hash. This is a correctness proof for the narrow contract, not a
benchmark or an xv6 speed claim. Integration still needs a producer that
mirrors relevant cached translations without expensive per-entry scanning,
registers all code pages, and preserves the existing native dispatcher's
interrupt and chip scheduling gates. Full xv6 and Windows guest/RAM parity and
paired user-CPU A/B are required before a performance claim or default change.
