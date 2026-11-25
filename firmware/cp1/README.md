# CP1 and CP3 monitor ROM

This is an independent monitor for the 6 MHz Intel 8049 and base or expansion 8155 hardware. It accepts physical key presses, multiplexes the six display digits, and interprets the 24 teaching instructions on the 8049. Startup detects CP3 and clears all installed teaching RAM. Load teaching programs after startup.

## Build

Run `python3 build.py` in this directory. Python 3.8 or later and its standard library suffice. The build produces a 2,048-byte binary, its SHA-1, and a debugger symbol manifest in `build/`. Use `--output DIR` for a different destination. The generated files are derived from `monitor.asm` and are excluded from version control.

The assembler resolves labels in two passes and checks image bounds, overlapping sections, branch pages, and dispatch-table pages. `LD` and `ST` in the source expand to loading an internal address in R0 followed by an indirect load or store. The rest of the executable source uses the Intel MCS-48 instruction set.

## Debugger

`cp1-monitor.symbols.json` pairs the ROM SHA-1 with the following addresses.

| Field | Meaning |
| --- | --- |
| `pre_command` | ROM address before the next teaching fetch, after checking for STP |
| `monitor_idle` | ROM address where the keypad monitor waits for a press |
| `error_ready` | ROM address reached after writing the complete error frame |
| `teaching_pc`, `accumulator_high`, `accumulator_low` | Internal RAM addresses for the teaching state |
| `comparison`, `error` | Internal RAM addresses and value masks |
| `display` | Internal RAM location of the six left-to-right segment masks. The third digit's dot is wired externally. |

The firmware uses the 8049 timer interrupt to select one digit and sample one keypad row about every 1.12 ms. The same tick advances teaching delays. Register bank 1 belongs to the interrupt handler, and the foreground uses bank 0. The interrupt handler restores the CPU P2 bus selection before returning.

## Cassette keys

CAS and CAL clear the panel and return to keypad monitoring. CP2 tape transfer and F007 require the separate cassette milestone.
