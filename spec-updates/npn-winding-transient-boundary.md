# NPN winding startup: unresolved transient qualification

Status: reproducer checkpoint, **not a repair or qualified implementation**.
Baseline source: `ac7595b609daa75717c696830982f59940c97e8b`.

## Current readback prerequisite repair

The isolated prerequisite is now on upstream master at
`4e4cf9c45b7083efec4b94bc44d20fcbea92f319`, after
[CI37901045984](https://github.com/CrispStrobe/bw-board/actions/runs/37901045984)
and [Harris37901045960](https://github.com/CrispStrobe/bw-board/actions/runs/37901045960)
both passed. All four enabled CI jobs passed; `vectors-full` was intentionally
skipped by workflow policy. The full test job reports8436 passes, zero failures
and302 skips. Nine standalone caller tests plus adjacent suites pass55/55
locally; three isolated reader-restoration mutants independently fail.
This does not qualify the startup integration or downstream package adoption.
The startup branch incorporates the landed prerequisite; its combined focused
suites still report14 passes and the same2 desired startup failures.

The lane now includes a bounded current-readback correction, not a startup
integration repair. The PWL companion stamps an off conductance of1 nS, but
the old extraction returned zero below its knee. On the reverse-biased motor
flyback diode this hides about4.63 nA at the failing interval and makes the
reported collector KCL disagree with the solved network. It also affects
off-state BJT base current and its controlled collector-current readback.

`pwlStampedCurrent` reads the off companion's actual `gEq*v+iEq`; existing
forward/knee extraction is retained. The original `pwlKneeCurrent` remains
unchanged for region classification. No stamp, transistor/diode equation,
profile, step floor, switching decision or failure latch is changed.
The actual pre-switch motor case now agrees with diode leakage and collector
KCL within0.1 nA. An independent high-impedance base-drive circuit proves
nonzero off-state base current and its beta-scaled collector current agree
with the stamps, including terminal-current conservation.

Both new assertions fail with the old zero-current extraction and pass after
repair. A restore-zero source mutant also fails both real caller tests;
restoration is verified. Adjacent BJT-region, junction-knee and junction-GMIN
suites pass13/13. The complete lane suite is5 passing controls and2 remaining
desired startup failures, zero skips. The branch is therefore not qualified
for master or consumer adoption. Earlier baseline-identical statements below
describe the earlier diagnostic checkpoints, not this current readback change.

This correction does not explain away the voltage accuracy error: substituting
the **actual collector branch current**, rather than winding current alone,
into the clamp law accounts for the hidden diode conductance. Remaining
clamp-consistency residual is on the microvolt scale, versus the approximately
238-microvolt full/half endpoint difference. Independent continuation must
therefore use the actual solved branch currents and preserve that unresolved
voltage-accuracy refusal.

## Observed consumer failure

Lite Build [37833383585](https://github.com/CrispStrobe/brickwright-lite/actions/runs/37833383585)
at `1aa59e51681a721689e63c3be9b3362421168b4a` passes its build,
corpus, heavy-browser and FPGA jobs. The actual scope-reset journey retains
the handle, clears the old ring, and captures all 5000 first-epoch envelopes.
The separate green-flag first-write journey fails: the visible alert is
`Simulation stopped: advanceToLive refuses failed transient history`.
The package adoption remains held. This is not a successful GUI qualification.

## Native reduction and acceptance test

`test/npn-winding-transient-boundary.test.mjs` removes the GUI, breadboard,
emulator, mechanics and downloaded fixtures. It retains a 5 V source, the
21700-ohm quasi pull-up, 1000-ohm base resistor, NPN, 5 mH winding,
10-ohm winding resistance and flyback diode. The desired weak-drive tests
are deliberately **red on the baseline**; they must not be skipped, changed
to expect the failure, or treated as a passing implementation.

Run with Node22:

```sh
node --test test/npn-winding-transient-boundary.test.mjs
```

The strongly driven control stays saturated and passes an independent RL
response: `I(t) = 4.8/10.1 * (1-exp(-10.1*t/0.005))`, including the existing
0.1-ohm saturation clamp. The weak-drive fixed-clamp case also specifies the
independent settled base-network/current-limit and collector-voltage laws.
The default drive-dependent saturation model has its own actual startup case.

The consumer's original motor fixture first records
`minimum-step-accuracy-unmet` at approximately 19.863 microseconds:
10 ns step, normalized error 6.2673. The electrically reduced default-model
case reproduces it without mechanical back-EMF. A fixed 0.2 V saturation
parameter does not solve it: the failure moves to approximately
20.190 microseconds and normalized error 4233.79. Solver trial traces cross
from the saturated to active region near the failure.

## Rejected experiments

These were diagnostic instances or uncommitted drafts, not production changes:

- Removing back-EMF does not remove the failure. Removing winding inductance
  does, but removes the modeled phenomenon and is not a repair.
- Tightening the diagnostic instance's step floor from10 ns to1 ns and100 ps
  still fails at the transition. No profile change is adopted.
- A draft region-aware short restart plus error-controlled backward-Euler
  fallback still fails. The draft was removed; `src/board.js` and `src/mna.js`
  remain byte-identical to the claimed baseline.
- A subsequent diagnostic event draft obtains authoritative saturated/active
  regions from MNA, tests backward-Euler full/half storage-state agreement at
  a floor-sized region crossing, and uses error-controlled backward Euler
  after that crossing. The fixed-clamp regression passes in this experiment,
  but the default-model regression still fails; this is not a release repair.
  The draft is removed from runtime source and not published as implementation.

The latter experiment separates two remaining issues. For the fixed clamp,
one tiny backward-Euler restart leaves about0.01999 V in winding-voltage
history even after current has reached the active limit. Trapezoidal trials
then ring between collector endpoints4.83003 V and4.79025 V, normalized
error82.20. Continued **error-controlled** backward Euler gives endpoints
4.81006848 V and4.81007845 V, normalized error0.02069, then settles. This
supports an L-stable post-event method but does not justify suppressing
node-voltage error at arbitrary regime changes.

The default drive-dependent clamp has a distinct pre-event failure. At an
interval starting19.853126816 us, both trapezoidal endpoint solves remain
saturated. Their collector voltages are0.369706783 V and0.369945089 V;
their winding currents differ by11.76 nA. The normalized voltage error is
6.27212 at the unchanged10 ns floor. A backward-Euler full/half comparison
also fails, normalized error19.1967. The saturated-to-active crossing occurs
in the following interval. Treating this earlier failure as a switching jump
would be false event attribution; clearing the latch at the later event would
hide a real accuracy failure. Including the derived saturation-clamp change
in the Newton convergence delta did not remove it either.

Consequently the fixed-clamp experiment is only a partial proof. Completion
of the default model requires an independently justified way to resolve its
sharp pre-event voltage dynamics at the existing profile, not a broader
event exemption, blanket method substitution or fixture-model swap.

An independent ngspice42 Gummel-Poon topology control with explicit
`IS=1e-16 BF=100 BR=1`, the same external R/L network and a1 ns drive rise
completes10033 points to1 ms. Its winding endpoint is18.28460 mA. That is
**not** an exact numerical oracle for the engine's different PWL transistor,
and completion alone does not qualify its voltage waveform or the engine.

## Required next repair proof

### Stiff active-mode reference for the reduced fixed-clamp circuit

There is a second quantitative reason not to keep trying short trapezoidal
restarts. In the admitted active/off-flyback region of the reduced circuit,
let `g=1e-9 S` be the flyback diode's existing off conductance, `R=10 ohms`,
`L=.005 H`, and `J=beta*Ib`. Collector KCL and the winding law give:

```text
I + g*(5 - Vcollector) = J
Vcollector = 5 - R*I - L*dI/dt
g*L*dI/dt + (1+g*R)*I = J
Isteady = J/(1+g*R)
tau = g*L/(1+g*R)
```

This stage is an affine one-pole system with an independent exponential
solution. Here `tau=4.99999995e-12 s`: the existing10 ns controller floor
spans2000 time constants. The independent steady current is
18.992153104533 mA and collector voltage4.810078468955 V, matching the
earlier controlled-backward-Euler plateau. These are consequences of the
existing numerical model, **not measured physical transistor characteristics**.

For the fixed clamp's0.1-ohm series slope, including the same off conductance
gives switching current18.992148496353 mA. Including leakage in the
saturated clamp drop as well gives independent crossing time
20.189645866630 us. The preceding checkpoint's20.189645864570 us value
included leakage in the crossing current but omitted it from the saturated
RL trajectory. The no-leakage estimate differs by about5.2 ps,
which is material to the stiffness diagnosis but not a license to alter the
profile. This derivation covers the fixed-clamp reduction only; it does not
establish the default drive-dependent clamp trajectory or motor mechanics.

The complete saturated reduction is:

```text
rc = .1 ohm; vsat = .2 V; supply = 5 V
Vcollector = (vsat + rc*I + rc*g*supply)/(1+rc*g)
Isaturated = (supply-vsat)/(R+rc+R*rc*g)
tauSaturated = L*(1+rc*g)/(R+rc+R*rc*g)
Ievent = (J-g*(supply-vsat))/(1-g*rc)
tevent = -tauSaturated*log(1-Ievent/Isaturated)
```

**Correction to the earlier jump diagnosis:** at the finite-leakage
equation-matching boundary, both region equations give0.201899215329 V. Current and collector
voltage are continuous. The4.608179254 V rise takes place in the active
region with the5 ps time constant; only the zero-leakage limiting model has
an instantaneous algebraic voltage jump. A discontinuity exemption would
therefore be unjustified for the existing stamped model. The new independent
controls check boundary continuity, collector KCL and the winding voltage law,
including the nonzero derivative at the boundary. A scalar trapezoidal
full/half-step control at10 ns also fails the unchanged voltage norm: this
is real stiffness, not permission to ignore the estimator. This matched
boundary is not yet a certificate of the runtime region selector: its active
entry checks Vce against the clamp offset and its saturated exit retains a
0.95 current margin. Those predicates must be checked separately before
the reference can authorize a production propagation path.

An independent ngspice42 linear control isolates the existing active-region
equation, with winding initial current set to the calculated event current:

```spice
Independent fixed-clamp post-event affine control
VCC supply 0 5
ILIMIT collector 0 0.01899215329445417
RLEAK collector supply 1e9
LW supply winding 5m IC=0.018992148496353382
RW winding collector 10
.options method=gear maxord=2 reltol=1e-9 abstol=1e-15 vntol=1e-10
.tran .01p 50p 0 .01p uic
.meas tran v05 FIND V(collector) AT=.5p
.meas tran v5 FIND V(collector) AT=5p
.meas tran v25 FIND V(collector) AT=25p
.meas tran i5 FIND I(LW) AT=5p
.end
```

The5011-point run gives0.6404256,3.114827 and4.779030 V at0.5,5 and25 ps.
The exact exponential gives0.640425455,3.114824077 and4.779028803 V,
respectively, within5 microvolts. This is a linear post-event oracle, not a
full transistor/motor oracle, production-path admission proof or successful
BoardImpl startup. Both desired actual startup regressions remain red.
Halving the reference maximum step to0.005 ps gives10011 points and
0.6404256,3.114825,4.779030 V; all remain within5 microvolts of the exact
solution. The combined native suite has17 passes and2 genuine startup
failures, with no skips. Runtime source bytes remain unchanged.

An exact propagator for an explicitly admitted affine post-event system is a
bounded hypothesis worth testing, not an implemented repair. It needs verified
topology/model-region/source authority, event location/current continuity,
complete observable reconstruction and ordinary solver fallback/refusal when
that authority does not hold. It must not project arbitrary storage to a DC
equilibrium, ignore flyback conduction, or treat a region label alone as a
certificate. The default pre-event failure remains a separate required proof.

### Runtime-region audit and second-order damping experiment

Opt-in `solveMNA(...,{inspectBjtRegions:true})` now returns detached, frozen
per-BJT region/clamp diagnostics. With the flag omitted the result has no
extra field; the diagnostic path does not change stamps, iteration or error
control. Actual19 us winding trial solves compare all ordinary return values
deeply against the flag-absent path for fixed-clamp, default and explicit
finite-Early models. The junction-model case reports `ebers-moll` and no
clamp voltage, not its unused FSM region. These are final iteration labels,
not an admission certificate; `converged` and equation/source/topology
authority remain independent requirements.

A fresh default board advanced successfully to19.853 us. An actual10 ns
trapezoidal trial and its two5 ns trials all converge and all remain
`saturated`, yet the collector-voltage full/half norm is5.487855926 at
unchanged1 microvolt/1e-4 scales. A new native test preserves this proof.
Falsifying the diagnostic by reporting every PWL BJT as active makes both
new caller tests fail; restoring the actual region makes both pass. Thus the
pre-event failure cannot be reclassified as a region-crossing exemption.

A local second-order L-stable SDIRK experiment used
`gamma=1-1/sqrt(2)`, first-stage BE duration `gamma*h`, and second-stage
BE with combined history `state0+(1-gamma)/gamma*(state1-state0)` at the
actual endpoint. Full/half error control still compared all node and
storage observables. It retained both startup failures: fixed clamp at
20.204035222 us with norm571.652954, default at19.905295643 us with
norm1443.490878, both at10 ns. The prototype was removed completely;
`src/board.js` remains unchanged. Blanket damping-method substitution is
not a justified repair. Adjacent BJT/readback suites pass16/16; the combined
startup/readback suite remains19 pass/2 genuine startup fail/0 skip.

### Fixed-clamp boundary established independently

The independent PWL base-network limit is18.992153294 mA. Before the
fixed-clamp transition, the winding follows the RL law above. Solving
`I(t)=beta*Ib` gives20.189651071 microseconds, agreeing with the observed
20.190-microsecond failure. Current remains continuous, but the specified
zero-leakage limiting model switches collector voltage from0.201899215 V
to4.810078467 V. This approximation suggested an algebraic jump, but the
leakage-inclusive analysis above supersedes that diagnosis for the actual
stamped model. The actual19-microsecond control agrees
with the independent current within2 microamps and voltage within0.1 mV.

The node-voltage full-step/half-step comparison must resolve the very stiff
continuous rise; accepting a supposed discontinuity is not a repair. This
establishes the fixed-clamp reduction, not every cause in the drive-dependent
default model. A justified propagation repair must locate the switching
boundary, retain continuous winding current, and establish consistent
post-event algebraic voltage/derivative before resuming ordinary error control.
It must not merely accept a floor error or discard a failed history.

### Separate finite-Early-voltage control

Explicit `model:'shockley', vaf:100`, with the existing generic
`IS=1e-14 BF=100 BR=1`, completes the same1 ms startup at unchanged
`interactive-v1` accuracy settings. `model:'shockley'` alone still fails;
`model:'ebers-moll'` is not a supported selector and cannot enable this path.
The existing2N2222 library card does **not** specify VAF. Therefore this
control is not a justified silent lesson/card replacement, generic repair,
or certification of a particular transistor.

Independent ngspice42 deck, using Gear2 with1 ns maximum steps and
matching the engine's fixed25.85 mV junction thermal voltage through equal
TEMP/TNOM26.825849 C:

```spice
Explicit finite-Early-voltage NPN winding control
VCC supply 0 5
VDRIVE drive 0 PULSE(0 5 0 1n 1n 2m 4m)
RPULL drive pin 21700
RBASE pin base 1000
QSW collector base 0 SWITCH
LW supply winding 5m
RW winding collector 10
DFLY collector supply FLY
.model SWITCH NPN(IS=1e-14 BF=100 BR=1 VAF=100)
.model FLY D(IS=1e-12 N=1 RS=.568)
.options method=gear maxord=2 tnom=26.825849
.temp 26.825849
.tran 1n 1m 0 1n uic
.meas tran i10 FIND I(LW) AT=10u
.meas tran v10 FIND V(collector) AT=10u
.meas tran i20 FIND I(LW) AT=20u
.meas tran v20 FIND V(collector) AT=20u
.meas tran i50 FIND I(LW) AT=50u
.meas tran v50 FIND V(collector) AT=50u
.meas tran i100 FIND I(LW) AT=100u
.meas tran v100 FIND V(collector) AT=100u
.meas tran i1000 FIND I(LW) AT=1m
.meas tran v1000 FIND V(collector) AT=1m
.end
```

| Time | ngspice winding A | Engine winding A | ngspice collector V | Engine collector V |
| --- | ---: | ---: | ---: | ---: |
| 10 us | .009724297 | .009724504 | .1218993 | .121900877 |
| 20 us | .01903418 | .019034050 | 1.933247 | 1.932660677 |
| 50 us | .01957415 | .019574142 | 4.804258 | 4.804258576 |
| 100 us | .01957415 | .019574142 | 4.804258 | 4.804258576 |
| 1000 us | .01957415 | .019574142 | 4.804258 | 4.804258572 |

Each engine sample uses a fresh board to avoid imposing extra advancement
boundaries. All five actual completions retain `accuracyMet:true` and satisfy
1 microamp/1 mV comparison bounds. These bounds are independent comparison
criteria, not a modification to solver accuracy. The reference has a1 ns
source ramp rather than the engine's instantaneous pin change, a reverse-biased
exponential flyback diode rather than the PWL diode, and Gear integration
rather than trapezoidal integration. This establishes sampled **turn-on**
agreement only; it does not qualify flyback turn-off, mechanics, arbitrary
cards or complete continuous-waveform agreement. The earlier27 C/10 ns
reference also completed; thermal matching and refinement reduce the20 us
voltage discrepancy from about6 mV to0.59 mV.

The expanded native suite currently has3 passing controls and2 still-failing
desired-behavior regressions, with no skips. Runtime source is unchanged;
no package adoption or deployment is released by these controls.
An isolated source mutation ignoring declared VAF (`vaf=Infinity` in the
parameter reader) makes the new finite-Early control fail through the real
live-clock caller. Restoring the original reader makes all three controls
pass again. Both original desired-behavior regressions remain intact and red.

The current hypothesis is a nonlinear switching/constraint-consistency
problem, not simply insufficient generic step refinement. Establish the
consistent winding state and algebraic voltage through the active-region
transition before choosing an implementation. A restart alone has already
failed this experiment.

A repair must pass both weak-drive regressions and the independent strong-drive
control, preserve current continuity/KCL, compare resolved transition traces
against an independent reference with its model differences stated, and retain
genuine convergence/floor/budget refusals. Restore-the-defect and false-success
mutations must fail real caller assertions. Preserve all existing profiles,
accuracy scales, work ceilings and failure latches. Hosted CI/Harris and then
the actual packaged green-flag browser journey remain required before adoption.
No model tuning, successful deployment, performance improvement or completed
motor transient qualification is claimed by this checkpoint.
