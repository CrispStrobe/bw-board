# Broader transient instrument qualification

## First batch (prepared, not qualified)

Twelve independently authored circuits: four RC, four series RLC, and four
Shockley-diode reservoir/filter cases. Parameter corners vary time constant,
damping, inductance, capacitance and series resistance. This is not twelve
schematic-corpus imports or full coverage of every circuit family.

| Case | Series R | L | Storage C | Additional load |
| --- | ---: | ---: | ---: | --- |
| rc-1 | 100 Ω | — | 1 nF | — |
| rc-2 | 1 kΩ | — | 1 nF | — |
| rc-3 | 1 kΩ | — | 10 nF | — |
| rc-4 | 10 kΩ | — | 10 nF | — |
| rlc-1 | 100 Ω | 100 µH | 1 nF | 10 MΩ |
| rlc-2 | 200 Ω | 100 µH | 1 nF | 10 MΩ |
| rlc-3 | 100 Ω | 1 mH | 1 nF | 10 MΩ |
| rlc-4 | 1 kΩ | 1 mH | 10 nF | 10 MΩ |
| diode-1 | 100 Ω | — | 1 nF | diode + 10 kΩ |
| diode-2 | 1 kΩ | — | 1 nF | diode + 10 kΩ |
| diode-3 | 100 Ω | — | 10 nF | diode + 10 kΩ |
| diode-4 | 1 kΩ | — | 10 nF | diode + 10 kΩ |

The diode is in series before the reservoir node; the listed 10 kΩ is a shunt
load. RC/RLC input swings from 0 to 5 V; diode input swings from −1 to 2 V.
All pulses have a 1 µs delay, 2 µs rising/falling ramps, 8 µs width and 20 µs
period. This explicitly exercises diode off/on/off rather than a DC endpoint.

Each case requests 200 simultaneous ideal voltage/current samples at 100 ns
spacing across a 20 µs pulse experiment. Meter watches begin at the first
100 ns observation, so their means cover **100 ns through 20 µs**, not zero
through 20 µs. Currents leave the selected engine terminal; the independent
SPICE reference measures entering current with a zero-volt series sense source.

Independent decks declare zero capacitor/inductor ICs and UIC, matched thermal
constants and explicit diode cards. Raw SPICE refinements use 1 ns and 0.5 ns
maximum steps, with correspondingly refined startup increments. Reference
voltage/current samples and means must agree within 10 µV / 100 nA before engine
comparison. Engine bounds are fixed beforehand at 100 µV / 1 µA. Reference
refinement, engine completion, exact time/sign/grid and every point/mean are
distinct requirements. Work remains one 20000/60001/200 capture per circuit.

`node scripts/qualify-transient-matrix.mjs` emits one JSON report per case and
exits nonzero if any fails. `--case rc-1` selects one reviewed fixture for focused
diagnosis; it cannot select different budgets or loosen bounds. Runtime is
hosted. Successful arms, waveform hashes/brackets and numerical refusals remain
reported; failed cases are never silently dropped from the denominator.

Preparation depends on the simulation-clock current lane. No matrix dispatch,
landing, pin or deployment is authorized by a passing pure parser/control test.
Qualification remains pending. Full raw solver tables are temporary; reports
retain their hashes, sample bracketing rows and clipped-interval means.
An isolated actual-circuit resistor perturbation must complete yet disagree
with its unchanged SPICE reference. A process error or incomplete mutant does
not count as a successful electrical negative control.

## Subsequent batches, in the approved roadmap order

1. Finish current-scope qualification and this passive/diode batch; then add
   transistor switching, op-amp closed-loop/dynamic/loading and regulator startup
   cases. Review each model's supported domain before selecting its oracle.
   Behavioral-model agreement is not physical datasheet or vendor-model proof.
2. Generalize CLI probe selection, capture windows, sample rates and text/CSV/JSON
   reports for reviewed examples and supported circuit imports.
3. Qualify realistic probe loading, bandwidth, trigger, clipping and aliasing
   separately from ideal measurement and circuit-solver agreement.
4. Adopt compatible engine/UI pins once in Lite, prove actual GUI measurements,
   deploy, and verify the deployed artifact without inferring shipping from source.
5. Resume corpus-driven import/model/oracle divergence work with explicit refusal
   classes and useful circuit/part priorities.
6. Improve breadboard placement and PCB/module connectivity/rendering for the
   selected physical parts, with matching pins and supported electrical models.
