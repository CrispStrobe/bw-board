# Circuit-first 286: initial digital bus foundation

2026-09-08. Experimental engine milestone; not a shipped 80286 CPU.

## Implemented

`src/experimental/digital-circuit.js` provides ideal four-state digital net
resolution using Circuit Editor's existing `parts` / `wires` endpoint shape.
Parts declare pins and outputs. Pure combinational evaluation sees a common
snapshot and settles in bounded delta passes. Diagnostics distinguish floating,
unknown, contention (with named drivers), and non-convergent networks.

`src/experimental/wired-bus-lab.js` connects a synthetic 24-bit-address,
16-bit-data master to explicit low/high byte-wide ROM and RAM banks and decode
parts. Reads use the resolved data nets. Writes validate selected banks and
data before committing once, after an abstract READY handshake. Wait, completion
and fault records carry integer ticks in bounded trace storage with a dropped
count. Cancellation abandons pending writes and releases master data drives.

Both entry points require `enabled: true`. Neither module is added to production
exports, device registration, the CPU factory or application pins/defaults.
There is no editor-visible 286 part in this milestone.

## Reproduce

```sh
node --test test/digital-circuit-lab.test.mjs
node scripts/run-wired-bus-lab.mjs --experimental
```

The demo reads two operands from wired ROM, adds them **in host JavaScript**,
waits, writes their sum through wired RAM and verifies `0x68ac`. It explicitly
reports `cpuExecuted: false`. This is a circuit-boundary test, not boot firmware
execution and not a speed benchmark.

Tests cover all 256 byte values in both lanes; aligned words; explicit manual
split-byte transfers; disconnected data/select/READY wires; shorted lanes;
floating, unknown and conflicting drivers; unmapped and read-only writes;
no partial word commit on invalid wiring; wait timeout and cancellation;
deterministic ordering; bounded trace; and default-off/argument guards.

## Fidelity and limitations

Controls `rd`, `wr`, `low`, `high` and READY are abstract active-high handshakes.
They are NOT 286 status signals or an 82C288 implementation. Ticks are explicit
synthetic-master steps, not hardware clock periods. No instruction execution,
prefetch, reset sequencer, protected mode, I/O space, interrupt acknowledge,
HOLD/HLDA, LOCK, propagation delays, analog solver integration or snapshots is
implemented. Odd word transfers are refused until the caller splits them.

Memory commits occur at synthetic transaction completion, not at the SRAM
model's hardware write-pulse edge. Existing electrical models in
`src/devices/bus-memory.js` remain unchanged; the experiment does not claim to
replace them. A later bridge must validate the write-edge/settling contract
before the models can share a CPU bus sequencer.

Topology is fixed per constructed instance; there is no live rewiring API.
Source-level wire fixtures demonstrate causal connectivity but do not prove
editor persistence, package-pin mapping or browser UI integration. Netlist
shape compatibility does not imply a complete arbitrary-component compiler.

## Next gates

1. Select and pin the Harris 80C286 datasheet revision/package; transcribe
   source-backed reset, phase, READY and byte-lane contracts with page citations.
2. Define the bridge to existing circuit/parts models and clock scheduling;
   add gate/transceiver fixtures and full selected-device bus-event traces.
3. Evaluate a reusable core's ability to suspend at external bus interactions,
   or implement a resumable native subset. Do not fabricate bus events after
   instruction execution.
4. Replace the synthetic master with the validated sequencer and real owned
   boot program before claiming the minimal 286 board milestone.

The detailed application plan is on the paired `brickwright-lite`
`feat/x86-backend-lab` branch in `docs/I80286-CIRCUIT-PLAN.md` and
`docs/I80286-CIRCUIT-ARCHITECTURE.md`. This foundation is a partial M1, not M0
sign-off or M2 completion. No merge or deployment is implied.
