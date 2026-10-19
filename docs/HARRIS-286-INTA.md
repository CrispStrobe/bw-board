# Opt-in 286 interrupt-acknowledge sequencer foundation

Follow-up: [wired CPU/controller integration](HARRIS-286-INTR.md) now uses this
pair through a separate interrupt-device connector. The original foundation's
CPU/controller limitations below are historical; full PIC/cascade support
remains pending, and default construction stays off.

2026-09-08. Bus-only increment. It does **not** yet let the wired instruction
CPU service INTR. The memory-board controller still refuses acknowledgement
commands; the CPU's maskable-interrupt selection and PIC wiring remain pending.

## Source and modeled contract

Primary reference: [Harris 80C286 datasheet](https://datasheets.chipdb.org/Harris/80c286.pdf),
August 1996, file 2947.2, printed pages 3-71, 3-95–96 and 3-98–101.
Its existing checksum is in `harris-80c286-contract.js`.

The sequence has two INTA cycles. First-cycle data is ignored; the second
supplies an eight-bit vector on D0–D7. Three idle processor clocks separate
them. External READY logic must extend the second cycle by a TC state; a wait
on the first is recommended for the PIC. LOCK is active through the first TC
of each cycle, independently of waits. Address outputs are released for
cascade use and recovered during the second operation.

The implementation retains the existing **non-pipelined system-clock-phase**
model. It releases address/BHE outputs through the first TC of cycle two,
restores them for the extended TC, and uses six idle system-clock periods.
Restored address zero is deterministic model policy, not a meaningful INTA
address. Exact within-period edges, MCE/cascade drivers, controller timing and
electrical settling are not certified by these tests. HOLD still refuses.

## API and isolation

```js
const bus = new Harris80C286Bus({enabled: true, intrEnabled: true});
// After reset/initialization and when the bus is idle:
bus.submit({kind: 'interrupt-acknowledge'});
```

`intrEnabled` defaults false. It enables this transaction and sampling of the
resolved INTR input level. That level is observable as `intrLevel` but does
not automatically submit a transaction: interrupt selection belongs to the
CPU. The capability `interruptAcknowledge` reports the opt-in, while general
`interrupts` remains false.

One submitted transaction owns both cycles and the intervening gap; other
transactions cannot interleave. Completion records expose `ackIndex` 0 and 1.
Only the second completion is `last:true`; its `operand` is the sampled vector.
First-cycle floating data is allowed and contributes no operand byte.

Failure paths remain explicit:

- Disabled INTA: `EXPERIMENT_DISABLED`.
- Invalid address/width/value for this addressless byte operation: validation error.
- No external wait on cycle two: `INTA_WAIT_REQUIRED`, not an invented READY wait.
- Missing or contended vector input: resolved-net error, not a fabricated vector.
- RESET: clears the pending pair, idle gap and observed INTR state.

## Evidence

Final targeted regression: **164/164 passed, zero skips**, including wired
bus/memory/CPU, NMI, Paterson routines, DOS persistence and reader/admission tests:

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs
```

Five new tests in `test/harris-80c286-bus.test.mjs` use the existing independent
peer connected by actual digital nets. They cover transaction validation and
gating, ignored first data, accepted second data, vector changes during waits,
the six-period gap, address/BHE release, LOCK phases, missing READY/vector,
and RESET between acknowledgements. They do not run a real 8259 or 82C288.

The CPU, SST adapter and runner are unchanged and their hashes were verified
against `SST286-NMI-REPORT.json`. The previous 1,477,997-pass vector receipt
remains applicable to those sources. **No new full-vector run is claimed**;
that suite does not exercise this physical sequencer.

## Next integration gates

1. Extend the opt-in controller with acknowledgement outputs and external wait
   logic, without activating memory strobes for an acknowledgement.
2. Connect a separate interrupt source/PIC through vector data nets and prove
   missing wires, extra waits and changing requests affect execution.
3. CPU IF/STI/SS-shadow selection, NMI priority, INTR HLT wake and REP restart.
4. Programmed PIC/timer/device guests and actual DOS boot on the wired 286.

No application pin/default changes, GUI controls, full CI/browser acceptance,
merge, deployment or media distribution accompanies this foundation.
