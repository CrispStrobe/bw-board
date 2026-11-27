# Brickwright Microtronic TMS1600 monitor

Choose **TMS1600** on a Busch Microtronic 2090 in Circuits Instruments. The
selection is stored with the trainer and travels with the circuit. Existing
files use the behavioral mode unless a trainer selects TMS1600. The
**Open wired I/O example** button preserves the selected mode.

## ROM and execution

[TMS1600 monitor source](../src/microtronic-native-monitor.js) assembles to
4096 bytes in physical ROM address order. The native CPU fetches and executes
those bytes, including the learner instruction decoder, monitor commands,
keypad processing, display, flags, and port I/O. The circuit host supplies
external program RAM, key and terminal input levels, and one permission per
scheduled learner instruction during RUN. The host owns the circuit clock,
including the independent 1 Hz terminal. STEP executes through the same ROM.

Build the ROM and its versioned, hash-qualified symbol map with:

```sh
node scripts/build-microtronic-native-rom.mjs /path/to/microtronic-native.rom
```

The first revision uses an instruction-level standard-decode TMS1600 and a
[simulated pin protocol](MICROTRONIC-NATIVE-PINS.md). The [original board
wiring](MICROTRONIC-NATIVE-CONTRACT.md) is documented separately. This ROM targets
Brickwright's simulated peripherals. Operation on a stock 2090, the original
output PLA and electrical bus, and cycle-by-cycle equivalence remain
unqualified. PGM 0, 1, 2 and 7 report unavailable. PGM 3/4 set and show the
clock. PGM 5/6 fill program RAM. Connect CLOCK to IN4 for timekeeping.

## Independent authorship and checks

The firmware author received the [behavioral contract](MICROTRONIC-NATIVE-CONTRACT.md)
and Brickwright's CPU and assembler interfaces. The author worked in an
isolated directory without access to the historical firmware or emulator
source. CPU implementation used the TI [programmer's reference](https://www.citylan.it/images/e/ee/TMS1000_series_programmer%27s_reference_manual.pdf.pdf)
and [MicroSystems Designers Handbook](https://www.blunham.com/Misc/Texas/Software990/MicroSystemsDesignersHandbook.pdf).

The integrator separately exercised the [historical ROM browser emulator](https://www.michael-wessel.info/emulators/microtronic/index.html)
with the wired echo and selected program files from [Busch-2090 at fbd520c](https://github.com/lambdamikel/Busch-2090/tree/fbd520cef92150ac5b2859b78c8c9a528535cc93/software).
The echo agreed on learner PC and output across three steps with IN1 high.
The first ten steps of HELLO and the first two of CALC agreed on PC, flags
and output. In POWERS, entering 3 into KIN stored 3 in working register 6
in both. The historical display reported PC 03 while waiting for the key,
and this monitor held PC 02 until accepting the key. Working F was initially
F in the sampled browser runs and 0 after a Brickwright reset. The remaining
programs and later interactions need further qualification. Historical ROM,
emulator implementation and program files stay outside the shipped source
and ROM.
