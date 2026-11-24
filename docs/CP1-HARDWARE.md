# Kosmos CP1 / CP3 hardware model

The CP1 engine executes a user-supplied 2 KiB 8049 ROM on the independent
MCS-48 core. Its external bus reaches modeled 8155 devices. The keypad,
display, program cells, and external ports are observations of that hardware;
there is no second interpreter substituting for firmware execution.

## Authorship and sources

`i8155.js`, `cp1-machine.js`, `cp1-adapter.js`, and `cp1-rom-profiles.js` were
written independently for this implementation. Their author did not inspect
GPL CP1 emulator source, the asig or lambdamikel implementations, or any
historical emulator implementation of the 8155. No third-party device code was
copied or adapted. All committed test ROMs are short programs authored for the
tests. Historical firmware bytes are not included.

The hardware references are:

1. **Intel, MCS-48 Family User's Manual**, July 1978: CPU and 8155 descriptions,
   particularly the 8155 section, printed pages 6-82 through 6-88.
   [Original Intel manual scan](https://bitsavers.trailing-edge.com/components/intel/8048/9800270D_MCS-48_Family_Users_Manual_Jul78.pdf).
   The original Intel text for the timer and port sections was also consulted
   through the page transcriptions at
   [page 230](https://manualsdump.com/en/manuals/intel-mcs-48/253276/230) and
   [page 231](https://manualsdump.com/en/manuals/intel-mcs-48/253276/231).
2. **Intel, 8155H/8156H/8155H-2/8156H-2 data sheet**, manufacturer document
   231719: basic port modes, command/status, reset, ALE, and timer commands.
   [Intel data sheet scan](https://pccomponents.com/datasheets/INTEL-P8155H-2.pdf).
3. **KOSMOS Computer-Praxis**, first edition, Franckh, 1983. The schematic on
   printed page 137, figure 109, was visually inspected at full size and with
   the keyboard-to-CPU traces enlarged. It establishes the base machine's
   transistor polarity, grounded keypad pull-downs, crossed column routing,
   display segment wiring, fixed separator, and unconnected timer pins.
   [Manual](https://manualzz.com/doc/62077556/kosmos-cp1-benutzerhandbuch).
4. **Kosmos CP3 manual**, expansion connections and port assignment.
   [Manual and schematic](https://www.manualslib.de/manual/643552/Kosmos-Cp-3.html?page=7).
   The CP3 wiring facts supplied in the implementation brief were used for
   the second chip; the headless tests verify those explicit connections.

ROM names and SHA-1 identities are identification metadata supplied with the
task. They are not firmware implementations, compatibility patches, or grants
of permission to distribute a ROM. SHA-1 is used only as an identity key.

## CPU and external bus

The crystal defaults to 6 MHz. One 8049 machine cycle is 15 oscillator periods,
so the default machine-cycle rate is 400,000 per second. The CPU has its own
128 bytes of internal RAM. See [MCS48-IMPLEMENTATION.md](MCS48-IMPLEMENTATION.md)
for the instruction implementation and its timing boundary.

The 8049 P2 latch controls the external chips:

| P2 bit | Connection | Meaning |
| --- | --- | --- |
| 7 | Both 8155 IO/M inputs | 0 selects RAM; 1 selects I/O registers |
| 6 | Both 8155 RESET inputs | 1 asserts reset |
| 5 | CP3 chip enable | 0 selects the expansion chip |
| 4 | Base chip enable | 0 selects the base chip |
| 3..0 | Keypad columns | Released CPU pins sample active-high contacts |

ALE captures the address, IO/M, and chip select in **each** chip. A later P2
change does not replace that captured selection. An external write reaches
every selected device. With both devices selected, reads that disagree report
`busContentionMask`; the deterministic digital fallback is a bitwise AND. That
fallback describes the simulator's conflict policy, not an analog promise
about two opposed TTL outputs. No selected chip reads as `0xff`.

Useful P2 values with keypad bits released are `0x2f` / `0xaf` for base RAM /
I/O, `0x1f` / `0x9f` for CP3 RAM / I/O, and `0x0f` / `0x8f` for both. `0x3f` /
`0xbf` deselect both chips. CPU reset puts P2 at `0xff`, asserting peripheral
reset while deselecting both chips.

## RAM and the 8155

Each 8155 owns 256 bytes. CP1 cell `n` stores its opcode at byte `2*n` and its
operand at byte `2*n+1`. Cells 0–127 reside in the base chip. With CP3 installed,
cells 128–255 reside in the second chip. All public cell operations reject
out-of-range addresses rather than wrapping into another cell or chip.

The 8155 basic input/output modes, command/status, latched bus, and timer
control are modeled. Input writes cannot preload an output latch; entering
input mode clears the corresponding latch. PC is six bits. Hardware reset
clears port control and output latches and stops the timer, while preserving
RAM and the timer's stored count/mode. Power-on RAM is unspecified on hardware;
`powerCycle()` deliberately chooses zero, or a caller-supplied fill byte, for
reproducible simulation.

### Explicit 8155 limits

The generic strobed/handshake port alternatives are unsupported. Selecting
either raises `Unsupported8155ModeError` before mutation. CP1 and CP3 use
basic ports.

`clockTimer(pulses)` provides explicit TIMER IN edges for standalone peripheral
tests. The functional model supports single/continuous square waves,
single/continuous terminal pulses, odd-count high/low division, STOP, STOP
AFTER TERMINAL COUNT, queued START, and clear-on-read terminal status. Timer
reads at I/O addresses 4 and 5 expose **remaining input pulses**, with the mode
bits in the upper byte. They do **not** reproduce Intel's internal
phase/decrement-by-two readback encoding. This limit is also present in
`Intel8155.capabilities.timerCountReadback`.

On the original CP1 schematic, 8155 TIMER IN and TIMER OUT are unconnected.
The machine therefore supplies no invented 8155 clock. The firmware's display
interrupts come from the 8049 timer. The generic count-readback limitation does
not alter that CP1 clock path.

## Keypad and display

PC0–PC5 drive active-low PNP digit selection. Each enabled driver supplies a
high common row to its display digit and, for PC0–PC4, its keypad contacts.
The four keypad columns have **1 kΩ pull-downs**. An idle column is low; a
pressed contact on an enabled row makes it high. The schematic's four traces
cross their visual order on the way to CPU pins 21–24. Following the entire
trace gives this electrical map:

| Selected row | P2.0 | P2.1 | P2.2 | P2.3 |
| --- | --- | --- | --- | --- |
| PC0 | CAS | CLR | PC | ACC |
| PC1 | CAL | STEP | STP | RUN |
| PC2 | 8 | 9 | OUT | INP |
| PC3 | 4 | 5 | 6 | 7 |
| PC4 | 0 | 1 | 2 | 3 |
| PC5 | — | — | — | — |

There are twenty logical contacts. Numeric buttons have physical duplicates
wired in parallel. `setKey(key, pressed, contact)` accepts contact 0 or 1 for
digits and keeps their closures independent. Releasing one duplicate does not
release the other. Simultaneously pressed contacts combine electrically in the
selected rows. Contact bounce and analog matrix ghost paths are not modeled.

Both `IN A,P2` and the firmware's `MOVD A,P4` route sample those actual contact
states. There is no 8243 chip on the CP1 and no synthetic expander keyboard.

Base PA0–PA6 drive segments a–g, active high. PA7 is unconnected. The decimal
separator is separately tied through its resistor to ground, so it lights
whenever hardware digit 3 is enabled. Hardware digit 5 has a separate supply
overvoltage indicator; it is not a CPU decimal-point output and is not modeled
as a programmable segment.

`getDisplay()` reports left-to-right `digits`, `rawDigits`, `duty`, and
`activeDigits`, ordered hardware PC5 through PC0. Thus the fixed separator is
bit 7 of visible `digits[2]`. The corresponding `hardware*` fields retain
PC0-through-PC5 indexing. Duty is measured over simulated cycles, in a sliding
window that defaults to 40 ms, independent of render frequency. `rawDigits`
are the instantaneous drives. `digits` are a rendering convenience: a segment
is visible when its duty reaches 20% of that digit's brightest segment and at
least 0.2% of the observation window. Consumers requiring electrical data
should use the unthresholded duty and raw masks.

## External ports

| CP1 terminal port | Device | Width | Normal firmware use |
| --- | --- | --- | --- |
| P1 | 8049 P1 | 8 | Quasi-bidirectional input/output |
| P2 | Base 8155 PB | 8 | Output |
| P3 | CP3 8155 PB | 8 | Input |
| P4 | CP3 8155 PA | 8 | Output |
| P5 | CP3 8155 PC | 6 | Output |

The external terminal named P2 is distinct from the CPU P2 control latch.
`writeCpuPort(2, value)` addresses the latter; `getPortState(2)` describes the
external PB terminals. Normal port directions come from actual firmware
commands rather than being forced by the machine.

A P1 latch bit at zero sinks low. A bit at one is released with the 8049's weak
high source and can be pulled down externally. `setPortInput(port, value,
drivenMask)` represents external drives; omitted mask means all pins are
driven. Port snapshots separate `latch`, physical digital `value`,
`drivenMask`, `externalDrivenMask`, `pullupMask` where applicable, and
`floatingMask`. An undriven CP3 input is explicitly floating and samples high
as a deterministic simulator convention. This does not invent a CP3 pull-up.

At the external circuit boundary, Board's existing generic pin policy uses
a 21.7 kΩ quasi pull-up and a 25 Ω strong-drive equivalent. These are shared
teaching-model values from `pin-model.js`, **not calibrated NMOS 8049 or 8155
current/voltage curves**. Circuit voltage and LED-current examples establish
that the pins reach the solver; they do not claim transistor-level drive
accuracy for the historical chips. The CP1 connector's supply is a regulated
5 V source under the same board-level abstraction.

## Public API and ownership

```js
import { Cp1Machine } from './src/cp1-machine.js';
import { createCp1Adapter } from './src/cp1-adapter.js';

const machine = new Cp1Machine({ rom: supplied2048Bytes, expansion: true });
machine.advanceToMs(250);             // run real firmware, with an instruction budget
machine.setKey('PC', true);           // contact closure; no direct firmware command
machine.advanceCycles(40000);
machine.setKey('PC', false);
const observation = machine.snapshot();

// Cell loading changes physical RAM, independently of firmware initialization.
machine.loadProgram([{ opcode: 4, operand: 17 }, { opcode: 1, operand: 0 }]);
const cell = machine.readCell(0);     // { opcode: 4, operand: 17 }

const adapter = createCp1Adapter({ machine });
adapter.attachBoard(board);
adapter.advanceNs(16000000);
```

The caller supplies firmware; an absent or incorrectly sized ROM produces a
clear error. Unknown 2 KiB firmware is accepted and identified as unknown.
Known-ROM metadata never changes the CPU or wiring. It does not imply an
abstract CP1 instruction boundary for an unknown program.

`step()` returns consumed machine cycles. `advanceCycles()` and
`advanceToMs()` return `{cycles, instructions, reached, targetCycles}`. Each
advance has a bounded instruction budget. Whole instructions may exceed the
requested cycle target by one cycle. An unfinished budget returns
`reached: false`, allowing the caller to schedule another slice. Reset and
power cycle preserve elapsed machine time; they differ in RAM and power-on
control-state treatment.

The adapter operates the same machine object. It publishes `P1.0`–`P4.7` and,
with CP3, `P5.0`–`P5.5`, with the actual installed port set. Optional `partId`
prefixes every pin. It calls `board.advanceTo(time)` before each pin edge and
before sampling inputs at a CPU read. P1 uses mode `quasi`; enabled 8155
outputs use `pushpull`; input ports use `input`. Rendering and snapshots do not
advance time. Fractional instruction scheduling credit is retained between
small `advanceNs()` calls, so render slice size does not become an extra clock.

An attached circuit can already have elapsed time from an earlier runner.
The adapter translates machine timestamps by the positive difference between
the board clock and machine clock at attachment. Its public `timeNs()` remains
machine-relative: attaching a fresh CP1 at board time 100 ms leaves CPU time
at zero, and a subsequent 1 ms of CPU execution advances the board to 101 ms.
Reset preserves both elapsed clocks. At an explicit reset or input/advance
boundary, a board advanced by the designer while the CPU was paused is
adopted without running extra CPU cycles. Replacing the runner establishes a
new attachment offset. A host using `boardTimeBase = board.timeNs -
target.timeNs()` consequently publishes the same absolute endpoint; it does
not add elapsed CPU time twice.

CPU I/O callbacks are timestamped at the beginning of the executing
instruction, before that instruction's machine cycles are charged. This is
an instruction-boundary convention, not bus-phase timing. An observer that
timestamps the same write after a two-cycle instruction will report its edge
5 µs later at the default clock, while successive edge intervals can agree.
Power-up direction changes are real modeled events: configuring a previously
input 8155 port as output first drives its cleared latch, even if firmware
immediately writes another value.

`unloggedBoardInputs()` is true when a board's `readPin()` is sampled, since
those external values need recording for deterministic replay. A boolean-only
`readPin()` cannot communicate high impedance; undefined/null samples retain
the floating distinction. When BoardImpl topology is available, unwired pins
and isolated singleton pin nets remain released; a missing-net digital-zero
sentinel is never treated as external ground. Input samples are discarded
when their pin becomes an output, so an earlier sensed low cannot masquerade
as an opposed external driver. Cassette transport, serial emulation, calibrated analog drive
strength, propagation delays, supply faults, and the analog overvoltage
indicator are outside this implementation.

## State and verification

`snapshot()` is a detached observation. `saveState()` includes CPU state,
firmware bytes, both RAM/peripheral states, physical key closures, external
drives, bus diagnostics, cycle count, and display integration history.
`loadState()` validates the complete candidate before mutating the machine.
ROM identity and bytes, CP3 topology, crystal frequency, display-window
configuration, and wiring consistency must match. Malformed component data
cannot partially overwrite a running machine. A board and machine must be
restored together before a connected board's timeline can be rewound.

The tests in `i8155.test.mjs` and `cp1-machine.test.mjs` use self-authored ROMs
and assert bus selection, dual-chip writes, input/output latch rules, every
key contact, both keyboard instruction paths, CP3 port mapping, floating input
metadata, RAM boundaries, reset versus power cycle, time-based display duty,
fixed separator behavior, adapter edge ordering, bounded execution, and
transactional state validation. Any historical-ROM compatibility run is a
separate user-ROM integration check, not a bundled fixture.
