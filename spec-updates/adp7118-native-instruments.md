# ADP7118 native instrument-current startup qualification

Status: implemented evidence candidate, not qualified. No model/default change.

The existing [current-limited startup model](adp7118-current-limited-startup.md)
already has voltage and caller-sampled current proofs. This batch adds simultaneous
native-clock voltage, package output-current and source input-current scope
captures, their actual watched means, and one whole-run work receipt. The chosen
behavioral delayed-exponential/current-ceiling law is not a vendor transistor
model or a physical ADP7118 waveform certificate.

Six cases cross linear (500 Ω/2.2 µF), temporary inrush limiting (500 Ω/22 µF)
and sustained overload (10 Ω/2.2 µF) with ideal and 4 Ω supply paths. All use
fixed 8 V VIN, 3.3 V EN, direct SENSE, coincident duplicate package leads,
open SS, 5 V output, 0.05 Ω output resistance and 0.36 A current ceiling.
The independent piecewise continuous RC solution finds current-limit entry/
release roots without consulting device state or measured output. Output-current
integrals follow capacitor/load KCL; supply-current integrals add the documented
piecewise IQ law, including independently bracketed 200 mA IQ knees.

Each channel supplies 200 native paired observations on a 6 µs grid through
1.2 ms. Paired storage is one reading, not two. Current channels explicitly
request `currentClock: 'simulation'`. The observer runs on a different 15 µs
grid (80 callbacks); meters register at 15 µs and observe means over
15 µs–1.2 ms, not an invented retrospective window. Existing off-grid device
wakes consume actual integration advances. One 20,000-attempt/60,001-solve/
200-advance budget covers the entire experiment, including the cold interval.
No warm-up renewal, charge waiver or sample-phase alignment hides work.

Fixed point bounds are 0.5 µV voltage, 10 µA output current and 11 µA input
current. The output-current bound follows the voltage bound divided by the
authored 0.05 Ω; the input bound also covers the IQ slope. Means require
1 µV and 1 µA. These are bounded numerical agreement requirements, not a
physical accuracy or calibration promise. All six cases and their full windows
must complete. Provisional already-published voltage/current snapshots retain
refused prefixes but cannot certify them. Getter-triggered solves are not used
to manufacture observer results.
Every converged provisional snapshot must satisfy output/load/capacitor KCL,
stamped package-port KCL, simultaneous VIN delivered current plus IQ, source
current and the finite supply-voltage drop. Missing/non-finite currents or
dirty/non-converged snapshots cannot substitute zero to pass these checks.

Three pure controls cover immutable case/region/integral authority, malformed
whole-capture/refusal boundaries, and executable changed-IQ/omitted-last-current
mutations. Actual engine runs stay hosted. After every baseline capture agrees,
an actual 50% larger output-capacitance mutation must complete and disagree with
the unchanged reference. A failed acquisition is not the electrical negative proof.

`node scripts/qualify-adp7118-instruments.mjs` emits all six reports and exits
nonzero on refusal/disagreement. `--case adp-inrush-r4` selects a reviewed case;
there are no arbitrary tolerance, budget, circuit or timing overrides. This is
a reviewed instrument qualification CLI, not yet a general imported-deck probe
interface. GUI/package adoption, dynamic enable/headroom, shutdown/restart,
prebias, dropout, adjustable/external-SS operation and physical-model validation
remain separate work.
