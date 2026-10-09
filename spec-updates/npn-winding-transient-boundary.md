# NPN winding startup: unresolved transient qualification

Status: reproducer checkpoint, **not a repair or qualified implementation**.
Baseline source: `ac7595b609daa75717c696830982f59940c97e8b`.

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

An independent ngspice42 Gummel-Poon topology control with explicit
`IS=1e-16 BF=100 BR=1`, the same external R/L network and a1 ns drive rise
completes10033 points to1 ms. Its winding endpoint is18.28460 mA. That is
**not** an exact numerical oracle for the engine's different PWL transistor,
and completion alone does not qualify its voltage waveform or the engine.

## Required next repair proof

### Fixed-clamp boundary established independently

The independent PWL base-network limit is18.992153294 mA. Before the
fixed-clamp transition, the winding follows the RL law above. Solving
`I(t)=beta*Ib` gives20.189651071 microseconds, agreeing with the observed
20.190-microsecond failure. Current remains continuous, but the specified
ideal model switches collector voltage from0.201899215 V to4.810078467 V:
a4.608179252 V algebraic jump. The new actual19-microsecond control agrees
with the independent current within2 microamps and voltage within0.1 mV.

The node-voltage full-step/half-step comparison assumes a smooth interval;
an interval straddling this discontinuity violates that assumption. This
establishes the fixed-clamp case, not every cause in the drive-dependent
default model. A physically justified event repair must locate the switching
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
