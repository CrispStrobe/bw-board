# Kosmos CP2 cassette contract

This is the cassette supplement to the independent CP1/CP3 monitor contract. Implement CAS and CAL as real 8049 operations on the original P1 pins. The digital interface transfers canonical teaching RAM. The CP2 module converts digital levels to and from audio, so the 8049 does not generate or sample the carrier directly. A test harness or host may model the CP2 interface by attaching to those pins and scheduling levels on the machine clock.

## CPU-side connection and controls

| CP1 terminal | 8049 signal | Behavior |
| --- | --- | --- |
| Port 1 terminal 7 | P1.6, mask `0x40` | Direction, high for CAS transmit and low for CAL receive |
| Port 1 terminal 8 | P1.7, mask `0x80` | Digital data, driven by the 8049 for CAS, released high in the 8049 latch for CAL |
| 0 V | Ground | Shared digital reference |

Keep P1.0–P1.5 and unrelated ports intact through cassette operations. Preserve normal quasi-bidirectional P1 semantics. External CP2 reception can pull P1.7 low only when its latch is released. The CP2 slide switch connects the two cassette pins in its left position and disconnects them in its right position. The same P1 terminals carry both directions with a CP3 installed, via the connection drawn in the CP3 manual. There are no cassette transfers through CPU P2, keypad rows, test pins, or an 8155 user-terminal port.

From the idle monitor, CAS enters save mode and CAL enters receive mode. Transfer proceeds independently of the teaching PC and the entry/read pointer. CAS reads all installed teaching RAM, even blank cells. CAL replaces bytes as it receives them. STP cancels an active transfer and returns control to the monitor. Keep the display refreshed and accept a 40 ms STP closure throughout the leader, data and receive waiting periods. Allow up to one second from STP to the final stable status. The 2716 showed save termination about 130 ms after an early-leader STP and about 720 ms after a tested STP during data. On CAL without edges, STP gave the abort glyph on either held input level, with longer response on low. No CP2 presence line is documented. CAS emits its digital waveform even with the module disconnected.

### Panel states

In these states all positions other than the first are segment-blank, with the fixed separator still visible. Segment codes follow the CP1 firmware contract.

| State | Six masks in left-to-right order |
| --- | --- |
| Active CAS, including leader | `23 00 80 00 00 00` |
| Active CAL, including waiting for tape | `1C 00 80 00 00 00` |
| CAS completed or aborted in the opaque 2716 test | `63 00 80 00 00 00` |
| CAL completed in the opaque 2716 tests | `5C 00 80 00 00 00` |
| CAL aborted without input in the opaque 2716 test | `5C 00 80 00 00 00` |
| Invalid CAL | `71 00 80 3F 3F 27`, F007 |

The manufacturer depicts the completion state after both save and load as a four-segment outline. The measured 2716 emitted distinct save and load termination masks as listed where observed. Prefer measured glyphs for the 2716-compatible implementation. The 2716 CAS ends with P1.7 low and P1.6 high; the latter is the last direction setting. CAL sets P1.6 low and releases P1.7; keep this setting at completion or abort. CLR returns from the status displays to a blank frame with the separator.

## Digital stream

All timings here are CPU pin timings at a 6 MHz oscillator (400,000 machine cycles/s). Audio FSK converts digital high to the lower f1 carrier and digital low to higher f2. The digitized real recording measured about 984 Hz for f1 and 2250 Hz for f2; unit and recorder speed alter these frequencies.

1. CAS sets direction and holds data high for an approximately 16.5 second leader. No bytes are encoded in this high plateau.
2. The first falling edge starts bit 0. Every bit has a low interval then a high interval. The next falling edge ends the previous bit and, except for the last bit, starts the next one. A bit value one has a short low and long high interval. A bit value zero has a long low and short high interval.
3. The nominal short interval is 33 ms and the nominal long interval 66 ms. The physical recording gives approximately 35 and 65 ms. The total is close to 100 ms. Decide the bit by the relative high and low duration on that bit, allowing for tape speed variations. Absolute timings can reject implausible noise or missing transitions.
4. Each byte is sent low bit first. No inter-byte gaps, UART start or stop bits, sync bytes, length bytes, parity, checksum, end marker word, or gaps between two installed blocks were present in the captured save. The falling edge after the high portion of the final data bit closes the last symbol, and then P1.7 remains low.
5. A base machine sends 256 bytes (2,048 bits, 128 cells). A CP3 machine sends 512 bytes (4,096 bits, 256 cells), base block first, CP3 block second. Within each 256-byte 8155 RAM block the physical byte offsets on the wire are `0, 255, 254, …, 1`. After offset 1 of the base, the CP3 case continues immediately with offset 0 of the expansion. The in-memory word remains opcode byte at even offset and operand byte at odd offset. For example the beginning of each tape block carries the first cell's opcode, the last cell's operand and opcode, then the preceding cell's operand and opcode.

The original manual's conceptual diagram partitions symbols at a rising edge and draws the high portion before the low portion. Byte-exact recovery of opaque 2716 digital output agrees with the published real-recording protocol when partitioned at falling edges using the timings above. Do not translate the manual's illustrative diagram directly into a serializer.

### Measured reference and acceptance limits

The opaque 2716 reference image, SHA-1 `ff4befcf82a664950186d3af1843fdef70d2209f`, was run at 6 MHz on the cycle-accounted board model. Original nonuniform images were seeded into all teaching RAM after startup. Capture began with P1 latch `0x2C` and sampled actual P1 latch changes with cycle timestamps. The save set the latch to `0xEC` during high periods and `0x6C` during low periods. Base CAS produced exactly 4,098 latch changes and CP3 CAS produced 8,194, including the initial high and final falling edge. The leader was 16,529.03 ms for both. Total time from initial high to final falling edge was 219,748.72 ms on base and 424,275.71 ms on CP3. Across both captures the short intervals were 32.88–33.58 ms, long intervals 65.95–66.84 ms and complete bit intervals 99.05–100.13 ms. Classifying the intervals as stated recovered all 256 base bytes and all 512 CP3 bytes exactly. Small cycle-level jitter is outside acceptance.

Recommended target limits for a fresh implementation are 16–17 s high leader, 30–40 ms short and 60–72 ms long portions, and 93–110 ms per complete bit under CAS. Ordinary CPU stepping or browser rendering rate must not stretch measured simulation time. A carrier generator or tape decoder outside the CPU should use the machine clock and preserve all edges under different slice sizes. A pulse-based harness can drive only P1.7 through the real P1 input boundary. For example, apply a driven mask of `0x80` and a value of `0x00` or `0x80` at the measured edge cycles. CPU writes, not separate host command interception, control direction and save data.

## Receive behavior and corruption

CAL may be armed after the leader has already started. Valid input is a high leader followed by the first falling edge and the configured payload. Leave the pin available for external input through reception, and sample its physical value. Full replays of the captured streams into fresh 2716 sessions recovered every byte on base and CP3, with final glyph `5C` in both. Holding the line high through CAL key entry and for 250 ms after release was sufficient for a second complete base replay. The 2716 also received the first byte when the first falling edge arrived immediately after release of a 40 ms CAL closure, with the input already high during key entry. A useful acceptance setup is to hold the input high through CAL key entry and for 250 ms after release. Do not require acquisition of the full original 16.5 s lead after the CAL press.

The falling edge that ends the final high interval is required. Replaying the full base waveform with just that edge removed produced F007 and left the last received byte unmodified, with all previous 255 bytes intact. A CP3 receiver requires both blocks for success. A base receiver completes after its configured base block and returns to the monitor while the recorder may still be playing. Independently generated base streams at exact 35/65 ms and at 84% of those durations both loaded byte for byte. These tests qualify the two timings without establishing the receiver's maximum speed range.

The documented F007 is an invalid input indication. There is no end-to-end checksum in the save stream and CAL accepts raw eight-bit data at either byte position. Well-formed encodings of `0xFF` at offset 0 and `0x19` at offset 254 were stored in their opcode locations, with CAL still active during subsequent valid bits. If an input stream stops during data, present F007 after an edge timeout and allow the user to recover with CLR or another monitor action. Tested loss of a low-to-high or high-to-low transition produced F007 about 0.6 s after the held condition began. A practical timeout range for the replacement is 0.5–0.75 s during data, with a one-second acceptance observation window. The observed 2716 received six whole bytes before a deliberately truncated capture, kept those bytes and left the next byte unchanged. One injected 0.25 ms pulse during data was interpreted as part of a corrupted bit sequence, illustrating that pulse rejection is limited. Preserve RAM outside the installed address range. Never treat an incomplete image as a successful CAL.

## Acceptance through the real pins

1. **Save exact image.** On base and CP3, seed every installed cell using a nonuniform test pattern with different valid opcode and operand bytes. Set a nonzero teaching PC and a distinct entry/read pointer. Start CAS with a physical 40–50 ms press. Capture P1.6 and P1.7 from before the press until after completion. Confirm the leader, slot shapes, block order, byte count, final edge and success glyph. Check that every decoded bit matches seeded RAM, that unrelated P1 bits stay constant, and that the teaching RAM is unchanged.
2. **Receive independently encoded image.** Start CAL via the real key matrix with data high. Drive only P1.7 through the source boundary. Feed a newly constructed valid 256-byte base stream and 512-byte CP3 stream, with distinct sentinels at offsets 0, 1, 254 and 255 in both blocks. Use 35 and 65 ms synthetic intervals and verify the entire received RAM image. Repeat with a uniformly speed-shifted image to check ratio-based decoding. Return to the monitor via CLR and read sentinel cells through OUT.
3. **Abort and missing input.** Press STP during the CAS leader, after real data edges begin, and during CAL waiting. Observe the corresponding terminal glyph and suppression of subsequent CAS edges. Idle CAL keeps the panel responsive when the tape is disconnected. Abort a CAL after it has accepted part of an image; no completed indication may be invented before the complete installed frame.
4. **Corruption.** Drive a legal beginning and then truncate during data. Expect F007 with already completed bytes retained and the rest of RAM unchanged. Verify that the monitor can handle CLR, PC and a new cassette operation after error. A well-formed bit flip changes the received value without an integrity error. Include a byte above `0x18` at an opcode offset to confirm CAL moves raw bytes.

## Evidence and limits

- Kosmos CP2 operating instructions, sections I–V, digital timing diagram, connector drawing, and transfer/error behavior. The scan contains connection drawings and a frequency/level diagram. Internal analog circuitry and thresholds are outside this contract. [CP2 operating instructions](https://www.8bit-homecomputermuseum.at/computer/pictures/kosmos%20computer%20praxis%20cp1/cp2_anleitung.pdf)
- Kosmos CP3 installation drawing, figure 3, for where the cassette module connects when CP3 is fitted. [CP3 operating instructions](https://www.8bit-homecomputermuseum.at/computer/pictures/kosmos%20computer%20praxis%20cp1/cp3_anleitung.pdf)
- Published digital waveform and byte ordering recovered from a genuine CP2 recording, plus reported digital round-trip. Only the factual description was consulted. [Cassette format at toolchain revision 7d8287f](https://github.com/lambdamikel/kosmos-cp1-devel-toolchain/blob/7d8287f/README.md#the-cassette-format)
- 2716 supplemental measurements came from public keypad, pins, display, teaching RAM and cycle count. Real CP2 analog amplitude, settling, recorder behavior, and other firmware revisions require separate physical validation.
