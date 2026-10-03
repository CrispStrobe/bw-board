# Fixed real-mode RAM bootstrap and off-page SMC — source preparation

This separate profile is a correctness stepping stone for RAM-loaded code. The
qualified cold-BIOS DSO cannot be reused: its initializer, config, execute-page
and fetch guards pin the old BIOS and ROM-only execution. A fresh native build
and distinct artifact admission are required. Nothing here is native execution,
performance qualification, protected-mode support, OS boot or adoption.

The deterministic 64 KiB ROM far-jumps from reset to a fixed bootstrap, sets
DS=0 with IF=0, and writes an eight-byte program to ordinary RAM page 0x7000
before page admission. RAM executes MOV AX,1 and far-jumps to ROM 0x40. ROM
compares AX with 1, patches the executed immediate at 0x7001 to word 2 from ROM
0x45, then far-jumps back. RAM executes MOV AX,2 and returns to ROM; JNE reaches
0x50. The future driver stops at that ordinary boundary before HLT. Named AX1
and AX2 cuts share 0000:7003 and are distinguished by actual AX and chronology.
The 512 N/Q values are maximum caps, not measured execution counts.

Exact hash-bound derivatives reuse the existing page/generation tables,
ordinary pending-write publication, executed-alias stamp and prefetch
invalidation. Current RAM instruction ownership is restored. Writes are only
four exact bootstrap stores at their ROM PCs and one two-byte patch at ROM
0x45; the existing current-code and admitted-unexecuted-code refusals remain.
RAM admission authenticates all 4096 backing bytes and generation 4 or 5;
fetch authenticates each source-owned instruction byte and current generation.
Unknown pages, addresses, operands, phases, generations or instruction domains
are refused. No PIO, IRQ delivery, fault, paging, MMIO, disk or A20 transition is
admitted. The fixed private provider takes no caller ROM/config/hooks.

`provider-derivation.mjs` preserves the original clock-tape/lease implementation
through exact replacement counts and inverse proof. It emits owned source;
the asynchronous source-only factory resolves only its fixed source imports.
This is not an addon admission API. The unsupported exported source board is
for diagnostics only. Host page admission cannot prove that native execution
has occurred: that distinction is enforced by the retained C executed-page
guard and must be witnessed in the eventual native trace.

The source plan binds the complete inherited cold closure plus this profile,
ROM bytes, generated runtime/provider/NAPI hashes and ABI 4. It explicitly
refuses to represent the old addon as this new profile. A preparation
materializer, exact config and build-receipt admission, reviewed hosted build,
fresh dynamic Bochs-reset JS oracle and native correctness driver remain the
next slice. That driver must retain reset/final/native 166 words, actual resume
metadata, dynamic JS architectural counterparts, named ordinary cuts, full
board/RAM hash, complete empty PIO and write/generation/cache-publication
chronology. No tiny-fixture blanket reset allowances or RAM normalization is
appropriate. Full native store/coherence effects require actual native proof.

Controls cover the exact ROM encodings and destinations, instruction domains,
fixed provider write/page/PIO/cap refusals, pinned derivations/inverses, source
plan identity and a tiny nonguest C helper extracted from the generated real
fetch/write/page-admission policy. They do not run a 386 guest or build Bochs.
