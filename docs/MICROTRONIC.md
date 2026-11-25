# Busch Microtronic in Circuits

The `busch-microtronic` device runs an original implementation of the **documented
Microtronic learner instruction set** on Board's simulated timeline. Its inputs
read solved circuit voltages; its outputs drive the same resistor, LED, switch
and instrument nets as every other part. Programs can be entered as three-digit
hexadecimal words or with the panel keys, stepped, run and halted.

This page describes the default behavioral mode, which interprets learner
instructions directly. Circuits also offers an experimental **TMS1600** mode
with an independently written monitor and simulated digital peripherals.
See [the native monitor](MICROTRONIC-NATIVE.md) for its current scope.
The behavioral mode does not execute the original Busch ROM. It does not reproduce the TMS1600's internal RAM, display multiplex bus,
CD4016/CD4502 control signals, or physical 2114 address mapping. The future
native firmware work remains separate. There is no imported emulator source,
ROM dump, disassembly, or reproduced manual artwork in this implementation.

## Sources and authorship

Behavior is derived from the manufacturer's public documentation:

- [Busch Microtronic downloads](https://www.busch-modell.de/information/Microtronic-Computer.aspx).
- [Original manual part 1](https://www.busch-model.com/online/produktinfos/docs/anl2090-1.pdf):
  printed pp. 8–9 for the clock connection, p. 43 for HXDZ overflow, pp. 61–63
  for decimal arithmetic and its timing caveats, pp. 72–73 for panel operation,
  pp. 74–76 for instructions and flags, and p. 77 for hardware capacity.
- [Original block diagram](https://github.com/lambdamikel/Busch-2090/blob/master/manuals/blockschaltbild.jpg)
  and [original schematic](https://github.com/lambdamikel/Busch-2090/blob/master/manuals/microtronic.jpg).
- The four `Busch-computer_platine-*.jpg` redraws supplied with the task were
  consulted as hardware references; their artwork is not distributed here.

The 31 sparse expected vectors in
`test/fixtures/microtronic/documented-vectors.json` were authored independently
from those manual pages before the implementation was inspected. The vectors
intentionally leave undocumented behavior unconstrained.

There is a discrepancy between the original schematic and the supplied redraw
in the SRAM A4–A9 multiplexed-address ordering. Neither the three-word virtual
program representation nor the device terminals establish a physical 2114
layout. Resolve that discrepancy before implementing native SRAM bus access;
do not infer packed storage from this behavioral model.

## Electrical surface

| Terminal | Behavior |
| --- | --- |
| `IN1`…`IN4` | Input nibble weights 1, 2, 4, 8. Read high at 2.5 V above `gnd`; 33 kΩ pull-down model. |
| `OUT1`…`OUT4` | Latched DOT nibble, weights 1, 2, 4, 8. High: 5 V through 220 Ω; low: 0 V through 10 Ω. |
| `CLOCK` | Independent 1 Hz square wave. Starts low, rises at 0.5 simulated seconds, falls at 1.0 seconds. |
| `5v`, `gnd` | Self-powered system's 5 V and ground connections, 0.1 Ω modeled source resistance. |

The 220 Ω output pull-up and input pull-down values follow the supplied
schematic. The output low-state resistance, input threshold, and clock's
5 V / 1 kΩ high and 0 V / 10 Ω low source are declared teaching-model choices.
They are not transistor-level, supply-current or protection-circuit models.
The clock's LED/transistor network, raw supply rails, cassette connector,
unused display positions and special G/H experiment contacts are not modeled.

**Wire `CLOCK` to `IN4` explicitly** when using the timekeeping commands. The
device never makes that connection internally. Timekeeping counts input-4
rising transitions after `PGM 3` has set the clock. The manual documents the
required connection but not the monitor's exact sampling edge; rising-edge
sampling and a 24-hour wrap are this model's explicit choices.

## Runtime and panel API

The part accepts `params.program` and `params.instructionHz`:

```js
{
  id: 'computer', kind: 'busch-microtronic',
  params: {program: 'FD0\nFE0\nC00', instructionHz: 20},
  terminals: ['IN1', 'IN2', 'IN3', 'IN4', 'OUT1', 'OUT2', 'OUT3', 'OUT4',
    'CLOCK', '5v', 'gnd']
}
```

Programs contain 1–256 three-digit hexadecimal words separated by whitespace.
An optional two-digit address followed by `:` starts a line at that address;
`;` and `#` introduce comments. Duplicate assignments, invalid words and
addresses beyond FF are refused before a load changes any memory. Unspecified
locations contain F00 (HALT), a safe simulator initialization policy.

`instructionHz` is a simulator rate from 1 through 1000, default 20. Every
learner instruction occupies one interval at that selected rate. Board's
`_wakeNs` scheduling visits the instruction deadlines and the separate 1 Hz
clock edges. Host rendering frequency does not execute instructions.

Use `board.setDeviceControl(partId, verb, value)`:

| Verb | Value / result |
| --- | --- |
| `loadProgram` | A program string or array of 12-bit words. Validates completely, then resets the behavioral machine with that program. |
| `run` | Optional numeric address 0…255. Runs from the selected/current PC. |
| `halt` | Stops instruction execution, holding the output latch. |
| `step` | Executes one word using current solved inputs. F00 advances the PC in STEP; it holds the PC during RUN. |
| `reset` | Clears registers, output and time state; sets CARRY clear and ZERO set; retains all program words. |
| `setPc` | Numeric address 0…255; stops execution and selects the address. |
| `key` | One new keypress: `0`…`F`, `HALT`, `RUN`, `STEP`, `NEXT`, `REG`, `BKP`, `PGM`, `C/CE`, or `RESET`. |

`board.getDeviceState(partId)` exposes `program`, canonical `programSource`,
`registers`, `storage`, `pc`, `input`, `output`, `carry`, `zero`, `running`,
`error`, six-character `display`, `clockHigh`, `mode`, and `waitingForKey`.
Controls and displays must use this shared state. Circuit-file persistence
stores the canonical program, not a second interpreter or a live execution
checkpoint. Persisting an equal canonical program back to the part params
does not reset registers or restart the machine.
Structural Build edits use the existing circuit netlist reconstruction and
reset device execution state. Halt before rewiring; the saved program remains,
but the PC, working registers and running state do not survive that rebuild.

Panel entry follows the documented main workflows. `HALT`, `NEXT`, two address
digits selects a program address. Three word digits commit only on `NEXT`.
`C/CE` first removes the last digit; a second consecutive press sets the edit to
000, which NEXT can store or new digits can replace.
`HALT`, `REG`, one register digit selects a register for editing. `BKP` accepts
a two-digit breakpoint; 00 disables it. A breakpoint stops before execution,
and RUN resumes past that stop once.

`PGM 3` accepts HHMM and starts timekeeping; `PGM 4` shows HHMMSS; `PGM 5` fills
program words with 000; `PGM 6` fills them with F01. Other historical built-in
programs, including the original PGM 0 self-test, report that they are not
implemented. The separate authored loopback tests are not a claim that the
original self-test ROM was executed. The simplified panel shows the current
program word after reset; the original monitor initially shows `00 000` while
retaining RAM. Blinking cursors and key-repeat/debounce timing are not emulated.

## Instruction behavior and deliberate limits

The documented move, logical, arithmetic, compare, branch, one-level CALL/RET,
display, bank exchange, clock, nibble I/O, shift and keyboard instructions are
implemented. The less obvious manual contracts are tested explicitly:

- CMP/CMPI carry means source/constant **less than** destination, while SUB
  carry means borrow.
- DISP's source register is the rightmost digit, with ascending registers
  extending left and wrapping past F to 0.
- HXDZ above hexadecimal 3E7 produces 000 with ZERO set; an ordinary zero
  conversion clears ZERO.
- MULT uses working and storage registers 0…5 as decimal digits. DIV divides
  storage 0…3 by working 0…3, replaces the storage operand with the remainder,
  and sets ZERO when the remainder is nonzero. A zero dividend is an error too.
- CLEAR clears working registers only; MAS and exchange operations preserve
  the flags. DOT clears carry and updates zero while latching the output.

RND uses a deterministic bounded simulator generator. Its nibble range and
flag behavior follow the manual; its sequence does not reproduce the original
free-running counter. KIN accepts one new keypress after the request; a prior
keypress is not replayed. DZHX with nondecimal digits stops with an explicit
unsupported-behavior message because the manual does not specify that result.
Invalid decimal MULT/DIV operands set carry and show six Es as the model's
visible error policy; only the documented overflow/zero cases establish those
exact register results on original hardware.

Timing is **not native timing**. In particular, the original manual describes
DIV 9999/1 taking about eight seconds, with display blanking, ignored keypad
input and lost timekeeping ticks. This model executes decimal arithmetic
atomically in one configured instruction interval and keeps sampling the
clock. Native instruction delays, reset display transients, display duty
cycles, analog input protection and cassette transfers remain later work.

## Verification

```sh
node --test test/microtronic-machine.test.mjs test/microtronic-circuit.test.mjs \
  test/cp1-circuit.test.mjs test/cp1-machine.test.mjs
```

The focused tests cover the independent manual vectors, malformed-input
atomicity, front-panel program commit, CALL/RET and breakpoint behavior,
reset retention, shared-clock scheduling, explicit CLOCK wiring, all four
loopback bit weights, actual switch-to-program-to-LED current, halt/resume,
same-source persistence, and isolation between two placed Microtronics.
The adjacent CP1 tests guard the existing registration and circuit runtime.

The first downstream visible-LED check found an existing Board sampler defect:
scheduled device changes updated solved current but were added to LED history
only at the caller's final advance time. A regression fails on that behavior
despite correct physical current. Board now records settled LED samples at each
scheduled substep, using the existing sampler and its same-time deduplication.
The coarse/fine advance test verifies identical perceived brightness without
changing deadlines, solver decisions, or scope sampling.
