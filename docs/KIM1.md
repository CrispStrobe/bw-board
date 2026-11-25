# KIM-1 circuit trainer

The `kim-1` device executes documented NMOS 6502 machine code and connects the
user I/O ports to the circuit solver. It starts in the independent teaching
monitor. An optional hardware mode boots two user-supplied 6530 ROMs and drives
the panel and TTY through their port registers. All new implementation files
are MIT. Historical firmware stays in the active simulation session.

The default program is a NOP/JMP loop at `$0200`. The device starts stopped.
`KIM1_DEMOS.counter` and `.echo` contain short programs authored for this project:
the counter configures PA as outputs and increments it; echo configures PA as
outputs, PB as inputs, then copies the available PB bits to PA.

## Front panel and controls

The left four digits show the selected address, and the right two its byte.
Unavailable memory displays `--` in the byte field. The address cursor and CPU
PC are separate: browsing memory does not change the stopped CPU state.

| Key | Action in this monitor |
| --- | --- |
| AD | Select address entry. Each hex key rolls one digit into the four-digit address. |
| DA | Select data entry. Each hex key rolls one digit into the byte and writes selected RAM or I/O. |
| + | Advance one address while retaining AD or DA mode. |
| GO | Restore saved user registers and start at the displayed address. |
| SST | Toggle single-step mode. With SST enabled, GO executes one instruction and displays its next PC. |
| PC | Return the cursor to the last stopped PC after browsing memory. |
| ST | Stop at the simulator's current instruction boundary and save registers. |
| RS | Reset controls, registers and peripheral model; retain user RAM, authored program and SST switch position. |

`board.setDeviceControl(id, verb, value)` accepts `key`, `loadProgram`, `run`,
`halt`, `step`, `reset`, `setPc`, and `setSst`. `run` accepts an optional numeric
16-bit address; `setPc` requires one. `setSst` accepts a boolean. `step` executes
one instruction at the displayed address regardless of the SST switch. The
machine helpers are exported from `kim1-machine.js`; registration is exported
as `registerKim1Device` and is included in `registerAllDevices()`.

State includes `display`, `address`, `pc`, `cpu.{a,x,y,s,p,pc,cycles}`, `running`,
`singleStep`, `error`, `programSource`, `portA`, `portB`, `ddrA`, and `ddrB`.
`ram` contains the 1 KiB main RAM and `riotRam` the two 64-byte RRIOT RAMs.
CPU methods and bus callbacks live outside public state in a WeakMap.

Saved register bytes use the documented locations: `$00EF` PCL, `$00F0` PCH,
`$00F1` P, `$00F2` SP, `$00F3` A, `$00F4` Y, `$00F5` X. Editing these bytes before
GO can change the restored registers. `$00EF–00FF` and `$17EC–17FF` are monitor
workspace, so programs should keep their data elsewhere. This independent
monitor writes the saved-register bytes when entering the panel.

BRK is an explicit host-monitor trap in the KIM machine: it consumes seven CPU
cycles, records the return address two bytes after BRK, and returns the user
registers to the panel. This is not execution of the original BRK ROM handler.
The separate `NMOS6502` core implements ordinary vector-based BRK/RTI, IRQ/NMI
and reset for consumers that supply their own complete bus and vectors.

## Program text and persistence

In addressed hex, every nonempty data line contains a four-digit hexadecimal address,
a colon, and one or more exact two-digit bytes. `;` and `#` introduce comments.

```text
0200: A9 FF 8D 01 17 A9 00 8D 03 17 AD 02 17 29 BF 8D
0210: 00 17 4C 0A 02
```

The loader also accepts MOS paper tape (.pap/.ptp) and Intel HEX, checking
record lengths, checksums and end records. Tape and Intel HEX addresses in
expansion RAM enable the expanded profile. The addressed-hex export records
that profile and the entry address when it differs from the lowest loaded byte.
Loading validates the entire source before changing any live state. Duplicate
addresses (including hardware aliases), writes outside RAM, malformed bytes,
and overflow are rejected. A successful load clears RAM, applies the image,
initializes saved registers, and selects its lowest canonical address. Canonical
source is uppercase, sorted and grouped into at most sixteen bytes per line.
Both RS and program loading preserve the physical SST switch position. Only a
newly created machine defaults the switch to off; use SST or `setSst` to move it.

Panel RAM edits update `programSource` immediately. Persisting that exact source
back to `part.params.program` preserves the current running state and cursor.
Reset keeps RAM and these authored edits. CPU runtime RAM writes, timer state,
and execution position are not serialized as a resumable checkpoint; saving a
circuit saves its authored program. A fresh program load intentionally replaces
the current RAM image. Runtime writes never silently expand the authored image.
Panel edits to mapped ports, DDRs and timers take effect immediately, but are
runtime I/O operations and are not added to the persisted RAM program image.

## Memory and ports

The unexpanded board decodes thirteen address bits. Every 16-bit CPU address
is mapped with `address & 0x1FFF`, so `$2200` aliases `$0200`.

| Canonical address | Model |
| --- | --- |
| `$0000–03FF` | 1 KiB read/write RAM |
| `$0400–16FF` | Unmapped expansion/unused space |
| `$1700–173F` | User 6530-003 port/timer registers |
| `$1740–177F` | Monitor 6530-002 port/timer registers |
| `$1780–17BF` | User RRIOT RAM, 64 bytes |
| `$17C0–17FF` | Monitor RRIOT RAM, 64 bytes |
| `$1800–1BFF`, `$1C00–1FFF` | 6530-003 and 6530-002 ROM windows in hardware mode |

Expanded RAM occupies `$0400–16FF` and `$2000–FFF9`. Hardware vectors
`$FFFA–FFFF` are sourced from `$1FFA–1FFF` even with expansion. The teaching
monitor reports absent memory accesses. Hardware mode retains the last bus
byte for open-bus reads and ignores writes to ROM and unpopulated addresses.

## Hardware mode

In Circuits, open **Firmware and TTY** and choose two 1,024-byte images named
for 6530-003 and 6530-002, or one 2,048-byte image with 003 first. The Board
executes each memory access on the shared 1 MHz clock, including dummy reads
and the two NMOS read-modify-write cycles. The 74145 selects seven-column keypad
rows and the six display digits. ST requests NMI and SST requests it after
each user instruction. Original firmware uses the RAM soft vector at
`$17FA–17FB`; programs should set it before using ST or SST.

TTY is a virtual 300-baud terminal with the monitor's line gating and echo.
Mounting files and switching monitor modes are session controls. An imported
program in hardware mode writes to RAM without resetting the running monitor.
Use the hardware keypad to select the program entry address. In the teaching
monitor, loading selects the entry address automatically.

For an optional check with local ROM and tape files:

```sh
node scripts/qualify-kim1-rom.mjs 6530-003.bin 6530-002.bin program.ptp
```


User registers are PA `$1700`, DDRA `$1701`, PB `$1702`, DDRB `$1703`; monitor
registers have an offset of `$40`. A DDR bit of one selects output, zero selects
input. Reading mixes output latches and sampled input bits according to the DDR.
The I/O registers also appear at offsets `$8–B`; the complete register block
repeats every `$10` within each chip's range.

The exposed terminals are `PA0–PA7`, `PB0–PB5`, `PB7`, `5v`, and `gnd`. PB6 is a
board selection function and has no external terminal. The echo demo masks that
bit. Output latches reach the same Thévenin-source stamping as other devices;
DDR input pins are high impedance. Inputs use a teaching-model threshold of
2.5 V relative to `gnd`, and a 1 GΩ numerical reference prevents undefined
floating nodes. Add real pull resistors to switch circuits. Output impedances
are simplified: 220 Ω high and 10 Ω low. This is not an analog 6530 transistor
or TTL noise-margin model. The 5 V fallback rail can yield to an explicit rail
under the Board's ordinary supply rules.

## Timer and shared time

`part.params.clockHz` is an integer from 1 to 1,000,000, default 1,000 Hz. Original
KIM hardware is nominally 1 MHz; the slower default makes program-driven circuit
changes visible. Both CPU instruction deadlines and RRIOT timers use this same
Board clock. There are no browser intervals, wall-clock timestamps or parallel
emulator loops. Instructions execute at their scheduled boundaries; subsequent
deadlines use their actual cycle totals. CPU bus transactions and timer effects
are grouped at instruction boundaries rather than modeled as bus waveforms.
The timers continue with Board time when the monitor has stopped the CPU.

Timer writes at `$1704–1707` select divisors 1, 8, 64 and 1024 with interrupt
output disabled. `$170C–170F` select the same divisors with output enabled.
A value N underflows after `N * divider + 1` cycles, becomes `$FF`, and then
decrements at one CPU clock per count. Odd timer-register reads return the
expired flag in bit 7 and do not acknowledge it. Even reads return the count,
clear the expiry flag and select interrupt output according to address bit A3:
`$1704/$1706` disable, `$170C/$170E` enable. The programmed prescaler continues
running, so acknowledgement restores the programmed rate without restarting
its phase. A new timer write restarts the prescaler.

Enabled expiry pulls PB7 low; it does not automatically invoke CPU IRQ or NMI.
GPIO output-low remains low before expiry. Otherwise PB7 follows its normal
DDR/latch/input behavior. IRQ/NMI external terminals are not exposed in this
first integration. Poll the timer status in programs, or observe PB7 electrically.
Original-board wiring of PB7 to an interrupt input is not implied here.

Register decode and read enable behavior follow the newer MOS 6530 manufacturer
truth table where older KIM appendix wording differs. Prescaler phase and PB7
combination behavior have supplemental silicon-analysis support; exact same-cycle
read/underflow races and differences among 6530 mask revisions are not validated.
RS is the simulator's deterministic peripheral reset, not a reconstruction of
every hardware RESET edge or of monitor firmware initialization.

## CPU qualification and tests

`NMOS6502` reuses the project's MIT `W65C02` instruction plumbing and overrides
the NMOS differences: documented 151-opcode whitelist, decimal arithmetic flags
and timing, indirect-JMP page wrap, fixed seven-cycle indexed shifts, NMOS RMW
old-value/new-value writes, JSR operand/stack ordering, and interrupt/reset
decimal behavior. Undocumented NMOS and CMOS-only opcodes produce errors.

Run the focused tests in a full bw-board checkout:

```sh
node --test test/kim1-*.test.mjs
node scripts/grind-nmos6502.mjs
```

The oracle command requires Python, Node and network access. It fetches the
pinned MIT SingleStepTests NMOS dataset into memory, with four concurrent
downloads and no saved ROM or vector artifacts. Optional hex opcode arguments
limit the run, for example `node scripts/grind-nmos6502.mjs 69 e9 20 6c`.

On 2026-11-25 all **1,510,000 of 1,510,000** vectors (151 documented
opcodes × 10,000) passed final registers, final RAM, cycle totals and every
ordered bus address, direction, and value. The Board regression also verifies
a page-crossing dummy read acknowledges the 6530 timer on its own cycle.
A separate original-ROM test verified keypad entry, GO, ST, SST, the TTY
prompt and an interactive memory write. Electrical waveforms, asynchronous
interrupt polling races, cassette and optional storage peripherals require
separate qualification.

## Provenance

The teaching monitor was specified from hardware documentation. The project
W65C02 code is the only reused implementation. Historical ROM images are
external test inputs for the hardware model. Sources:

- MOS Technology, [KIM-1 User Manual, August 1976](https://bitsavers.org/components/mosTechnology/kim-1/6500-15B_KIM-1_Users_Manual_197608.pdf): board architecture, controls, memory map and I/O.
- [KIM-1 manual text transcription](https://www.kim-1.com/docs/usrman.htm): factual cross-check; no monitor assembly listing translated or copied.
- MOS Technology, [MCS6530 manufacturer data sheet](https://www.retrodocs.fr/wp-content/uploads/pdf/MOS-6530.pdf): register decode, timer mode and I/O behavior.
- [Supplemental MOS 6530 silicon dissection](https://www.forum64.de/index.php?thread/117122-mos6530-mcs6530-004-aka-tim-dissected/): qualified prescaler/PB7 facts, not implementation source.
- [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02/tree/2f6980a2d95757486c7bee24355c360e40e2a224/6502/v1), pinned revision `2f6980a2d95757486c7bee24355c360e40e2a224`: independent NMOS CPU oracle, MIT.

### SingleStepTests notice

The downloaded test data and the focused JSR regression derived from one vector
are covered by this notice from the pinned upstream LICENSE:

```text
MIT License

Copyright (c) 2024 Thomas Harte et al

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [Ruud Baltissen’s archived KIM-1 hardware notes](https://web.archive.org/web/20141129191318id_/http://6502.org/trainers/buildkim/buildkim.htm)
- [Patric Sokoll’s KIM-1 hardware collection](https://patric-sokoll.de/Computermuseum/MOS%20KIM-1/MOS%20KIM-1.html)
- [Hans Otten’s KIM-1 manuals and MOS documents](http://retro.hansotten.nl/6502-sbc/kim-1-manuals-and-software/kim-1-manuals-and-software/)
