# Kosmos CP1 and CP3 firmware contract

Build a new, standalone monitor in at most 2,048 bytes of real Intel 8049 program memory. Its public interfaces are the physical keypad, six multiplexed seven-segment digits, external teaching RAM, and terminal ports. The same ROM must run on the 8049/8155 circuit and on the existing circuit model. Key handling, instruction execution, and delay all run as 8049 firmware. The host may supply contact closures and external pin levels, load teaching RAM, and observe the machine.

This contract records electrical facts from the manufacturer's documentation and compatibility observations from public pins, displays, and teaching RAM. Where the original reference card and a reproducible 2716 observation differ, the measured behavior governs the replacement for that case. Test programs below were written for this contract. No historical program listing or firmware internals are part of the handoff.

## 1. Hardware interface

The 8049 has 128 bytes of internal RAM, eight hardware stack entries within it, and 2 KiB of resident program memory at `0x000–0x7FF`. The crystal is 6 MHz. Fifteen oscillator periods make one machine cycle, or 2.5 µs at nominal speed. Use the 8049 timer for any periodic service. The base 8155 timer pins are unconnected. Both peripherals receive MOVX addresses and data over the CPU's multiplexed bus. ALE latches the low eight address bits, chip enable, and I/O selection.

| CPU P2 bit | Connection | Active state |
| --- | --- | --- |
| 7 | I/O vs RAM select on both 8155s | 1 selects I/O, 0 selects RAM |
| 6 | 8155 reset | High |
| 5 | CP3 8155 chip enable | Low |
| 4 | Base 8155 chip enable | Low |
| 3–0 | Keyboard columns 3–0 | Release high at CPU latch to sample; contact signal is high when selected |

With the keypad column latch bits released, use these P2 values.

| Selection | RAM | I/O |
| --- | --- | --- |
| Base | `0x2F` | `0xAF` |
| CP3 | `0x1F` | `0x9F` |
| Both | `0x0F` | `0x8F` |
| Neither | `0x3F` | `0xBF` |

CPU reset releases P1 and P2 high, holding both 8155s reset with chip selects inactive. 8155 reset initializes its directions and clears output state while preserving RAM. After configuration both chips can operate independently. A write with both selected reaches both chips. Reads must select one chip at a time. With no selected responder, the model reads `0xFF`.

The valid 8155 I/O offsets are 0 for command on write/status on read, 1 for PA, 2 for PB, 3 for PC, and 4/5 for its unused timer. Command bit 0 enables PA output and bit 1 enables PB output. Command bits 3:2 select PC mode, with binary `11` for basic output (ALT 2) and `00` for basic input (ALT 1). The upper four bits may be zero for this monitor. Configure base PA, PB, PC as outputs (command `0x0F`), and CP3 PA, PC as outputs and PB as input (command `0x0D`). Ensure the display cannot present persistent spurious segments during initialization.

| Teaching terminal | Circuit pin | Initial idle output | Width |
| --- | --- | --- | --- |
| P1 | 8049 P1, quasi-bidirectional | `0xFF`, released | 8 |
| P2 | Base 8155 PB, output | `0xFF` | 8 |
| P3 | CP3 8155 PB, input | Floating on open real pins | 8 |
| P4 | CP3 8155 PA, output | `0xFF` | 8 |
| P5 | CP3 8155 PC, output | `0x3F` | 6 |

Terminal n maps to bit n−1. The teaching terminal P2 is base PB, distinct from the CPU P2 bus/keyboard latch. A P1 latch bit at 0 sinks low. A bit at 1 releases the pin to its weak high source and an external contact can pull it down. Undriven CP3 input values are unspecified electrically. The digital model deterministically samples them high, and compatibility fixtures drive P3 explicitly.

### Matrix and display

Base PC0–PC5 enable PNP common-anode drivers, active low. An enabled row powers one digit and the keypad contacts on PC0–PC4. Each column has a 1 kΩ pull-down, making idle low and a closed contact high while its row is selected.

| Active row | CPU P2.0 | CPU P2.1 | CPU P2.2 | CPU P2.3 |
| --- | --- | --- | --- | --- |
| PC0 | CAS | CLR | PC | ACC |
| PC1 | CAL | STEP | STP | RUN |
| PC2 | 8 | 9 | OUT | INP |
| PC3 | 4 | 5 | 6 | 7 |
| PC4 | 0 | 1 | 2 | 3 |
| PC5 | — | — | — | — |

There are 20 electrical contacts. The ten decimal keys each have two parallel physical contacts. A closure of either is equivalent, including when the other remains held. Scan selected rows and read P2 pins. Use a single accepted press per closure with release before the next press. Keep P2 control state valid while sampling. No 8243 expander is present. Analog key bounce, multiple-key ghosting and ordering of simultaneous distinct keys are outside compatibility acceptance.

Base PA0–PA6 map to a, b, c, d, e, f, g, high to light. PA7 is unconnected. Left-to-right digits are base PC5, PC4, PC3, PC2, PC1, PC0. The dot is physically tied on for PC3 (third position from the left) whenever its digit driver is active, including displays whose third position has no lit segments. Digit PC5 also has a supply indicator independent of firmware.

The hexadecimal seven-segment masks are below. In observations only, bit 7 of the third position denotes the fixed dot. A blank stable monitor frame retains this dot.

| Glyph | Mask | Glyph | Mask | Glyph | Mask |
| --- | --- | --- | --- | --- | --- |
| blank | 00 | 0 | 3F | 1 | 06 |
| 2 | 5B | 3 | 4F | 4 | 66 |
| 5 | 6D | 6 | 7D | 7 | 27 |
| 8 | 7F | 9 | 6F | A | 77 |
| C | 39 | E | 79 | F | 71 |
| P | 73 | | | | |

For example, `A00.042` yields `77 3F BF 3F 66 5B`, an overflow display yields `71 00 80 3F 3F 7D`, and the boot PC display yields `73 00 80 3F 3F 3F`. Validate a stable frame over at least 40 ms of simulated cycles, or reconstruct it from row/segment drives on a logic analyzer. Instantaneous samples represent only one slot. At idle, instruction-boundary samples of active row lines on the 2716 model showed successive slots 1,024 cycles apart, or 2.56 ms per slot and approximately 65 full frames/s. Multiplex all six digits, blank or change segment data safely between selections, and continue scanning while executing teaching instructions or delaying. Keep at least 60 complete frames/s, deliver balanced duty across the six slots and keep monitor keys usable under 40 ms press/release stimuli across phases. Shorter pulses depended on row phase, with a 20 ms closure accepted in all six tested phases for digit 7.

## 2. Teaching data and installed capacity

A teaching word `hh.lll` is two independently stored binary bytes displayed in decimal. The high byte is normally an instruction code (01–24) or 00 for numeric data. The low byte is an operand or a numeric value, range 000–255. The teaching accumulator also holds two bytes. Numeric operations use ordinary unsigned binary arithmetic on values encoded as `00.lll`. LDA, ABS, LIA, and AIS transfer both bytes, including executable words. ANZ and ACC show both bytes, supporting the construction and inspection of instruction words as data.

At cell n, select base RAM when n < 128 and CP3 RAM otherwise. The high byte is at `2*(n & 127)` and the low byte at that offset plus 1. Base permits 000–127 and CP3 permits 000–255. The CPU's internal RAM is separate. Pointers used as addresses are decimal on the panel and represented as byte values when stored as operands.

Identify installed capacity at runtime. A CP3 presence test can save a byte, write a non-`0xFF` test value to the expansion alone, read it back, and restore the saved byte when it responds. After capacity detection, initialize every installed teaching cell to `00.000` on both startup and electrical CPU reset, matching the observed 2716 behavior even when RAM starts with nonzero data. The 8155 reset input itself preserves RAM, so this clear is a firmware action. The host loads user programs after monitor startup.

## 3. Keypad monitor and display transitions

The table uses six positions without the physical dot. A space represents a blank segment mask. For keypad scripts, every decimal string is a series of physical button presses. A 40 ms closure followed by 40 ms released was used for the black-box scripts.

| Display frame | Meaning |
| --- | --- |
| `P  ddd` | Teaching program counter |
| `E  ddd` | Address selected for entry |
| `Ehhlll` | Word just stored |
| `Chhlll` | Word selected for reading, or cell 000 after STP |
| `C  ddd` | Current entry/read pointer from `9 OUT` |
| `Ahhlll` | Teaching accumulator |
| `F  ddd` | Error number |
| `    dd` (example) | Digits being typed, right aligned, leading zero keystrokes retained |

- Boot to `P  000` with teaching PC, entry/read pointer and accumulator zero. Begin an input buffer on the first digit and replace the previous frame. Echo one through five digits. A sixth causes F001 and consumes the buffer. A new digit after error starts a new buffer.
- `CLR` empties the pending digit buffer and blanks the display except for the fixed dot. It preserves PC, accumulator, teaching RAM, and entry/read pointer. `ACC` discards pending digits and displays the accumulator.
- `PC` without digits shows the current teaching PC. Exactly three digits then `PC` set and show it. Other nonempty lengths cause F001. An address above installed capacity causes F004 and preserves the prior PC.
- Three digits then `INP` select the entry/read pointer and show `E  ddd`. Five digits then `INP` store the word at that pointer and show `Ehhlll`. Validate high byte 00–24 and low byte 000–255, independent of opcode and actual capacity. Advance the pointer after storing until it reaches the final installed cell. At that cell subsequent valid stores overwrite that cell. Invalid entries preserve the selected address and RAM. Zero, one, two, or four digits followed by INP cause F001.
- Three digits then `OUT` select a valid address, show its full word, and leave the pointer there for editing via INP. Bare OUT increments the pointer and shows the newly selected cell, including from initial pointer 000 or immediately after a three-digit INP selection or five-digit store. `9 OUT` shows the current pointer as `C  ddd` without reading a word. An invalid address or a read past the final cell causes F004. Other nonempty OUT lengths cause F001.
- `RUN` starts at the teaching PC. It blanks the frame except for the dot. ANZ switches to an accumulator frame during execution. A subsequent HLT returns to the PC frame even if ANZ immediately preceded it. `STEP` executes one command from the PC and then normally shows the resulting PC. For a one-command delay, return to the PC frame after completion. `RUN` resumes from the current PC.
- `STP` while running halts at a teaching boundary and displays the **full word in cell 000** with a C prefix. `PC` then reveals the resume address and `ACC` the existing accumulator. Idle STP leaves the current frame alone. While running, keypad commands other than STP do not interfere with the teaching execution.
- The documented `9 RUN` built-in self-test goes through six copies of each digit from 9 down to 0, ending at 000000. The documented `8 RUN` reaction test waits with the display blank, presents an ascending 000–255 count with the fixed dot, and freezes at STP or 255. These are compatibility behaviors and may be independently generated if included in the initial ROM budget. Ordinary execution uses a three-digit PC selection and RUN or STEP. Cassette keys are specified separately below.

## 4. Teaching instruction set

The next teaching PC is normally the executed cell plus one. A successful jump replaces it with its target. SPB tests the last comparison and does not itself consume the comparison. A false comparison overwrites a prior true result. The initial comparison is false. HLT clears the comparison. Ordinary STEP preserves the condition across commands.

| Code | Mnemonic | Operand and effect |
| --- | --- | --- |
| 01 | HLT | Stops running. Show PC of next cell, or the current cell at the last installed address. Conventionally operand 000. |
| 02 | ANZ | Displays the entire accumulator as an A frame while running. Conventionally operand 000. |
| 03 | VZG | Delay based on low operand in milliseconds; see measured timing. Keep display/key refresh active. |
| 04 | AKO | Sets accumulator to `00.operand`. |
| 05 | LDA | Loads the full word from cell operand. |
| 06 | ABS | Stores the full accumulator word to cell operand. |
| 07 | ADD | Adds data in cell operand to numeric accumulator. F005 for a nonzero high byte on either input. F006 if sum >255. |
| 08 | SUB | Subtracts data in cell operand from numeric accumulator. F005 for a nonzero high byte on either input. F006 if result <0. |
| 09 | SPU | Jumps unconditionally to cell operand. |
| 10 | VGL | Sets comparison from accumulator = data in cell operand. Both must be numeric. |
| 11 | SPB | Jumps to cell operand if comparison true. Only validate the target on a taken branch. |
| 12 | VGR | Sets comparison from accumulator > data in cell operand. Both must be numeric. |
| 13 | VKL | Sets comparison from accumulator < data in cell operand. Both must be numeric. |
| 14 | NEG | Maps `00.000` to `00.001` and vice versa. Other accumulator words cause F005. Conventionally operand 000. |
| 15 | UND | Boolean AND of accumulator and data in cell operand. Both must be `00.000` or `00.001`. |
| 16 | P1E | Reads P1 terminal(s) into numeric accumulator. Release the selected P1 latch bit, or all bits for parallel input, before sampling. |
| 17 | P1A | Writes P1 terminal latch. |
| 18 | P2A | Writes base PB terminal(s). |
| 19 | LIA | Reads cell operand's low byte as a second address and loads the full word at that address. |
| 20 | AIS | Reads cell operand's low byte as a second address and stores the full accumulator there. |
| 21 | SIU | Reads cell operand's low byte as a second address and jumps to it. |
| 22 | P3E | Reads CP3 PB terminal(s) into numeric accumulator. |
| 23 | P4A | Writes CP3 PA terminal(s). |
| 24 | P5A | Writes CP3 PC terminal(s). |

For HLT, ANZ and NEG, tested nonzero low operands behaved as the conventional zero. The nonzero high byte of an indirect pointer word is ignored. A valid non-taken SPB preserves the normal next address even when its stored target is outside installed memory. ADD/SUB leave the accumulator unchanged on range error. Known LDA/ABS and logic behavior are acceptance requirements even for self-modifying teaching code.

For ports, operand 000 reads or writes the whole terminal group as the ordinary binary representation of a byte. Whole-port outputs use the accumulator's low byte. An operand 001–008 addresses the matching terminal and preserves other output latch bits. Single-terminal reads put `00.000` or `00.001` into the accumulator. Single-terminal writes use zero vs nonzero in the low byte as the output bit and preserve the accumulator. The manual presents 0/1 as the single-terminal domain, but the observed 2716 accepts other low-byte values.

P5 implements only six physical bits. The valid teaching range for parallel P5 is 000–063 and for single-terminal P5 it is 001–006. The measured 2716 masks off the upper two bits on a parallel write, and operands 007/008 have no physical effect. Port operands above 008 fail with F005 on all port commands. In base configuration 22–24 still decode, reads see the unpopulated bus as high in the digital model, and the absent CP3 outputs have no accessible effect. Do not alias a CP3 output to a base port.

| Error | Trigger and state |
| --- | --- |
| F001 | Wrong number of entered digits for the selected monitor command, or a sixth digit. |
| F002 | Executed word high byte is 00 or 25–255. Retain the failing cell as PC. |
| F003 | Executed instruction needs a cell beyond installed capacity, or a non-HLT instruction falls through beyond the final cell. Program stops. An invalid direct data address or invalid LIA/AIS target leaves PC on the failing instruction. A jump to an uninstalled target shows that target as PC. A sequential fallthrough shows PC 128 in the base system and wraps the visible CP3 PC to 000. |
| F004 | Keypad address out of bounds, invalid five-digit word field, or resumed OUT beyond the final cell. |
| F005 | Arithmetic or comparison uses a nonnumeric input, NEG or UND gets a nonboolean input, or a port index is invalid. Program stops at the failing instruction. |
| F006 | Numeric ADD overflows or numeric SUB underflows. Program stops at the failing instruction with the pre-operation accumulator intact. |
| F007 | Invalid cassette reception. Assigned only to the separate cassette milestone. |

PC and ACC are available after teaching errors. A fresh command from the monitor can recover without a reset. Preserve memory and terminal output on failed non-I/O teaching commands. Successful teaching instructions may self-modify code by writing teaching RAM. A direct or indirect jump uses the target selected by that instruction before fetch resumes.

## 5. Timing and acceptance

For orientation, the printed manual describes VZG `n` as `n` milliseconds. With historical 2716 firmware on the nominal 6 MHz cycle-accounted model it takes about 1.12 ms per operand unit in a representative toggle program, plus the surrounding interpreter work. A deterministic replacement should retain that scale, so an existing physical blink or timer exercise remains recognizable. Measure repeated stable terminal edges with a monotonic machine-cycle counter or logic analyzer. A 40 ms display integration window can mix rapidly changing numeric frames and must not be used to time individual edges.

The black-box reference was a 2,048-byte 2716 image from the museum archive, SHA-1 `ff4befcf82a664950186d3af1843fdef70d2209f`. It was run as an opaque input on the cycle-accounted CP1 model. Each sample measured successive P2.0 transitions from repeated two-state half-cycles, each containing one VZG. At 6 MHz the observed representative intervals were about 1.0 ms (000), 2.1 ms (001), 12.2 ms (010), 57.2 ms (050), 113.4 ms (100), 225.7 ms (200), 287.5 ms (255). For a replacement on this model, a reasonable gate is 0.3–2.5 ms for 000, 10–15 ms for 010, 105–122 ms for 100, and 216–236 ms for 200 in a blink loop. An earlier independent comparison reported fourteen changes for its 200-delay loop, with 225.59–226.00 ms between changes. The two callback conventions in that comparison differed by 5 µs in absolute timestamps. Relative edge intervals are the time metric.

### Original acceptance scripts

Start each scenario with a powered machine or a reset fixture, allow 150 ms for startup, set any needed pin inputs, and initialize specified cells explicitly. Use physical key events for all monitor actions. Test setup may populate teaching RAM by its public physical-memory interface as an alternative to typing every word. Decode the six display masks after 40 ms of steady observation. On actual hardware validate drive levels or fit LED resistors and observe the terminal values. As a separate reset check, fill every cell with a nonzero test word, reset the CPU, and require a stable `P  000` and every installed cell zero.

1. **Entry, read, replace, single step.** Type `012 INP 04068 INP 01000 INP 9 OUT`. Expect `C  014`. Type `012 OUT`, expect `C04068`. Type `04073 INP 012 PC STEP`, expect `P  013`. `ACC` yields `A00.073`, then `STEP` yields `P  014`. Verify raw cell bytes `04 49` at cell 012's two byte offsets. `1 INP` yields F001 and `260 OUT` yields F004.
2. **Display, stop, and resumption.** Put `04.061 02.000 09.001` in cells 000–002, then `000 PC RUN`. Expect steady `A00.061`. After `STP` expect `C04.061`. `ACC` still gives `A00.061`. Resume with `RUN`, observe `A00.061` again, and stop.
3. **Bit-level signal path.** Cells 000–002 contain `16.008 18.004 01.000`. Pull P1 terminal 8 low and run from 000, then verify P2 PB `0xF7` and `A00.000` after ACC. Release the pin, set PC to 000 and run again. Verify P2 PB `0xFF` and `A00.001`. For a parallel path, run original words `16.000 06.039 18.000 01.000` with P1 driven `0xB2`. Expect cell 039 = `00.178` and P2 = `0xB2`.
4. **Arithmetic and error PC.** With cell 050 = `00.009`, run `04.249 07.050 01.000` at 000. Expect F006, `PC` displays `P  001` and `ACC` displays `A00.249`. Replace first two words with `04.007 08.050` and repeat, expecting F006 and `A00.007`. Replace cell 050 with `04.009` and repeat, expecting F005.
5. **Compare, indirect and full words.** Install `19.070 20.071 04.039 10.072 11.006 00.000 01.000` at 000–006. Set cell 070 = `04.080`, 071 = `00.081`, 072 = `00.039`, and 080 = `09.023`. Expect cell 081 = `09.023`, final PC 007, and accumulator `00.039`. Replace 072 by `00.040`, restart at zero and expect F002 at PC 005. Separately confirm VGR and VKL using values on either side of 39.
6. **Expansion and bounds.** Install `09.128` at 000. With CP3, type `128 INP 22000 INP 23000 INP 24000 INP 01000 INP`, drive all P3 bits to `0x25`, and run from 000. Expect P4 and P5 `0x25`, and `P  132` after halt. Confirm bytes at offsets 0–7 of CP3 RAM, that base cell 000 is still `09.128`, and that a single-terminal P5 write can set and clear terminal 6. On base hardware the same jump from 000 causes F003, and `128 INP` fails with F004. At the final installed cell, verify that two successive stores both target that cell and that OUT after reading it yields F004.
7. **Blink and delay.** At cells 000–006 put `04.000 18.003 03.200 04.001 18.003 03.200 09.000`. Begin observing output after startup. `000 PC RUN` must produce repeated alternation `0xFB / 0xFF`, keeping the other P2 bits high. Assert successive edges over at least four transitions using the 200-delay range above. STP must stop further edges and produce `C04.000`. Under a delay of 255, a 40 ms STP pulse during the delay must halt before the next programmed output write and take effect no later than completion of that delay plus one frame. Repeat with VZG 000 and VZG 010 to check short delays.
8. **Physical contact and range behavior.** Drive each of the physical numeric buttons separately in idle and verify the corresponding digit echo. Hold one contact for 250 ms and require a single digit. For every teaching input line, toggle that pin externally and verify a single-terminal read. For every teaching output line use `AKO 000` and single-terminal output to clear it, then `AKO 001` to set it, holding other latch bits fixed. Also exercise line indices 009 and 255 and check F005.
9. **Numeric boundaries and boolean operations.** Set cell 064 to `00.001`. Execute `04.254 07.064 06.065 08.064 06.066 04.000 14.000 15.064 06.067 01.000` at 000. Cells 065, 066, and 067 must finish as `00.255`, `00.254`, and `00.001`. Change 064 to `00.002`, then use PC and STEP to execute just UND at 007 with the prior accumulator. Expect F005 and accumulator `00.001`.
10. **Indirect jump and self-modifying word.** Set 073 to `05.010`, 074 to `09.015`, 010 to `00.000` and 015 to `01.000`. Put `05.074 06.010 21.073` at 000–002. With a single STEP for each word, confirm the accumulator is `09.015` and cell 010 becomes `09.015`. The third STEP shows `P  010`, the fourth shows `P  015`, and the fifth shows `P  016`. This covers both direct and indirect execution of words prepared at runtime.

## 6. Separate cassette milestone and compatibility limits

CAS means memory-to-tape and CAL means tape-to-memory with the CP2, as documented on the original CP1 card. F007 describes invalid tape data. They require a separate CP2 protocol milestone covering connection variants with and without CP3, physical signal polarity, framing, checks, buffering, interruption and persistence. The initial monitor needs a safe no-CP2 behavior for both keys that preserves teaching RAM and ports and leaves the user able to return to the monitor. Historical cassette pulses, error recovery and all data transfer require dedicated verification with hardware or an independent waveform fixture.

The historical observations here qualify a single known 2716 image and an instruction-cycle model. They establish neither mask-ROM revision equivalence nor analog TTL behavior. Unless required by an acceptance script, implementation choices include internal state layout, exact instruction/interrupt schedule, stable row cadence within the stated display/keyboard limits, ordering of simultaneous contacts, formatting externally injected high word bytes greater than 99, and behavior during an interrupted cassette transfer. Built-in self-test and reaction test can be evaluated separately from teaching programs, using their stated user-visible behaviors.

## 7. Intel knowledge needed to assemble the monitor

The reset vector is `0x000`; the external interrupt vector is `0x003`; the timer interrupt vector is `0x007`. With the external interrupt unused it may remain disabled. The timer advances once per 32 machine cycles, so one timer increment corresponds to 80 µs at 6 MHz. Overflow is `0xFF → 0x00`; the timer interrupt is enabled independently of starting the timer. Use `RETR` for an interrupt return. `RETR` restores the stacked PSW flags and register bank in addition to the return address, but working A, registers and I/O latch values still need explicit preservation where used. Ordinary `RET` returns without restoring those PSW flags.

The two eight-register banks occupy internal RAM 0–7 and 24–31. The hardware stack occupies RAM 8–23. Internal indirect operations use `@R0` and `@R1`. MOVX uses all eight bits in R0 or R1 as the outside address. `IN A,P1` and `IN A,P2` sample physical pins. CPU port bitwise immediates act on the latch, useful when releasing selected bits of quasi-bidirectional P1.

Standard MCS-48 `JMP` and `CALL` can reach within the 2 KiB program bank. Conditional branches, `DJNZ`, `MOVP A,@A`/page tables, and `JMPP @A` use the page after opcode fetch. Keep page branches, inline tables and their selected targets within the intended 256-byte page and avoid the last-byte boundary distinction. `MOVP3` reads page 3 of the current bank. Base code must assemble into 0x000–0x7FF. Test the image produced by the assembler, and publish reproducible source/build instructions.

## 8. Sources and observation method

- Franckh/Kosmos, *Computer-Praxis*, first edition (1983), §1.4–1.30 for panel usage and arithmetic, §1.54–1.65 for I/O and indirect access, §1.69–1.71 for diagnostic usage, §1.80 and figure 109 on p. 137 for system electronics. [Kosmos CP1 manual](https://manualzz.com/doc/62077556/kosmos-cp1-benutzerhandbuch)
- Kosmos's original two-page insert for the keypad, teaching opcodes, and F001–F007. [CP1 quick reference scan](https://www.8bit-homecomputermuseum.at/computer/pictures/kosmos%20computer%20praxis%20cp1/cp1_schnelluebersicht.pdf)
- Kosmos CP3 manual, especially pin drawings, installation and pp. 6–7 port behavior. [CP3 manual scan](https://www.8bit-homecomputermuseum.at/computer/pictures/kosmos%20computer%20praxis%20cp1/cp3_anleitung.pdf)
- Kosmos CP2 manual for the cassette interface and its connection variants. [CP2 manual scan](https://www.8bit-homecomputermuseum.at/computer/pictures/kosmos%20computer%20praxis%20cp1/cp2_anleitung.pdf)
- Intel Family User's Manual for reset, timer, instruction timing, I/O and 8155 interfacing. The instruction reference gives encodings and branch/page constraints. Intel's 8155H sheet gives alternate function and PIN modes. [Intel MCS-48 family manual](https://bitsavers.trailing-edge.com/components/intel/8048/9800270D_MCS-48_Family_Users_Manual_Jul78.pdf) · [Intel MCS-48 assembly language manual](https://bitsavers.trailing-edge.com/components/intel/8048/9800255D_MCS-48_and_UPI-41_Assembly_Language_Manual_Dec1978.pdf) · [Intel 8155H data sheet](https://pccomponents.com/datasheets/INTEL-P8155H-2.pdf)
- Opaque reference experiments on the named 2716 image used only simulated clock advancement, keypad events, segment observations, publicly exposed teaching RAM and external terminal changes. Earlier cross-engine uncertainty and measured cycle conventions are described in the project's hardware observation material. No program-address traces or internal state of the historical image were used in this contract.

## 9. Debugger interoperability

Publish your own build symbols for a pre-command boundary (teaching PC still names the next word), a monitor idle boundary and an error-ready boundary. Publish teaching-PC RAM address, both accumulator byte RAM addresses, optional comparison RAM address/bit mask, and any display/error buffer addresses plus masks needed for an observer to identify the current error code. Any layout is permitted if the symbols document it. The debugger consumes the independently built image and its own symbol map and observes the very same executing CPU. The ROM must handle all keypad, memory and I/O behaviors with the debugger detached.
