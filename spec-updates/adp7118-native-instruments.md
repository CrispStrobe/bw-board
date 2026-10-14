# ADP7118 native instrument-current startup qualification

Status: precision-meter repair candidate, not qualified. No device-model or
legacy-profile/default change.

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

## Preserved initial failure

Source `28bb88ef13f3d473e0b1e2086f4b94e5c24d0bba` in
[CI 38468813289](https://github.com/CrispStrobe/bw-board/actions/runs/38468813289)
failed one numerical test: 8,553 passed, one failed and 302 documented skips.
Harris passed; it does not rescue this measurement failure. All six actual
captures complete with 156 charged integration advances, at most 2,072
attempts and 6,212 solves. All waveform-point comparisons pass. Their maximum
errors are 0.396473 µV voltage, 2.619543 µA output current and 2.619543 µA
input current. All current means pass, including simultaneous published
output/load/supply KCL and IQ controls.

Only `adp-linear-r0` fails: watched voltage is 4.209589434184045 V versus
4.209590872846499 V expected, an error of 1.438662453 µV against the fixed
1 µV bound. Its waveform point error is only 3.816427 nV. Independent
piecewise/differential-current and numerical-integral checks reproduce this
failure. The other five voltage means pass. The capacitance mutation is not
reached, and no whole-batch qualification or landing is inferred.

## Precision accepted-step quadrature candidate

The existing adaptive solver publishes its accepted midpoint and endpoint,
but meters integrate straight-line segments between those values. Accurate
solution points therefore do not alone guarantee an equally accurate integral.
The repair gives `precision-v1` meters a quadratic descriptor through the
already-observed start value and those same two accepted solutions. It adds no
MNA solve, device update, scope point or work exemption. Rejected or failed
steps cannot supply a descriptor. A missing start observation or indeterminate
current retains a named meter refusal rather than inventing a value.

Each half-interval retains the same descriptor, allowing exact integration of
its fitted polynomial over the actual clipped window. Same-time updates still
change only the right-hand value; the preceding interval keeps its original
left-limit endpoint. The existing analytic-source integral path takes
precedence. Constant segments retain exact flat means and compaction.
Interactive/legacy profiles keep their previous linear meter integration.
This is numerical quadrature through observed solutions, not an analytic
substitution of the ADP device law or a universal waveform guarantee.

Seven pure controls pass: the original three instrument controls plus the real
Board recorder with mocked solution maps (precision/legacy/failed/start/current
authority), polynomial and clipped-window/time-origin integrals, invalid or
extrapolated descriptors, and a midpoint-omission mutation. Actual engine
tests remain hosted. The complete six-case test additionally disables the new
quadrature on a real Board caller: that mutation must complete with passing
waveform points but fail the original voltage-mean gate. The capacitance
mutation must also complete and disagree. Reference, acquisition grid, whole
budget and all accuracy bounds remain unchanged; existing meter/model
regressions are required before landing.

### First repair run and continuation-boundary correction

Source `36fa345bb715942656d9d291238132474f2de9d9` in
[CI 38515595322](https://github.com/CrispStrobe/bw-board/actions/runs/38515595322)
passes all six actual regulator captures and both completed negative controls.
The independently checked ideal-supply linear voltage-mean error falls from
1.438662 µV to 1.265835 nV. Maximum voltage-mean error across the batch is
34.772398 nV; maximum output/input current-mean errors are 68.993334/69.034496 nA.
Point readings and work receipts remain identical to the failed baseline.
The quadrature-omission mutant reproduces the original mean failure while
passing the waveform-point checks. This result is not a landing qualification:
the full suite reports 8,600 passed, four failed and 302 documented skips.

All four failures are existing RLC instrument tests, which report
`meter-quadrature-start-not-observed`. The new start guard had demanded
machine-rounding equality, but the unchanged integration loop permits stopping
up to 1 fs before the integer-clock endpoint. A continuation therefore can
have an actual preceding observation slightly before its nominal start.
The forward guard admits only that existing 1 fs completion gap plus floating
rounding, anchoring the polynomial to the **actual observed timestamp** rather
than moving its value to the integer clock. Future observations and larger
unknown gaps still refuse. Pure controls explicitly cover all three cases.
No integrator stop rule, profile accuracy, work ceiling, reference or measurement
bound changes. Fresh hosted RLC/regulator/full-suite qualification is required.
