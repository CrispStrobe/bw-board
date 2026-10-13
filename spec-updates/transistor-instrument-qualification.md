# Transistor instrument qualification

## Bounded first batch (prepared, not numerically qualified)

Four independently authored NPN collector circuits extend the qualified
passive/diode instrument matrix. They deliberately request an explicit
exponential two-junction model rather than the unchanged default piecewise
transistor path. These are generic matched-card experiments, not four imported
schematics or physical 2N2222 switching-time qualification.

| Case | Base resistor | Collector resistor | Collector capacitor |
| --- | ---: | ---: | ---: |
| npn-1 | 1 kΩ | 100 Ω | 1 nF |
| npn-2 | 1 kΩ | 1 kΩ | 10 nF |
| npn-3 | 100 kΩ | 100 Ω | 1 nF |
| npn-4 | 100 kΩ | 1 kΩ | 10 nF |

The collector supply is 5 V. The base drive pulses from 0 to 1.5 V with a
1 µs delay, 2 µs ramps, 8 µs width and 20 µs period. These drive/load corners
request strong and weak base drive across an on/off cycle; individual active
and saturated intervals are not independently certified by a region label.
Both routes declare zero initial collector-capacitor voltage. The explicit
generic card uses IS=10⁻¹⁴ A, BF=200, BR=1 and unity junction ideality factors;
Early effect, parasitic resistances, junction capacitances and transit/storage
terms are disabled in both routes. Matching thermal constants are declared in
the independently authored SPICE decks. The engine's other transistor models
and defaults are untouched.

Each circuit requests 200 simultaneous collector-voltage and collector-load
current observations, every 100 ns through 20 µs. The current channel uses
`currentClock: 'simulation'`; current leaving its supply-side resistor terminal
is compared with the negative entering current of the independent SPICE sense
source. Meter watches start at the first observation, so means cover
100 ns through 20 µs. Sample pairs, metadata, card, actual initial state,
precision profile and one whole-capture work receipt are required.

Two raw SPICE runs use 0.5 ns / 0.25 ns maximum steps and refined startup
increments. Before engine acquisition, every reference point and clipped mean
must agree within 10 µV / 100 nA. Engine bounds are fixed at 100 µV / 1 µA;
the original 20,000-attempt / 60,001-solve / 200-advance budget is not renewed
per observation. Reference and engine refusals retain the case denominator and
partial evidence. No numerical bound or budget can be selected through the CLI.

`node scripts/qualify-transistor-instruments.mjs` emits four JSON case reports
and exits nonzero if any fails. `--case npn-3` selects a reviewed fixture for
diagnosis. Unknown cases or extra flags are refused. Unavailable SPICE reports
all requested cases without acquiring the engine; a malformed or incomplete
capture becomes a failed report rather than silently aborting the remaining
case sequence. Raw reference tables are temporary; reports retain deck and
waveform hashes, sample-bracketing rows and clipped means. Those brackets do not
permit independent reconstruction of the full mean-integration tables.

Local preparation has four pure control tests, including two executable
comparison mutations. Hosted acceptance requires all four actual circuits and
an isolated 20% change to the actual base resistor in npn-3: that mutant must
complete and disagree with the unchanged reference. Refusal or process failure
does not count as an electrical negative control. No local numerical engine or
SPICE execution is used as qualification.

## Limits and next work

This batch excludes physical junction-storage and switching-delay claims,
temperature sweeps, real-device parameter spread, PNP equivalence and arbitrary
transistor cards. Those require separately matched references and explicit
qualification. The next approved instrument batches cover op-amp closed-loop
waveform/load/slew behavior and regulator startup against appropriate bounded
model oracles. Op-amp observations must vary event phase as well as sample time;
existing settled or tick-aligned checks alone do not establish dense waveform
accuracy. Consumer package adoption, realistic instrument effects and deployment
remain later tasks, not consequences of a source-only test result.
