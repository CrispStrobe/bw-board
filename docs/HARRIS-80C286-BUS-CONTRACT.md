# Harris 80C286: sourced contract and phase sequencer subset

2026-09-08. Experimental, default-off. This implements bus sequencing, not CPU
instructions, and does not claim a complete hardware-timed 286 component.

Later opt-in extension: [NMI qualification and wired delivery](HARRIS-286-NMI.md).
Default construction still refuses active NMI, and INTR acknowledgement remains
unsupported. The original subset limitations below describe that default path.

Follow-up: the [latched memory bridge](HARRIS-80C286-LATCHED-MEMORY.md) connects
this sequencer to external latch/controller components and the existing
RAM/ROM behavioral models. It adds write-edge integration without claiming a
full 82C288, electrical edge timing or instruction execution. The original
sequencer-only scope and verification below remain historical receipts.

## Primary source and selected device

Selected device: Harris CS80C286-12, PLCC-68, component-side view. Source:
[80C286 datasheet, August 1996, file 2947.2](https://datasheets.chipdb.org/Harris/80c286.pdf).
Downloaded PDF SHA-256:
`19c1f3e3e56a872135c70f6739c9db532cef87768d67196a0e490cbdba151672`.
No copy of the copyrighted PDF is vendored. Pin facts and logic tables are
transcribed into independently written code; no third-party emulator is used.

| Contract | Source location (one-based PDF / printed page) |
|---|---|
| Variant/package; component-side PLCC pin map | 1 / 3-67; 3 / 3-69 |
| Status encoding and A0/BHE byte lanes | 4 / 3-70 |
| READY polarity; HOLD and interrupt/extension interfaces | 5 / 3-71 |
| Reset duration, pin levels and initialization interval | 6 / 3-72 |
| Reset instruction address and architectural register values | 14 / 3-80 |
| System clock versus processor clock | 26 / 3-92, Figure 20 |
| TS/TC states and pipelined address limitation | 27 / 3-93 |
| Repeated TC, write-data start/hold/release | 29 / 3-95 |
| Major timing waveform | 44 / 3-110, Figure 35 |

The timing waveform was inspected visually as well as reading extracted text;
overbars and diagram alignment must not be inferred from OCR alone. The pin
map records NC and repeated supply pins rather than inventing signal names.

## Implemented code

- [Pin/status/transfer contract](../src/experimental/harris-80c286-contract.js):
  PLCC mapping, complete status decoder, memory/code/I/O transfer plans.
- [Bus sequencer](../src/experimental/harris-80c286-bus.js): reset qualification,
  initialization, TS/TC phases, waits, selected-lane samples and write hold.
- [Tests](../test/harris-80c286-bus.test.mjs): independent status truth table,
  selected pin assertions, net-connected transfers and negative cases.

Signal values are electrical logic levels, not booleans meaning asserted.
`_n` denotes an active-low function. In particular `ready_n: 0` accepts a
transfer, unlike the older synthetic lab's active-high READY abstraction.

## Phase API and scheduling contract

Call `beginClock(readPin)`, drive its returned outputs onto the circuit, resolve
the connected devices, then call `endClock(readPin)`. Each pair represents ONE
complete system CLK period. Two periods form a processor/bus state. The read
function supplies resolved pin levels, never an architectural memory callback.
All time is explicit; no timers or background execution are started.

The minimal transfer follows `TS1 -> TS2 -> TC1 -> TC2`. READY and selected data
are sampled at the modeled end of TC2. Inactive READY repeats TC1/TC2. The
status pins are passive in TC; a real controller must remember the preceding
status. The model's full-period output driving is an abstraction of the primary
timing diagram, not a reproduction of its within-period transitions or AC
setup/hold constraints. There is deliberately no advertised clock-edge stepping.

Write data starts in TS2, persists through waits and stays driven for one more
modeled system period after acceptance. The sequencer reports accepted
transfers but does not write RAM itself. External memory/controller circuitry
must implement the actual write pulse and its commit edge. Unselected data
lanes are high-Z by model policy; unused-lane silicon values are not validated.

Odd words generate two distinct transfers: high lane at the odd address, then
low lane at the following address. Operand reconstruction preserves little
endian order. I/O addresses are limited to 16 bits; physical memory addresses
are 24 bits. Address wrap is refused pending CPU-level fault/wrap semantics.
The planner must not be used to bypass segmentation/protection checks later.

## Reset: requirements versus approximations

The model requires 17 completed RESET-high periods: the pin description says
more than 16, while the reset waveform gives an at-least-16 annotation. The
conservative supported sequence is 17. RESET clears pending transfers and
drives the specified reset logic levels. A fresh assertion after a fault must
qualify afresh; earlier pulses cannot be accumulated into a valid reset.

After release, the model spends exactly 50 system periods in initialization.
This is a deterministic choice based on the source's APPROXIMATE interval,
not a claim that physical silicon always fetches on an exact clock. Logical
reset outputs are applied immediately; transient reset propagation and
asynchronous phase synchronization are outside this subset.

No first fetch is automatically invented: the future CPU must request code
from physical `0xFFFFF0`. Tests explicitly submit this fetch to a net-connected,
owned ROM. The returned far-jump bytes are checked, not executed. Architectural
register initialization and hidden CS base belong to the future CPU core.

## Explicit limitations and failures

- Non-pipelined address output: retained through TC. Early next-address output,
  ALE, external latches and a real 82C288 model remain open gates.
- No CPU decoder, prefetch queue, protected mode, instruction timing or OS boot.
- No HOLD/HLDA handoff, LOCK cycles, interrupt-acknowledge sequence or
  coprocessor protocol. Active requests on unsupported input pins fail rather
  than being silently accepted. Halt/shutdown are decoded but not sequenced.
- Inactive inputs must be wired; floating data/READY at their sample point
  fail. READY is not read in phases where this subset does not sample it.
- The finite wait limit is a host safety diagnostic, not a hardware timeout.
  A fault requires RESET; changing READY alone cannot resume stale work.
- Trace storage is bounded and reports dropped periods. It records modeled
  drives and accepted data, not every electrical net transition.
- No snapshots, live circuit editing, production registration, parts-library
  promotion, browser UI integration or engine-pin changes.
- The older electrical RAM/ROM models remain unchanged. The test ROM's OE is
  explicitly driven by its test peer; this does not validate an 82C288 bridge.

## Verification and next gate

Local final-source run: 22 new bus-contract/sequencer tests, plus the existing
digital foundation, electrical memory and 8086 machine tests: 63 passed,
zero failures/skips. Syntax, local-link and whitespace checks passed. Full
engine CI, hardware differential traces and browser integration were not run.

```sh
node --test test/harris-80c286-bus.test.mjs test/digital-circuit-lab.test.mjs test/bus-memory.test.mjs test/i8086-machine.test.mjs
```

Next: implement and validate latched address/control plus external write-edge
memory behavior, then connect a resumable instruction subset. Primary-source
contract coverage is still partial M0/M1; this is not the minimal CPU board
(M2). Keep the experimental modules out of production exports until circuit,
CPU, debugger and UI integration evidence supports promotion.
