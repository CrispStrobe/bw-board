# Opt-in wired timer to PIC IRQ0

2026-09-08. The experimental Harris board now has a programmable, pin-clocked
counter-0 subset connected to the [PIC](HARRIS-286-PIC.md). Owned guest code
programs timer ports, waits with HLT, receives repeated IRQ0 interrupts, sends
EOI and returns through IRET. This is not a complete 8254, PC/AT or wired DOS
boot result. Everything remains default-off; no application pin, GUI/schema,
deployment or media-distribution changes.

## Construction and physical signal path

```js
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';

const pic = new Harris8259Adapter({enabled: true});
const timer = new Harris8254Adapter({enabled: true});
const board = createHarrisMemoryBoard({
    enabled: true, intrEnabled: true, ioEnabled: true,
    interruptDevice: pic, timerDevice: timer,
    timerClockHalfPeriod: 8, rom, romLowAlias: true
});
```

Register the existing bus-memory models before construction. The timer option
requires the programmable PIC/I/O path; overlapping timer/PIC port ranges fail
at construction. The timer adapter includes a decoder and byte-lane bridge;
it is **not a bare 8254 electrical pin model**.

`timer_clock.clk` connects to `pit.clk0`; `timer_inputs.gate0` connects to GATE;
`pit.out0` replaces the laboratory IR0 source wire into the PIC. IR1–IR7 remain
laboratory inputs. Latched address/byte-lane nets and controller RD/WR strobes
carry guest I/O. No interrupt/vector callback bypasses these nets.

The ideal clock divider advances once per board system-clock period, not per
instruction or peripheral-settle call. It toggles every `timerClockHalfPeriod`
periods, giving one timer tick per twice that number. The default is 8; tests
use 2. This is a configurable synchronous laboratory clock ratio, **not a
claim of the PC's 1.193182 MHz crystal frequency, analog timing, or CPU real-time
performance**. A future independently scheduled oscillator can replace its
CLK wire through `editWires`.

Clocking continues through CPU READY waits and HLT when the caller continues
`cpu.stepClock()`. `cpu.run()` still returns on HLT; it does not automatically
idle until a timer event. GATE can be driven with
`board.circuit.drive('timer_inputs', {gate0: 0})`. Reset clears the divider,
pending writes, count and configuration. This is an adapter/lab reset, not
a physical 8254 RESET terminal. Breaking CLK, GATE, OUT, command or required
data wiring cannot silently substitute an interrupt or count value.

## Programming subset

Default range: `40h..43h`, relocatable to a four-port-aligned `portBase`.
Counter 0 is at `40h` (low lane); control is `43h` (high lane).

```asm
MOV AL,36h       ; counter 0, LSB then MSB, binary mode 3
OUT 43h,AL
MOV AX,128       ; small laboratory divisor, not the BIOS tick rate
OUT 40h,AL
MOV AL,AH
OUT 40h,AL
```

Program the timer before PIC initialization in these fixtures, so setting
the initial OUT level does not become an unintended initial IRQ. Install the
IVT and stack, program the PIC, unmask IRQ0 and enable IF before waiting.

Supported subset: binary counter 0, LSB/MSB access, mode 0 terminal count,
mode 2 rate generation, mode 3 with even divisors, count latch and two-byte
readout. Zero means 65536. The initial count loads on a separate falling CLK
edge. Mode 2 preserves a full low interval; even mode 3 decrements by two and
toggles each half-period. GATE is sampled at rising CLK; periodic modes also
force OUT high on low GATE and reload following a trigger. Exact gate/clock
coincidence behavior is not a hardware-conformance claim.

Each write commits once at WR release. Read data and byte-selection side
effects occur once per RD assertion, including during stretched commands.
An explicit count latch preserves both bytes while the timer continues.
Unlatched reads can naturally span different count values.

Explicit refusals: channels 1/2, read-back/status commands, modes 1/4/5 and mode
aliases, BCD, single-byte access modes, odd mode-3 divisors, mode-2 divisor 1,
active two-lane transfers, and a second count write without a fresh control
word. Live count replacement must be implemented/tested before that guard is
relaxed. Odd word CPU I/O is already split into byte transactions, so the
adapter cannot infer the original width or undo an earlier byte. Mode 0 stops
the modeled count at terminal zero; post-terminal wraparound readback is not
implemented. No snapshots, nanosecond timing, metastability or complete
power-on-silicon behavior are claimed.

## Why this does not wrap the existing timer core

The production `src/i8254.js` remains unchanged. Its mode-2 `_tick()` emits
low and high through callbacks within the same update, leaving its final OUT
high. Sampling that final value through circuit nets would lose the pulse.
Its immediate count load and odd square-wave timing also do not supply this
adapter's chosen clock-edge contract. The new, separately gated subset keeps
physical output intervals visible without changing production behavior or
pretending the broader core's register coverage proves pin-level coverage.
Do not promote or replace that core based solely on these tests.

## Evidence and remaining gates

Final targeted run: **264/264 passed, zero skips**, including unchanged
production PIC/PIT regressions. No full CI or browser acceptance was run.

Sixteen owned tests in `test/harris-timer.test.mjs` cover explicit opt-in/range
guards, independent divider/reset behavior, literal mode-2 waveform/count
expectations, even mode-3 divisors, zero count encoding, gate operation,
delayed count writes, latched/stretched reads, refusals and broken nets.
Wired guest tests cover repeated mode-2/3 IRQ0/EOI/IRET, HLT, clocks and output
edges during READY stalls, mask/unmask through guest I/O, and external GATE.
These are implementation regressions, not a silicon oracle.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs
```

CPU/SST adapter/runner hashes remain those of
[SST286-INTR-REPORT.json](SST286-INTR-REPORT.json), whose full run had
1,477,997 passes, three revocations and zero failures/unsupported/budget exits.
No new full-vector run is claimed; those vectors do not grade this timer,
board wiring or asynchronous interrupts.

Primary reference: [Intel 8254 datasheet, September 1993, 231164-005](https://www.scs.stanford.edu/23wi-cs212/pintos/specs/8254.pdf),
control format, read operations, modes 0/2/3 and gate-operation sections.
The adapter's unsupported modes and laboratory policies remain limitations,
even where the reference describes complete hardware behavior.

The [conventional/text RAM increment](HARRIS-286-MEMORY-MAP.md) now removes
the 64 KiB memory ceiling and records the existing BIOS's remaining peripheral
requirements. Next probe BIOS POST and implement the verified configuration,
video/PPI and storage gaps toward a minimal wired DOS boot.
Broader guest compatibility also needs the guarded
timer modes/reloads/channels and PIC features; full 286 coverage still needs
protected mode, faults/debug/shutdown and timing/board acceptance.
