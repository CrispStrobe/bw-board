# Harris phase board: latched address/control and memory write edges

2026-09-08. Default-off experimental integration; no instruction CPU or editor
component is shipped. Builds on the [phase sequencer](HARRIS-80C286-BUS-CONTRACT.md).

## What changed

[Memory board](../src/experimental/harris-80c286-memory-board.js) now connects
the sequencer through an external controller, address/control latch, decoder
and byte-wide ROM/RAM banks. There is no direct CPU-to-memory callback.

[Bridge components](../src/experimental/latched-memory-components.js) provide:

- An ideal transparent latch. ALE high follows inputs; ALE low retains the
  address, BHE and memory/I/O selection. All latch inputs must validate before
  capture; floating ALE is an error.
- A status-driven phase controller. It observes resolved CPU status pins,
  remembers the command through passive TC status, and generates ALE/read/write
  commands. It never reads CPU private state or completion callbacks.
- A digital adapter for the existing registered `62256` and `28c256` models
  from [bus-memory.js](../src/devices/bus-memory.js). Their storage, turnaround,
  pending-write and trailing-edge update behavior is reused unchanged.
- Bounded memory settling with bank preflight before commit. State is previewed
  independently; storage is copied on a possible write edge so a fault in a
  later bank cannot partially commit an earlier bank's pending write.

Memory defaults are ROM at `FF0000-FFFFFF`, RAM at `000000-00FFFF`, with two
32K byte banks each. Physical address bits A1-A15 address the banks; A0/BHE
select the byte lanes. ROM is configured read-only, not silently writable RAM.

## Scheduling and observable behavior

Each system-clock period has this order:

1. Drive CPU outputs and settle nets.
2. Observe status with the external controller; drive ALE and memory commands.
3. Update the latch from its connected inputs; settle memory behavior/drivers.
4. Sample CPU/controller READY, rejecting disagreement, then sample CPU data.
5. Release a completed memory command and settle again. The write-command
   trailing edge is what makes the reused memory model commit pending storage.

ALE is modeled high in TS2 and memory commands active in TC. These are
full-period phase abstractions, not exact 82C288 edge timing. The grounding
reference remains the pinned Harris datasheet, printed pages 3-93, 3-95 and
3-110; see the parent contract for provenance and checksum. A real 82C288 part,
its CMDLY/arbitration modes and AC timings are not implemented here.

The sequencer still does not generate pipelined addresses. Tests perturb its
CPU-side address during TC and prove the downstream latch retains the current
access. This validates the latch boundary, not full pipelined CPU behavior.

RESET releases controller commands. If a write pulse was already active with
valid pending data, that trailing edge commits it. CPU cancellation does not
undo external hardware effects. Conversely, a pulse still held active through
waits does not commit repeatedly. ROM ignores writes in read-only mode: the
CPU does not magically receive a ROM-protection exception.

## Ideal-digital adapter boundary

This bridge translates known digital inputs to 0/5 V for the existing models
and converts their output drives back to logic levels. It does not invoke the
analog solver or reproduce output resistance, supply current, propagation,
metastability or setup/hold constraints. Connected VCC/GND must be valid;
missing power is not replaced with the older model's voltage fallback.

Address/select values are don't-cares only while both memory commands are
inactive. During an access they must resolve correctly. Data is required on
selected writes; read data is supplied solely by connected memory outputs.
Controller READY and CPU READY must agree at the completion sample.

The adapter intentionally depends on the existing memory model's private
update-state contract. It is restricted to those two registered kinds and
covered by behavioral tests. Do not generalize it to arbitrary registered
devices or promise compatibility across untested model changes.

Memory preflight prevents partial bank commits, not rollback of all components.
A late board fault can occur after CPU sampling. The board is then faulted and
requires reconstruction; it cannot silently continue from inconsistent state.
Reads from unmapped memory float. Unmapped writes can complete with no device
responding if READY is tied active, as on this simplified board; software must
verify its result. Do not imply the CPU detects every wiring mistake itself.

## Reproduce and inspect

Verification: 16 new integration tests; final targeted run including the bus
sequencer, digital foundation, electrical memory and 8086 machine tests passed
79 tests, zero failures/skips. Demo, syntax and whitespace checks passed.
Full engine CI, hardware differential traces and browser/editor tests were not
run for this isolated milestone.

```sh
node --test test/harris-80c286-memory-board.test.mjs
node scripts/run-harris-memory-board.mjs --experimental
```

The standalone demo registers the memory models, initializes the phase board,
reads two owned ROM operands, adds them in host JavaScript, waits, and writes
the sum through the latch/controller/memory path. It verifies `0x68ac` and
reports zero writes before the edge, one after, and `cpuExecuted:false`.

The [tests](../test/harris-80c286-memory-board.test.mjs) cover byte and split-word
transfers, waits, latching, disconnected wires, conflicting data, power, READY
mismatch, partial-commit prevention, reset during a write and read-only ROM.
An independent test drives the reused memory's write edge without any CPU or
CPU acceptance callback, demonstrating where the storage change originates.

## Remaining scope

No full 82C288/74xx models, analog integration, transceiver timing, DMA/HOLD,
interrupts, I/O devices, instruction decode, prefetch, protected mode, snapshots,
live rewiring or browser/editor UI integration. Existing production memory
models and defaults are unchanged; no exports, registry defaults or consuming
application pin are promoted. The host must register memory models explicitly.

Next: connect a resumable, explicitly limited instruction core to this board
and execute owned boot bytes through the wires. That will be the first actual
CPU execution milestone; it must not be confused with this host-driven bus test.
