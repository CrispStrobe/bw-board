# Independent Kosmos CP1 monitor

This monitor is an original 2 KiB Intel 8049 program for the base CP1 and CP3. It uses the existing 8049 and 8155 devices for instruction execution, display, key contacts, timing and terminal I/O. It implements the 24 teaching instructions and the original keypad controls. Startup and CPU reset clear installed teaching RAM. Load the program once the monitor displays its ready PC.

## Build and use

From the bw-board checkout:

```sh
python3 firmware/cp1/build.py --output build/cp1
node scripts/generate-cp1-monitor-profile.mjs build/cp1
node scripts/check-cp1-semantic-rom.mjs build/cp1/cp1-monitor.bin
```

Import `build/cp1/cp1-monitor.bin` with the CP1 panel's existing ROM import. The build uses Python 3 and its standard library. The image is exactly 2,048 bytes and has SHA-1 `8ce0bebe5e99799043e8d0074847c15d6461a712`. The matching versioned debugger profile is derived from the new build's symbols and keyed to this image. The historical 2716 keeps its separate profile. Unrecognized bytes use the raw 8049 debugger.

## Independent authorship

A research author collected original hardware documentation and factual observations from an opaque museum EPROM image on the independent machine. Their [contract](CP1-FIRMWARE-CONTRACT.md) was the implementation author's only CP1 input. The implementation worktree started from an empty tree, with no historical firmware, manual program, emulator implementation or inherited conversation. The validator used a separate worktree and supplied observed mismatch facts after testing the first binary. The implementation author's local source commit was `d65fd9b`.

The contract's initial 8155 Port C mode was corrected against the Intel device interface and target execution before qualification. A separate black-box test found that HLT clears the comparison condition on the 2716. The implementation author corrected that behavior from the test observation.

The 2716 image and historical manual transcriptions are external validation inputs. The build and runtime use only our source. The oracle harness reads a caller-supplied historical image and optional listings, and records hashes, observed display masks, terminal states and changed-cell hashes. Only independently authored programs are intended for the gallery. The historical material remains outside the source tree and release artifacts.

## Comparison

```sh
node scripts/check-cp1-firmware-compat.mjs \
  --oracle /path/to/2716.bin --candidate build/cp1/cp1-monitor.bin \
  --sb3-creator /path/to/sb3-creator --circuit-ui /path/to/bw-circuit-ui \
  --electrical --manual /path/to/external/listings --manual-steps 8 \
  --report /path/to/comparison.json
```

The four existing Brickwright examples, keypad and monitor probes, and CP5 circuit have executable acceptance checks. The optional external listing corpus uses ordinary keypad RUN with a fixed set of input changes, then a separate run of eight physical STEP presses. The fixed-time comparison records display, terminal and RAM differences. Historic analog fixtures, external wiring, full operator interactions and all possible program paths require separate exercises. Manual-listing differences remain in the report. The two ROMs execute on the same simulator, so the comparison measures functional behavior and simulated timing.

The comparison with the museum's 2716 image passed all four gallery examples, 14 monitor scenarios, 13 CP5 electrical patterns and 11 semantic debugger scenarios. The five observed blink edges yielded half-periods of 224.713–225.532 ms on the new monitor and 225.590–225.995 ms on the 2716. The CP5 startup output-clear interval was 225.528 ms on the new monitor and 226.057 ms on the 2716. Display refresh was 148.86 frames/s on the new monitor and 65.08 frames/s on the 2716, with all six rows active in both.

Both built-in diagnostic modes ran in a spot check. With identical keypad timing, the `9 RUN` display test settled at 000000 by 2.0 seconds after CPU start on the replacement and by 6.4 seconds on the 2716. The two `8 RUN` reaction tests began counting at different times and both stopped on STP.

All 50 external files assembled or loaded and executed on both images. The first eight physical steps matched on all 50, for 400 checkpoints across the corpus. The fixed simulated-time screen, terminal, or changed-memory observations differed on 16 files. They were listings 001, 006–008, 019, 025, 027, 029, 031, 036, 038, 042, 045, 052, 093 and the bonus 100. The comparison consumed external transcriptions at revision `12615440aed49347b01e55769d652100a72e1369`. Matching these short step traces establishes the sampled behavior. Cycle timing, timing-sensitive exercises and complete historical workflows remain partially qualified.

CP2 transfer and F007 need a separate cassette milestone. CAS and CAL clear the panel and return safely to the monitor. Physical hardware timing and mask ROM B are outside this qualification.
