# Owned code32 REP page-fault restart checkpoint

The [owned MIT guest](../test/fixtures/i80386-free-code32-rep-pf.S) runs in a 32-bit protected code and stack segment with 4 KiB paging. It executes address32/data32 `REP STOSL` from `EDI=0x4ff8`, `ECX=4`. Two elements commit, the third faults at linear `0x5000`, and the guest handler installs the missing PTE, reloads CR3, discards the 32-bit error word, and executes `IRETD`. The resumed instruction commits the remaining two elements once each. This extends the separate [historical code16 REP/PF/PIT gate](I80386-NATIVE-REP-PF-PIT-ACTUAL-BOARD.md); it is not a new native CPU3 result.

The actual [JavaScript board capture](receipts/2026-10-07-i80386-code32-rep-pf-js.json.gz) was generated at source `b950d610a93b7b6fed8d30465d00a5d79e129cda` using the source-bound runner. It records 86 attempts, 85 completed steps, one vector-14 fault with error 2 and CR2 `0x5000`, and a 16-byte same-privilege frame containing error 2, restart EIP `0x1d6`, CS 8 and EFLAGS `0x10046`. At delivery, `ECX=2`, `EDI=0x5000`, `ESI=0`, and the prior eight destination bytes are already committed. The faulting element writes no destination byte. The five REP attempts have `(ECX, EDI, completed)` values `(4,4ff8,1)`, `(3,4ffc,1)`, `(2,5000,0)`, `(2,5000,1)`, `(1,5004,1)`. Final destination bytes are four copies of `44 33 22 11`, and the guest emits `P32OK` after reading them back.

The capture includes the recorded CPU registers, descriptor-cache fields and all configured board-chip state at each attempt, ordered observed byte effects, the delivery frame and ten complete 4 KiB physical pages at delivery and settlement. Its validator independently replays every observed physical write into a fresh ROM/zero-RAM backing, checks the whole-RAM hash and all selected final pages, and rejects missing effects and corrupted frames. The final settled board has zero device debt. The capture gzip is 25,405 bytes, SHA-256 `25bd0e1cb0d7762793e166ef6dca2e2e27ba0789f4424863909cd0b5dbb22b6e`.

The [independent QEMU receipt](receipts/2026-10-07-i80386-code32-rep-pf-qemu.json) uses the same ROM SHA-256 `1f21482dca1cb71e5442946a3f83a6a258ef206ce4bbcd8de51b97e353e17c45`. QEMU 8.2.2, binary SHA-256 `28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5`, ran with a 486 CPU model and TCG. Its raw exception record reports one vector-14 error-2 fault at CS:IP `8:1d6`, CR2 `0x5000`, `ECX=2`, `EDI=0x5000` and `ESI=0`; the real debug-port terminal output is `P32OK`. The receipt records the bounded emulator configuration and raw fault state. It does not expose QEMU's complete internal pages or board state, and a 486 model does not establish exact 386DX behavior. The earlier pinned Bochs CPU3 code16 capture remains separate evidence.

Reproduce the two captures from a clean checkout with GNU binutils, Node and the explicitly recorded QEMU build:

```sh
node --test test/i80386-code32-rep-pf.test.mjs
node scripts/run-i80386-code32-rep-pf-js.mjs /new/js-capture.json.gz
node scripts/run-i80386-code32-rep-pf-qemu.mjs /new/qemu-receipt.json /path/to/pinned/qemu-system-i386
```

This finite fixture covers same-CPL32 fault and restart with IF clear. It does not exercise privilege switching, VM86, TSS/task delivery, IRQ during paging, a guest OS, a native CPU3 code32 path or physical timing.
