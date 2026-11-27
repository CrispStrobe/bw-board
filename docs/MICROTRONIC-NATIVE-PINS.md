# Cleanroom Microtronic monitor virtual pins

The 4,096-byte ROM requires the identity output PLA. The board supplies the low four K bits and observes O and R. Use a 256-word by 12-bit SRAM on the board side and retain it across the CPU reset. The first frame is published about 500 native instructions after reset.

## Virtual pin operations

A set R selector defines the operation. Read K while that selector is high. For a write, capture O on the selector’s rising edge. O uses its low nibble unless the table specifies a wider value.

| R selector | Board operation |
| --- | --- |
| R0 | Return the current key code on K |
| R1 | Return key kind on K, with 0 for released, 1 for hex and 2 for function |
| R2 | Return the four external input terminals on K, with terminal 1 in bit 0 |
| R3 | Latch the four output terminals from O, with terminal 1 in bit 0 |
| R4 | Latch the high SRAM address nibble from O |
| R5 | Latch the low SRAM address nibble from O |
| R6, R7, R8 | Select the SRAM instruction’s opcode, first operand or second operand, respectively. Read it on K when R9 is low and write O when R9 is high. |
| R9 | Qualify SRAM writes while high |
| R10 | Latch the display position from O, 0 through 5 from left to right |
| R11 | Latch the display position’s digit from O, 0–15 for hex, 16 for blank and 17 for dash |
| R12 | Latch flags from O, with C in bit 0 and Z in bit 1 |
| R13 | Latch status from O, with active RUN or STEP in bit 0, KIN wait in bit 1 and unavailable PGM function in bit 2 |
| R14 | Commit the completed display and status frame |
| R15 | Count one guest instruction retirement when R0 is low |
| R0 and R15 | Supply a RUN execution token on K. Any nonzero value grants one dispatch attempt. |

The ROM polls R1 once per display frame. Expose a released poll between distinct key presses. Key values for hex are their nibble values. Function codes 0 through 8 are RESET, HALT, NEXT, C/CE, RUN, STEP, REG, BKP and PGM.

For continuous RUN, hold the token until an R15 retirement or a completed frame indicating a new KIN wait or a breakpoint stop. STEP bypasses the token gate. KIN completes when a fresh hex key is accepted and retires at that point. A continuous RUN encountering a breakpoint stops before executing the selected word. Every retired instruction, including F00 in RUN, is followed by a completed frame.

To clock the simulated patch from Clock to Input 4, supply a one-second rising edge on DIN bit 3 and allow the monitor to sample the low level between edges. PGM 3 sets hours and minutes. PGM 4 shows the live clock. F06 snapshots the clock. F05 uses a deterministic 12-bit pseudorandom generator.

PGM 0, 1, 2 and 7 signal unavailable through R13 bit 2. The next accepted key or reset clears that indication. Cassette I/O, the built-in board test, the original Nim program and the physical signal mapping remain outside this virtual pin interface.

## Debugger layout

Guest PC uses address low in native RAM 00 and address high in native RAM 01. Flags reside at 02. The sixteen working registers occupy 20–2F and the sixteen memory registers occupy 30–3F. These addresses are available through the module’s `microtronicNativeMonitorLayout` export. The guest SRAM bus and pin callbacks operate independently of the debugger layout.
