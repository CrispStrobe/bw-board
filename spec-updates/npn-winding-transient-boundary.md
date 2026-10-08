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
