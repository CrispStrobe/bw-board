# Wired boot subset: addressing, arithmetic and guest loops

2026-09-08. Experimental extension of the [boot executor](HARRIS-80C286-BOOT-CPU.md).
No general 286, instruction timing, protected mode or editor integration claim.

## New behavior

Word MOV, ADD and CMP now accept all 16-bit ModR/M register/address encodings
in both directions. Effective addresses wrap to 16 bits; operands crossing the
segment end remain refused. BP-based forms use SS by default, direct disp16
uses DS, and displacement bytes are sign-extended. No segment override prefix
or segment-register load was added. Nonzero SS is injected only as test initial
state when checking default-segment selection on the wired board.

Register INC/DEC preserve carry. CMP updates flags without storing a result.
Short JE/JNE, short/near JMP and LOOP permit guest control flow. LOOP decrements
CX modulo 65536 without changing flags, including the zero-to-FFFF case. Branch
targets outside the supported code-fetch range fail explicitly; this is not a
complete architectural wrap/fault model.

Memory-destination ADD is an explicit read followed by a wired write. Its flags
and retirement commit only after the write completes. It is not a locked bus
transaction; LOCK prefixes, DMA/arbitration and interruptible restart semantics
remain unsupported.

## Owned workload

[loop.asm](../test/fixtures/harris-boot/loop.asm) fills four words at 0500h with
1, 2, 3 and 4, reads them back and sums them using a loop, compares the sum in
guest code, and writes 10 to 0510h on success. Its alternate branch writes
DEADh. The program then halts. The successful path retires 47 instructions,
including the reset far jump. Tests deliberately change the expected sum to
11 and verify the guest really takes the failure path (48 instructions).

The embedded ROM bytes are regenerated/checked against the owned assembly
using the existing assembler. The original straight-line ROM is retained.

```sh
node scripts/run-harris-boot-cpu.mjs --experimental --loop
node --test test/harris-80c286-loop-cpu.test.mjs
```

## Verification design

Final local targeted run passed 107/107 tests, zero failures/skips, including
13 new addressing/loop tests and the retained boot, bus, memory and 8086
machine regressions. The standalone loop demo passed with 47 retired
instructions and RAM result 10. Syntax, documentation links and whitespace
checks passed. Full engine CI, hardware traces and browser/editor integration
tests were not run for this isolated milestone.

- Successful and failing ROM executions agree with the separately implemented
  existing 8086 decoder on common-subset results and instruction counts.
- A decoder-only unit checks all 256 ModR/M bytes; this is explicitly not a
  circuit or 286 hardware conformance result. Representative indexed, direct,
  displaced, register and SS-based accesses are tested on the real phase board.
- Word subtraction/comparison flags have an independent arithmetic oracle.
- Tests cover taken/untaken branches, backward loops, INC/DEC carry preservation,
  zero LOOP count, budget exhaustion/cancellation, and bounded instruction history.
- Delayed ModR/M stores and read-modify-write operations must not advance
  architectural state or duplicate external writes while READY is inactive.

The initial run exposed two missing direction encodings emitted by the
assembler (01h ADD and 39h CMP). Both are implemented and covered, rather than
forcing test programs to use only one encoding. Unsupported ADC and prefixes
remain negative cases; the old straight-line tests are retained.

## Still outside scope

No byte arithmetic/memory forms, general ALU groups, stack/calls/returns,
segment loads, string instructions, architectural exceptions, interrupt delivery,
prefetch, protected mode, full controller/transceiver timing, snapshots or
Circuit Editor UI integration. CPU bus phases are modeled, but instruction
execution costs are not; this is not a speed comparison against real hardware.

Production defaults, exports and application pins remain unchanged. The subsequent
[saved profile and debugger session](HARRIS-80C286-CIRCUIT-SESSION.md) adds an
engine-only integration seam; application controls remain a next gate. Continue
explicit instruction coverage and fault validation; this is not a complete 286
merely because a richer ROM now runs.
