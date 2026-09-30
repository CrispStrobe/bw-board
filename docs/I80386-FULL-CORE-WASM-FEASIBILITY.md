# Full functional 386 core in WebAssembly: bounded feasibility note

**Status:** the proposed WebAssembly backend remains a source audit only. No
WASM backend, backend guest run, or backend speed measurement is claimed. A
separate [owned native Bochs checkpoint](I80386-BOCHS-CPU3-OWNED-ORACLE.md)
has now run. This is a possible opt-in functional 386 backend alongside
the current JavaScript 386. The existing wired 8086 and 286 are different,
lower CPU models; there is no wired 386 backend. A trace opportunity gate does
not measure the proposed backend's cost or correctness.

The locally pinned [Bochs `REL_2_7_FINAL` CPU-level-3 build](I80386-REFERENCE-EMULATORS.md#first-bochs-386-mode-witness)
is a concrete strict-386 source candidate. The published native Bochs
receipts establish selected output markers, not a full CPU-state checkpoint
or ordered bus oracle. The pinned
[`cpu.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.cc)
uses Bochs memory and PC-system services, event ticks, and exception control
flow; its CPU source is not a standalone board-neutral module. The current
board directly constructs the JavaScript CPU with physical memory and port
callbacks in `src/experimental/i80386-at-machine.js`. A WASM adapter would
need a bounded instruction entry point and matching fetch, read, write, port,
reset, interrupt, NMI, halt, exception, A20, and device-event boundaries.
Visible and hidden segment state, control and task registers, flags, CPU
cycles, page translation effects, and ordered I/O must be exposed for
differential reports. The experimental 386 board currently rejects its
legacy checkpoint/save-state API, so this proposal assumes selection at
reset, not a mid-run CPU swap.

Strict CPU-level-3 Bochs cannot qualify the **unmodified stock xv6 image**:
the pinned kernel's [boot](https://github.com/mit-pdos/xv6-public/blob/eeb7b415dbcb12cc362d0783e41c3d1f44066b17/entry.S)
and [secondary-CPU](https://github.com/mit-pdos/xv6-public/blob/eeb7b415dbcb12cc362d0783e41c3d1f44066b17/entryother.S)
entry code executes MOV CR4 to enable PSE, and
[`main.c`](https://github.com/mit-pdos/xv6-public/blob/eeb7b415dbcb12cc362d0783e41c3d1f44066b17/main.c)
uses 4 MiB bootstrap PDEs. In pinned Bochs,
[`MOV CR4`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/crregs.cc)
is guarded by `BX_CPU_LEVEL >= 5`. The board's JavaScript CPU deliberately
accepts CR4.PSE as a later compatibility extension, and its synthetic APIC
surface serves the stock SMP-capable guest on one CPU. A full-core stock xv6
experiment would need a clearly labeled later CPU mode with CR4/PSE support;
alternatively, a separately labeled 4 KiB-bootstrap guest port could test a
strict 386. Neither is the existing stock xv6 acceptance result.

The [MAME i386 source](https://github.com/mamedev/mame/blob/master/src/devices/cpu/i386/i386.cpp)
is another C++ reference, but derives from MAME CPU and virtual-TLB services
and imports the emulator framework. [ThreeAteSix](https://github.com/andrewjc/threeatesix)
is a work-in-progress Go interpreter, not a C/C++ WASM source. These are
architecture and oracle leads, not measured faster replacements. Bochs CPU
files carry LGPL notices; the cited MAME i386 file carries BSD-3-Clause while
the larger framework has its own terms. Any code reuse needs an exact-file
dependency and provenance review.

A falsifiable first experiment would compile one pinned core behind a small
physical-bus ABI, boot the vendored free AT BIOS from reset, and add native
Bochs instrumentation for a full CPU checkpoint and ordered memory/port events
at an owned 386 fixture boundary. Compare those new records with the WASM
candidate and existing JavaScript core; the existing output-marker receipts
cannot stand in for them. Stop at a fixed instruction/event boundary and
report the first divergence. Only a separately labeled CR4/PSE-capable
configuration should then attempt the
unmodified 4 MiB stock xv6 shell and `forktest` with the same ROM and disk
copies, serial stop, final CPU state, RAM/disk hashes, and configured board
cycles. After parity, serial same-host user-CPU pairs could test speed. A
failure to preserve board event/fault order or to reach the first owned
checkpoint would reject this adapter before a full guest benchmark.

The first [owned native CPU3 instrumentation checkpoint](I80386-BOCHS-CPU3-OWNED-ORACLE.md)
now exists. It captures integer/system CPU state and an ordered Bochs hook
stream, but exposes raw CR0/debug-register setup differences from the current
JavaScript fixture and does not yet capture memory values, TSS RAM or a
complete physical bus. It is a prerequisite result, not the full differential
gate described above.
