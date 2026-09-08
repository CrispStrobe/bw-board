# First wired instruction execution: Harris boot subset

2026-09-08. Experimental, default-off. This milestone executes instructions;
it is not a complete 80286 implementation or an editor-visible CPU part.

## Result

Owned ROM code now fetches through the high reset mapping, far-jumps into the
low ROM alias, stores two operands into wired RAM, loads and adds them, stores
`0x68ac` at RAM address `0x0504`, and halts after ten retired instructions.
The arithmetic is performed by the instruction executor, not the demo host.

The path is:

```text
resumable instruction executor -> phase bus sequencer -> resolved pins
    -> controller / address latch / decoder -> existing ROM and RAM models
```

[Executor](../src/experimental/harris-80c286-boot-cpu.js) uses a generator to
suspend at every instruction-byte fetch and data transfer. No architectural
read/write callback accesses backing memory. The board settles memory write
edges before the executor resumes and retires the guest store. Waiting on
READY does not replay register changes or duplicate stores.

## Exact implemented instruction surface

| Encoding | Supported operation |
|---|---|
| B8-BF iw | MOV word register, immediate16 |
| EA iw iw | JMP FAR ptr16:16 in this real-mode subset |
| A1 iw | MOV AX, DS:[moffs16] |
| A3 iw | MOV DS:[moffs16], AX |
| 05 iw | ADD AX, immediate16 |
| 01 /r, 03 /r | ADD r/m16,reg16 and reg16,r/m16 |
| 89 /r, 8B /r | MOV r/m16,reg16 and reg16,r/m16 |
| 39 /r, 3B /r, 3D iw | CMP word operands in both directions; CMP AX,immediate16 |
| 40-4F | INC/DEC word register; preserve CF |
| EB cb, E9 cw | Short/near relative JMP |
| 74 cb, 75 cb | JE/JNE short |
| E2 cb | LOOP short; decrement CX, preserve flags |
| 90 | NOP |
| FA | CLI |
| F4 | Stop instruction execution (HLT subset) |

ADD/CMP update CF/PF/AF/ZF/SF/OF and preserve other flags. The listed ModR/M
instructions support register operands and all 16-bit effective-address forms,
with signed disp8, disp16 and BP-based default SS selection. Byte forms,
prefixes and unlisted opcodes are host diagnostics, not silently accepted NOPs.
No invalid-opcode vector delivery is implied. Unsupported-instruction faults
can leave IP advanced by fetched bytes; there is no precise exception rollback.

HLT stops the executor. It does not yet emit the physical halt bus-status
sequence or wake on an interrupt. There is no instruction clock-cost model or
prefetch queue: only bus transfer phases advance simulated clocks. Consequently,
this must not be used as an 80286 performance or cycle-accuracy benchmark.

## Reset and ROM alias are distinct responsibilities

The executor initializes the defined reset CS/IP/flags/MSW values and uses a
hidden initial code base of `0xFF0000`, yielding first fetch `0xFFFFF0`.
After a far jump it computes the ordinary real-mode segment base. General
registers use deterministic zero initialization as model policy, not a silicon
reset guarantee. Reset provenance is in the
[source-backed bus contract](HARRIS-80C286-BUS-CONTRACT.md).

The [memory board](../src/experimental/harris-80c286-memory-board.js) now has an
explicit `romLowAlias: true` option. Its decode gates additionally select ROM
at `0xF0000-0xFFFFF`; the same byte banks serve that window and the original
high reset mapping. This option defaults to false, so existing phase-board
behavior is unchanged. It is board wiring policy, not an A20 mask or CPU
special-case memory fallback. Disabling the alias causes the owned program to
fail after its far jump, as tested.

DS/ES/SS start at zero and segment-register loads are not implemented. Word
operands crossing the segment end and instruction fetch wrapping are refused.
No protected-mode address translation, privilege checks, tasks, interrupts,
stack instructions or architectural fault delivery are implemented.

## Owned source and reproduction

- [Reset assembly](../test/fixtures/harris-boot/reset.asm), origin FFF0h.
- [Program assembly](../test/fixtures/harris-boot/program.asm), origin 0100h.
- [ROM byte generator](../src/experimental/harris-boot-rom.js).

Tests assemble both sources using the existing assembler and compare their
bytes to the embedded ROM exactly. Unused ROM bytes are FFh so wandering out
of the implemented program produces an explicit unsupported opcode. No BIOS,
OS image or third-party archival software is included.

```sh
node scripts/run-harris-boot-cpu.mjs --experimental
node --test test/harris-80c286-boot-cpu.test.mjs
```

The demo requires a halted result, exactly ten retired instructions and the
expected wired RAM sum. It reports `cpuExecuted: true` alongside the explicit
limited capabilities. The earlier host-arithmetic demos remain accurately
labeled `cpuExecuted: false` and are not retroactively CPU tests.

## Execution controls and failure policy

`initialize()` drives the board reset sequence and queues the first fetch.
`stepClock(ready_n)` advances one system-clock period; default READY is active.
`run(maxClocks)` is bounded and returns `budget-exhausted` without losing
resumable progress. It never converts a budget limit into a successful halt.
`inspect()` returns copied register/history data; it is not a restorable snapshot.
Instruction history is bounded, with an explicit dropped count.

Cancellation stops execution but does not undo external writes or pulse state.
Explicit reinitialization may end an existing write pulse; see the
[memory bridge's reset semantics](HARRIS-80C286-LATCHED-MEMORY.md). CPU/board
faults require reconstruction. No silent recovery, backend substitution or
cross-backend snapshot restore is provided.

## Validation scope and remaining work

The [addressing and loop follow-up](HARRIS-80C286-LOOPS.md) expands the current
instruction table above. The original 94-test receipt below describes the
earlier straight-line milestone, not the latest combined test count.

Final local targeted run: 15 new boot tests plus the phase board/sequencer,
digital foundation, electrical memory and existing 8086 machine tests passed
94/94, zero failures/skips. The standalone demo passed with ten instructions
retired and the expected RAM result. Syntax and whitespace checks passed.
Full engine CI, hardware differential traces and browser/editor tests were not
run for this experimental milestone.

Tests check the guest result, retirement sequence, arithmetic flags, selected
encodings, wait/resume behavior, ROM alias removal, disconnected RAM data,
bounded execution, cancellation, initialization failures and unsupported paths.
A separately implemented existing 8086 decoder agrees on this shared subset's
result and arithmetic flags; that is not a hardware-grounded 286 conformance
claim. Reset/vector differences and reserved flags are not compared as if the
two processor models were identical.

Remaining: broader real-mode execution, precise faults, prefetch and timing,
full controller/transceiver models, interrupt/bus arbitration, protected mode,
snapshots, saved-circuit compilation and Circuit Editor/browser integration.
No production factory, parts catalog, application pin, default setting or
deployment is changed by this milestone.
