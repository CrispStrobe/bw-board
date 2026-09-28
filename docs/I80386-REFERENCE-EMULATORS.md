# 80386 reference emulators: performance and oracle roles

The experimental Brickwright 386 is a JavaScript instruction interpreter behind
an AT device adapter. Its optional WebAssembly blocks cover a subset of
instructions, and the interpreter still handles exits and board events. On the
fixed xv6 `forktest` run, 24,338,279 guest steps took a median 25.16 user-CPU
seconds in ordinary mode and 18.21 seconds with opt-in native byte blocks on
the four-vCPU KVM VPS. Both reached the same serial output, RAM SHA-256 and
configured board-cycle count. See the [receipt](receipts/2026-09-28-x86-vps-throughput.json).
The six-cycle instruction charge is device scheduling, not 386DX timing; these
figures cannot be compared to an emulator's guest-MHz display as physical RTx.

No same-host, same-firmware, same-disk, same-stop-condition benchmark has been
run against the projects below. Their published features do not prove that each
is faster on our xv6 or Windows workload. There are nevertheless concrete
techniques and independent-behavior checks worth using:

| Engine | Relevant mechanism | Role here |
| --- | --- | --- |
| [QEMU TCG](https://www.qemu.org/docs/master/devel/tcg.html) | Translates guest basic blocks to host code; records mode-dependent state in block keys, chains blocks, and invalidates code when needed. KVM is a separate hardware-assisted mode. | Architecture model for a much larger functional fast path; existing VM-task fixture runs under QEMU 8.2.2 TCG as a **486**, so use it only for overlapping 386 behavior. |
| [Bochs](https://bochs.sourceforge.io/How%20the%20Bochs%20works%20under%20the%20hood%202nd%20edition.pdf) | Portable C++ interpreter with decoded trace caching and code-write invalidation, without requiring a host JIT. | Independent 386-mode VM86 task-switch oracle now established for one owned fixture; expand to detailed checkpoints. |
| [MAME i386 core](https://github.com/mamedev/mame/blob/master/src/devices/cpu/i386/i386.cpp) | C++ interpreter with opcode-handler tables, cycle budgets and a virtual TLB. Its i386 core is not evidence that all MAME CPU cores use a dynarec. | Second 386-specific oracle, especially for descriptors, faults, task switches and instruction timing tables. |
| [PCem](https://github.com/sarah-walker-pcem/pcem) / [86Box](https://github.com/86Box/86Box) | Interpreted and dynamic-recompiler 386 paths, with full PC devices. | System compatibility comparison with matched ROM/media; run their interpreter modes for easier instruction-level divergence. |
| [ThreeAteSix](https://github.com/andrewjc/threeatesix) | Educational Go 386 interpreter: `CpuCore.Step()` calls a per-instruction decoder and handler table. Its README calls it work in progress. | Readable independent implementation; use as an oracle only for instructions and machine modes it actually passes. No speed ranking is established. |

Our current profile puts most sampled host cost in `_stepInstruction`,
`step`, `_translate` and `_read386`. The path to a large speedup is therefore
to keep decoded work and translated addresses across safe instruction runs and
amortize device scheduling over bounded blocks. QEMU's state-keyed blocks and
Bochs' traces are useful designs. For our functional AT, block exits must still
honor IRQ/event deadlines, page and descriptor changes, exceptions, self-modified
code, port I/O and MMIO. The actual-net Harris board must continue to resolve
its bus phases and edited wiring; a functional block engine cannot silently
replace those semantics. One recent local same-page write-translation candidate
is being measured separately and is not a claimed 10× result.

## Oracle expansion

1. Keep physical [SingleStepTests 80386](https://github.com/SingleStepTests/80386)
   captures as real-mode register/RAM evidence. They come from a 386EX and do
   not certify protected mode or 386DX cycle timing. Keep our pinned PCjs
   comparisons and existing [QEMU VM-task witness](I80386-EXPERIMENTAL.md)
   as separate software opinions.
2. Expand the pinned Bochs CPU-level-3 fixture and pin a MAME revision/build,
   then run small owned bootable protected-mode fixtures on each. Capture the same checkpoint
   boundary: mode, GPRs, EIP/EFLAGS, CR0/CR2/CR3, segment visible and hidden
   state, descriptor/TSS memory, exception vector/error code and selected RAM
   page hashes. A divergence is triaged against the Intel 386 manual; agreement
  between two emulators is evidence, not proof.
3. Start with cases that exercise our current risk: page-crossing writes and
   fault rollback, task gate/NT IRET, VM86 entry/return, A20/ROM aliases, and
   Windows enhanced-mode I/O faults. Use a tiny serial or I/O checkpoint so
   each engine can stop at the same guest event. Record binary, config, ROM,
   disk and tool hashes; do not publish third-party or private media bytes.
4. Benchmark speed only after matching firmware, media, host, guest stop event,
   cache/JIT mode and displayed frame/audio settings. Report wall time and
   actual host CPU. Never infer original 386DX RTx from our six-cycle charge.

## Reuse boundaries

Brickwright is MIT licensed. [MAME's i386 source](https://github.com/mamedev/mame/blob/master/src/devices/cpu/i386/i386.cpp)
is marked BSD-3-Clause, although MAME as a whole is GPL-2.0-or-later; audit
each file and dependency before copying code and keep attribution. [Bochs](https://github.com/bochs-emu/Bochs)
is LGPL-2.1; [PCem](https://github.com/sarah-walker-pcem/pcem) is GPL-2.0 and
[86Box](https://github.com/86Box/86Box) is GPL-2.0-or-later. They can all be
run as independent tools; their source cannot simply be pasted into an
MIT-only implementation. [ThreeAteSix's README](https://github.com/andrewjc/threeatesix)
states MIT, but the inspected `6c5bb6ec` checkout has no root license file;
verify permission and provenance before copying. Design ideas and black-box
behavioral comparisons do not require code reuse.

## First Bochs 386-mode witness

The Ubuntu Bochs 2.7 package on the VPS was compiled without an `i386` model,
so it cannot act as an original-386-mode reference. A separate build of the
upstream `REL_2_7_FINAL` tag (`0e45b736ef9792eb9b752b0a35db49eaf2faea47`)
with `--enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger
--enable-all-optimizations` does expose a CPU-level-3 implementation. The
[owned fixture](../test/fixtures/i80386-vm-task.S) boots as a floppy under its
BIOS, enters VM86 through a TSS, visits a protected IDT task-gate handler,
returns by NT IRET and emits `BHV` on port E9. The
[oracle runner](../scripts/compare-bochs-i80386-task-vm86.mjs) compares that
event with the local 386 executor, pins the Bochs source revision and build
configuration, and records executable, ROM and image hashes. It stops Bochs
on the first `BHV` because the fixture's port-F4 exit is specific to QEMU.
Bochs can subsequently reset when a timer interrupt reaches the fixture's
intentional VM86 idle loop; that later state is outside this checkpoint and
is preserved in the receipt log rather than presented as a clean whole-OS run.
The [receipt](receipts/2026-09-28-i80386-bochs-vm-task.json) records the
accepted event; an owned result mutation is rejected. This is one bounded
software-oracle witness, not a complete original-386 qualification.

To reproduce it, build the pinned Bochs source with those configure flags,
then run `BOCHS_386_ROOT=/path/to/Bochs node
scripts/compare-bochs-i80386-task-vm86.mjs` from a clean board checkout.
The Bochs build is external; no Bochs executable or guest disk is committed.
