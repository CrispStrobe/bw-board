# Optional CP1 firmware oracle check

Run `node scripts/check-cp1-oracle.mjs /path/to/monitor.bin /path/to/reference.cjs report.json`.
Both input files are external. This repository distributes neither the historical
ROM nor the reference emulator. The reference module must export its public
`KosmosCP1` class; the harness supplies newly authored test programs and physical
key events and compares resulting CPU registers, RAM cells and port observations.

The implementation writers did not read the reference source. The research/oracle
agent used the GPL reference at <https://github.com/lambdamikel/kosmos-cp1-emulator>
only outside the source tree. The emitted report records the exact external
module's SHA-256 and the firmware SHA-1, so an observation is tied to input bytes.
It does not establish a license grant for either input.

The committed [observation](CP1-ORACLE-OBSERVATION.json) contains ten original
scenarios: steady 42 and 73 displays, low/high switch inputs, arithmetic overflow
and underflow, an equality branch, the seven-cell blink, CP3 ports, and a jump to
CP3 program cell 128. All comparisons passed for the named 2716 firmware image.
The steady 42 display and F006 error also have explicit segment expectations.

The blink produced fourteen alternating Port 2 values (254/255). Corresponding
intervals matched; absolute callback timestamps differed by five microseconds,
reflecting the stated instruction-start versus instruction-end conventions.
The oracle is useful corroboration of this firmware path, not a replacement for
the independent Intel instruction tests or a claim of hardware qualification.

One lesson was corrected using these observations: immediately executing HLT
after ANZ returns to the monitor's program-counter display. The first example
instead loops over ANZ and remains visibly at A00.042 until STP is pressed.
