# Busch Microtronic 2090 native monitor contract

## Provenance and scope

This contract derives from the published Busch user manual, the original board schematic, and TI parts documentation. The hexadecimal Microtronic commands are the user-program instruction set. The TMS1600 executes an independently written interpreter in its 4,096-byte native program store and has 128 nibbles of scratch RAM. The monitor drives the display, keypad, flag LEDs, I/O and external SRAM through the board signals. The interaction sequences below are derived tests. Hardware behavior has yet to be measured against these vectors. [Busch manual, part 1, pp. 71–77][manual], [TI TMS 1000 family microcomputer data book][ti]

The initial monitor covers reset, editing and inspecting all 256 program words, running and stopping, single-stepping, breakpoints, register inspection/editing, and the ordinary instruction groups. PGM 5 and PGM 6 exercise whole-memory writes. The separate special-instruction and fixed-program tables describe compatibility beyond that minimum.

## Front panel

The panel has six multiplexed seven-segment digits, carry and zero indicators (carry above zero), sixteen hex keys, eight function keys, and four input and four output terminals. A normal address view reads `AA WWW` with position 3 dark, counting from the left. Hex `B` and `D` use seven-segment lowercase forms. Data I/O low-to-high bit order is numbered 1 to 4. [Busch manual, part 1, pp. 4–5, 47–48, 72–77][manual]

| Input | Documented external behavior |
| --- | --- |
| RESET | Return to address view at `00` and clear register values and the time. Previously entered program words survive reset. With zero at address `00` the published display example is `00 000`. |
| HALT | End the current function or stop guest execution. Show the stopped instruction's address and word. From this point RUN continues. |
| HALT, NEXT, two hex digits | Select the address, high digit first. Show the selected address and its current word. |
| Three hex digits while browsing, NEXT | Store the edited word and advance to the next address. NEXT without an edit advances and displays the next word. |
| C/CE | One press removes the last typed digit. Two successive presses clear the whole pending word. |
| RUN | Start from the selected instruction or resume from HALT. |
| STEP | Execute one guest instruction and normally display the next address and word. A stepped DISP can show its register display until the next action. |
| HALT, REG, register digit | Show working-register number in position 3 and its value in position 6, with the other positions dark. A subsequent hex digit replaces its value. Use HALT, REG to select another register. |
| HALT, BKP, two hex digits | On RUN, stop at this address before executing its word. The breakpoint survives program edits. HALT, BKP, 00, HALT clears it. STEP or RUN continues from a breakpoint. |
| HALT, PGM, selector digit | Execute the selected fixed monitor function. See table below. |

Sources for key and display behavior. [Busch manual, part 1, pp. 4–5, 12–14, 41, 48, 72–73][manual]

## Guest state and instruction groups

Guest program addresses are two hex digits (`00`–`FF`), and each instruction word contains three hex digits. Working registers `W[0..F]` and memory registers `M[0..F]` hold one nibble each. The carry and zero indicators reflect guest flags C and Z. The ordinary successor is the following address. Arithmetic results retain their low four bits. For comparisons, C is set when the source or immediate is **less than the destination**. Subtraction sets C when the destination is **less than the subtrahend** before subtraction. [Busch manual, part 1, pp. 13–14, 61, 73–76][manual]

In the tables below, `s` and `d` select source and destination working registers, `n` is an immediate nibble or a display count, and `aa` is an eight-bit target. A dash denotes flag preservation.

| Word | Behavior | C | Z |
| --- | --- | --- | --- |
| `0sd` MOV | Copy `W[s]` to `W[d]` | — | Result zero |
| `1nd` MOVI | Copy `n` to `W[d]` | — | Result zero |
| `2sd` AND, `3nd` ANDI | Bitwise AND into `W[d]` | 0 | Result zero |
| `4sd` ADD, `5nd` ADDI | Add source or immediate to `W[d]` | Carry out | Result zero |
| `6sd` SUB, `7nd` SUBI | Subtract source or immediate from `W[d]` | Borrow | Result zero |
| `8sd` CMP, `9nd` CMPI | Compare source or immediate with `W[d]`, preserving registers | Source < destination | Equal |
| `Asd` OR | Bitwise OR into `W[d]` | 0 | Result zero |
| `Baa` CALL | Save the following address as the single return address, then jump to `aa` | — | — |
| `Caa` GOTO | Jump to `aa` | — | — |
| `Daa` BRC, `Eaa` BRZ | Jump to `aa` if C or Z respectively is set | — | — |
| `F1s`–`F6s` DISP | Select a live register display. Rightmost is `W[s]`, next to its left is `W[s+1]`, etc. Blank unused positions. | — | — |
| `F7d` MAS | Copy `W[d]` to `M[d]` | — | — |
| `F8d` INV | Complement all bits of `W[d]` | 0 | Result zero |
| `F9d` SHR, `FAd` SHL | Shift `W[d]` right or left by one with zero fill | Discarded bit | Result zero |
| `FBd` ADC, `FCd` SUBC | Add or subtract incoming C to/from `W[d]` | Carry out / borrow | Result zero |
| `FDd` DIN | Sample the four external input lines into `W[d]` | 0 | Input zero |
| `FEd` DOT | Latch `W[d]` onto the four output terminals and LEDs until a later DOT | 0 | Output zero |
| `FFd` KIN | Wait for one hex key, then store its value in `W[d]` and continue | 0 | Key value zero |

The DISP description gives a boundary expression that conflicts with its own example of wrap from F to 0. Use `(s + digit_index) & F` for the first monitor. CALL is specified for one outstanding call. The printed CMP and CMPI equality rows contain a mistaken inequality symbol in the positive case. The wording and the branching examples agree that Z indicates equality. [Busch manual, part 1, pp. 14, 47–48, 63, 74–75][manual]

| Word | Special instruction behavior | C | Z |
| --- | --- | --- | --- |
| `F00` HALT | Stop with this address and `F00` visible. STEP advances beyond this HALT, after which RUN resumes. | — | — |
| `F01` NOP | Advance to the next instruction | — | — |
| `F02` DISOUT | Blank the guest display | — | — |
| `F03` HXDZ | Convert hex `W[F:E:D]` to its three decimal digits in place. Values above hex `3E7` produce `000`. | 0 | Out of range |
| `F04` DZHX | Convert three decimal digits in `W[F:E:D]` to hex in place | 0 | 0 |
| `F05` RND | Return three random hex digits in `W[D]` through `W[F]` | — | — |
| `F06` TIME | Snapshot decimal clock digits into `W[F:E:D:C:B:A]` as HHMMSS | — | — |
| `F07` RET | Jump to the saved return address from CALL | — | — |
| `F08` CLEAR | Zero all working registers and preserve all memory registers | 0 | 1 |
| `F09` STC, `F0A` RSC | Set or reset C | 1 / 0 | — |
| `F0B` MULT | Multiply six decimal working digits by the corresponding six memory digits. Put product in `W[5:0]`, units at 0. Overflow produces `EEEEEE`. | Overflow or nondecimal digit | 0 |
| `F0C` DIV | Divide four decimal memory digits by four working digits, units at 0. Quotient goes to the working bank, remainder to the memory bank. Both banks' digits 4 and 5 must be zero on entry. A zero operand reports `EEEEEE` in the working bank. | Zero operand or nondecimal digit | Remainder present on success |
| `F0D` EXRL | Exchange working and memory registers 0–7 | — | — |
| `F0E` EXRM | Exchange working and memory registers 8–F | — | — |
| `F0F` EXRA | Exchange the low and high halves of the working bank | — | — |

Sources for the special instructions and HXDZ range overflow. [Busch manual, part 1, pp. 43–44, 61–63, 75–76][manual]

| PGM | Documented original function |
| --- | --- |
| `0` | Built-in board and keypad self-test. The full procedure uses four output-to-input loopbacks. |
| `1`, `2` | Cassette load and save with interface accessory 2095. |
| `3`, `4` | Set clock via four HHMM digit keys (seconds start at 00) and show live HHMMSS, respectively. Clock counting requires the patch from Clock to Input 4. |
| `5`, `6` | Fill all 256 program words with `000` or `F01`, respectively. |
| `7` | Put the built-in Nim game into program RAM. The manual describes a last address of `44` and a separate RUN from address `00`. |

Sources for PGM procedures. [Busch manual, part 1, pp. 4–8, 31, 67, 72–73][manual]

## Timing and unresolved corner cases

Use one accepted action per complete press and release. The manual describes momentary taps and exposes no numerical debounce or display duty-cycle requirement. The suggested deterministic rules for the first monitor are address increment modulo 256, discard a pending partial or uncommitted word on HALT, and accept a new command after release. Treat `00` as the breakpoint-cleared value per the manual and bypass the just-hit breakpoint once on continuation. These rules cover documented sequences. Precise display during entry, editing at address `FF`, direct RUN from a breakpoint, blinks and lamps during reset or key-wait, initial RAM, and behavior outside valid clock or decimal input require direct evidence for exact compatibility. Nested CALL and RET without CALL are outside the documented use. The manual reports clock errors and temporary loss of keyboard and display service during the slowest decimal arithmetic, so native timing should be evaluated separately from guest result correctness. [Busch manual, part 1, pp. 4, 41, 62, 72–76][manual]

## Derived acceptance vectors

Start each vector with RESET and clear any breakpoint using `HALT BKP 00 HALT`. Use `HALT NEXT AA` to select a word. For each word enter its three digits then NEXT. Observe display over a complete refresh cycle and sample output and flag LEDs after execution or once the monitor stops.

| Vector | Stimulus | Expected result |
| --- | --- | --- |
| Editing, reset and upper address | PGM 5, write `12A` at `12` and `F01` at `FF`. Select each address. RESET and select both again. | `12 12A` and `FF F01` before and after reset. |
| Carry branch and output | From `00`, enter `1F0 510 D04 110 1A1 FE1 F00`; run from `00`. | Step over `510` separately to observe C=1, Z=1 and W0=0. In RUN the branch skips `03`; final `06 F00`, W0=0, W1=A, outputs 2 and 4 high. |
| Compare both operand orders | Run `130 151 801 810 950 F00` by STEP from `00`. | After `801`, C=1 and Z=0. After `810`, C=0 and Z=0. After `950`, C=0 and Z=0. Registers remain 3 and 5. |
| Shifts and borrow | Run `18A FAA FBA F9A FCA F8A F00` by STEP. | From `FAA` through `F8A`, expect successive (W[A], C, Z) values (0,1,1), (1,0,0), (0,1,1), (F,1,0), (0,0,1). |
| Breakpoint and single step | With `110 520 540 F00` at `00`, enter BKP `02` and RUN from `00`. | `02 540` and W0=3. STEP executes `540`, shows `03 F00`, and W0=7. |
| Display and keyboard | Run `F08 F20 FF0 FF1 C02` from `00`. Press A and release, then 5 and release. | Display progression `    00`, `    0A`, `    5A`. Holding the first key retains the second wait until a separate press. |
| Port read and hold | Drive inputs 1 and 3 high. Run `FD2 FE2 F00`. Change inputs after stop. | W2=5, outputs 1 and 3 high at stop and stay high after input change. |
| Call and return | Run `B04 151 FE1 F00 123 F07` from `00`. | W3=2, W1=5, output=5, halt at `03 F00`. |
| Clear, memory bank and HXDZ | Run `1A0 F70 F08 F0D 17D 1EE 13F F03 F00` from `00`. | After CLEAR W0=0, C=0, Z=1. After EXRL W0=A. After HXDZ the decimal field W[F:E:D]=999 and C=Z=0. |
| Fill boundaries | PGM 6, inspect `00`, `55`, `FF`; repeat with PGM 5. | Each inspected word is `F01` after PGM 6 and `000` after PGM 5. |

## Original board shared signals

Signal names below follow the Busch drawing. Physical TMS1600 package numbers follow the TI pinout. The printed numbers beside R0–R5 on the Busch drawing disagree with TI. Trace the named nets and use TI pin 40 for R0 and pins 1–5 for R1–R5. Board GND is the low reference for the external 5 V logic. TMS1600 VSS is 5 V above board GND and VDD is 4 V below it, as annotated at the interface socket. [Busch schematic][schematic], [TI Microsystems Designers Handbook, p. 2-5][handbook]

| TMS1600 signal | DIP pin(s) | Board net |
| --- | --- | --- |
| R0, R1, R2, R3, R4, R5 | 40, 1, 2, 3, 4, 5 | SRAM A4 through A9, plus keypad columns and digit-driver selects |
| R6 | 6 | Enables the 4016 to connect the four external input terminals to the K input bus |
| R7, R8, R9, R10 | 7, 8, 9, 10 | SRAM write data source through the 4502, plus rear output terminals 1–4 through transistors |
| R11 | 11 | Drives TMS1600 K/L select pin 28. Low selects K, high selects L. |
| R12 | 12 | Common display digit-driver enable |
| R13 | 13 | Drives the SRAM active-low write input through a transistor and enables the 4502 through a diode/RC network |
| R14, R15 | 14, 15 | Carry and zero LEDs, respectively |
| INIT | 17 | Green RESET switch and reset network |
| K1, K2, K4, K8 | 18, 19, 20, 21 | Keypad rows and external inputs 1 through 4 through the input switch |
| L1, L2, L4, L8 | 22, 23, 24, 25 | SRAM I/O bits 0 through 3, SRAM pins 11–14 |
| SE MODE | 29 | Left unconnected in the drawing. The internal pulldown selects live pass-through on L. |
| O0, O1, O2, O3, O4, O5, O6, O7 | 35, 34, 33, 32, 31, 30, 27, 26 | Display segments a, b, c, d, e, f, g, decimal point. O0–O3 also drive SRAM A0–A3. |
| OSC1, OSC2 | 36, 37 | Processor oscillator network at nominal 500 kHz |

The six keypad columns from left to right use R5, R4, R3, R2, R1, R0. The top-to-bottom rows use K8, K4, K2, K1. This gives the electrical scan matrix below. The shared digit-driver selects follow those same six R signals. The drawing does not number the physical display positions. Using R0 for the rightmost digit is a board-model assumption until checked against the panel. [Busch schematic][schematic]

| Row | R5 | R4 | R3 | R2 | R1 | R0 |
| --- | --- | --- | --- | --- | --- | --- |
| K8 | C | D | E | F | NEXT | REG |
| K4 | 8 | 9 | A | B | BKP | STEP |
| K2 | 4 | 5 | 6 | 7 | RUN | HALT |
| K1 | 0 | 1 | 2 | 3 | C/CE | PGM |

The µPD2114 SRAM has 1,024 four-bit cells. A0–A7 hold the 8-bit guest word address. The handwritten lane annotation lists `00` for the opcode (left nibble), `01` for the middle nibble and `10` for the right nibble. Reading the lane bits in conventional A9:A8 order places those lanes at offsets `0x000`, `0x100` and `0x200`. Offset `0x300` is outside the three nibble lanes. A lane-order pin trace can verify this inference when original image interoperability matters. [Busch schematic][schematic]

## Bus operations and acceptance

- **Read.** Set the word address and lane on the O/R address nets with SRAM write inactive. Select the L inputs and sample the chip's four data pins. Allow at least one native instruction of setup time after a K/L transition before sampling. The schematic ties the SRAM's active-low select to board GND. [Busch schematic][schematic], [TI TMS 1000 family microcomputer data book, p. 20][ti]
- **Write.** Set the word address, lane and data before asserting the write signal. The 4502 inverts D at its enabled outputs and goes high impedance when disabled. Its inhibit input is held low on the board. For electrically normalized CPU pin levels, R7–R10 drive the complement of the intended SRAM nibble. The transistor on R13 pulls the SRAM write net low when R13 is high. The surrounding diode/RC network also controls when the inverter drives. Keep the data and address stable through write completion and allow the buffer to release before reading. [Busch schematic][schematic], [TI CD4502B data sheet][buffer]
- **Output.** The rear output terminals are normally pulled up, with NPNs controlled by R7–R10 pulling them to board GND. This makes the terminal levels the complement of the pin levels. Preserve and restore the DOT latch across writes that borrow these pins. Transient terminal changes during a physical write are a property of the shared wiring. [Busch schematic][schematic]
- **Display, keypad and DIN.** Blank the display when address or segment nets are changing for other operations. Scan one keypad column at a time and leave R6 inactive for a keyboard sample. Sample DIN on K with the external-input switch enabled and keypad columns inactive. The one-hertz signal is a distinct board output until patched to input 4. [Busch schematic][schematic], [Busch manual, part 1, p. 8][manual]
- **Output encoding.** A new 32-entry output PLA can provide sixteen legal address patterns on O0–O3 in one status-latch state and sixteen glyphs on O0–O7 in the other. This is an implementation choice for the shared nets. As an electrical acceptance check, verify that keyboard and display refreshes leave SRAM unchanged, all lane addresses remain independent, and a write of logical nibble A reaches the selected cell as A even when the current DOT value differs.
- **Boundary trace.** Use known differing nibble values at guest addresses `00`, `0F`, `10`, `80` and `FF`. Record O0–O3, R0–R5, the write strobe and data during each write. Verify the word address changes across the O/R split and that every lane within a word reads back its own nibble. Return to hardware reset and verify that all five words survive.

[manual]: https://raw.githubusercontent.com/lambdamikel/Busch-2090/master/manuals/anl2090-1.pdf
[ti]: https://raw.githubusercontent.com/lambdamikel/Busch-2090/master/manuals/tms1400info.pdf
[schematic]: https://raw.githubusercontent.com/lambdamikel/Busch-2090/master/manuals/microtronic.jpg
[handbook]: https://www.blunham.com/Misc/Texas/Software990/MicroSystemsDesignersHandbook.pdf#page=16
[buffer]: https://www.ti.com/lit/ds/symlink/cd4502b.pdf
