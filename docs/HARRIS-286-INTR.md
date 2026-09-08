# Opt-in wired real-mode INTR integration

2026-09-08. This joins the [INTA sequencer](HARRIS-286-INTA.md) to the
experimental CPU, controller and external interrupt-device connector. It is
not a complete 8259/82C288 implementation or acceptance of a DOS-capable board.
The default path remains off; application pins and saved-profile schemas are
unchanged.

## Signal path

An external device drives INTR and the low eight data nets. The bus samples
INTR; the CPU selects it at an eligible instruction boundary and submits the
paired acknowledgement transaction. The controller observes bus status and
emits `inta_n`. Only after the second acknowledgement completes does the CPU
push FLAGS/CS/IP and read the selected IDTR entry. No CPU vector callback is
used. Changing the peer's vector selects a different guest handler in tests.

Controller `inta_wait` feeds an independent ideal-digital READY OR gate alongside
the external wait input. CPU and controller read the same resolved READY net.
The first TC of each acknowledgement is extended. Memory read/write strobes
and ALE remain inactive during acknowledgement; the address latch retains its
previous value rather than attempting to capture floating cascade addresses.
Disconnecting READY or a vector data wire fails explicitly.

The CPU checks IF and STI/SS blocking, prioritizes an eligible NMI, wakes from
HLT, and can suspend REP after a completed element. It preserves the remaining
count/indices and saves the first-prefix IP. INTR is level-sensitive: a dropped
request is not retained, while a held request can be selected again after IRET
restores IF. Delivery count/vector are exposed by `inspect().intr`.

## Connector

```js
createHarrisMemoryBoard({
    enabled: true, intrEnabled: true,
    rom, romLowAlias: true,
    interruptDevice // optional external part; missing vector wiring must fail
});
```

`interruptDevice.part()` returns a digital part with input pins `reset` and
`inta_n`, and output pins `intr`, `d0` through `d7`. `update(read)` returns its
pin drives, using only those resolved inputs and its own peripheral state. It
is called around controller transitions; it must tolerate repeated calls and
use signal edges, not call counts, for state changes. It receives no CPU object,
instruction state, transaction index or acceptance callback.

When supplied, this part replaces the lab `inputs.intr` connection. Without
it, the lab INTR input remains usable, but no hidden vector provider is added.
The connector does not yet expose PIC command/data ports, cascade wiring, a
timer or the existing 8259 implementation.

## Evidence and qualification

Final targeted run: **176/176 tests passed, zero skips**. Full pinned SST286
rerun: **1,477,997 passes**, zero failures/unsupported/budget, three upstream
revocations, exit 0. The [hashed receipt](SST286-INTR-REPORT.json) records the
new CPU source; it does not grade asynchronous inputs or the physical board.
No full CI or browser acceptance was run.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs
```

Twelve new owned tests in `test/harris-intr.test.mjs` use an independent lab
peer, **not an emulated PIC**. The peer detects two physical INTA pulses and
drives only D0–D7 during the second. Tests cover IF masking, STI/CLI, MOV/POP SS,
HLT/IRET, simultaneous NMI priority, changing vectors, held requests, READY
delays, inactive memory strobes, disconnected wires, REP resume/write counts
and invalid IDT limits.

Primary references:

- [Harris 80C286 datasheet](https://datasheets.chipdb.org/Harris/80c286.pdf),
  August 1996, 2947.2, INTR/NMI and INTA sections; its existing checksum is in
  `harris-80c286-contract.js`.
- [Intel 80286 Hardware Reference Manual](https://bitsavers.trailing-edge.com/components/intel/80286/210760-002_80286_Hardware_Reference_Manual_1987.pdf),
  1987, interrupt handling in section 3; downloaded SHA-256
  `d3ece037a200b17ef32d78a055d0d96c3e47474d755d94569b9576a9a68c6915`.

Four observed high system-clock periods qualify INTR in this model. This is a
conservative digital policy, not exact synchronizer latency. The STI shadow
and asynchronous corner cases have owned tests but no new silicon oracle;
the real-mode SST suite supplies no interrupt inputs. Mid-acknowledgement
priority changes, debug/trap arbitration, complete halt/shutdown/reset behavior,
protected mode and analog/edge timing remain unvalidated or unsupported.

## Next

Add port strobes and a real PIC adapter, then programmable PIC/timer guest
tests. Connect storage/BIOS/memory-map prerequisites before claiming a wired
286 DOS boot. No merge, deployment, GUI promotion or new guest-media hosting
is included in this increment.
