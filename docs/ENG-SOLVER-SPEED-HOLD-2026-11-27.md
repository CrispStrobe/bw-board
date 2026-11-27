# Newton-failure memory and the predicted Newton start: held (2026-11-27)

Candidate: `origin/r4/eng-solver-speed-20261126` (1a630a92), cherry-picked
onto bw-board master `b47e7e09` as this branch (`5496654e`). It is a general
transient speed-up: failed step sizes are remembered, and trials start Newton
from a linear prediction. It reports 5–14 % less work.

Before it can merge, every test it moves must have a legitimate,
evidence-backed reason. Measured locally (macOS arm64, Node 26.4, loaded
machine), against master on the same tree:

| Test | master | candidate | Verdict |
| --- | --- | --- | --- |
| `reset-transient-controller`: a reset brings the motor to rest | pass | **throws**: "transient Newton solve failed at minimum step" | regression |
| `reset-transient-controller`: a short first advance does not strand the motor bench at the step floor | pass | **throws**: "advanceToLive refuses failed transient history" | regression |
| `radio-mixing`: VHF FM superhet, the oscillator 10.7 MHz above the station | pass | fails "undistorted": 0.0227 V of 2 kHz distortion product | physical output moved, no reference |
| `radio-envelope-bands`: same trajectory on every platform | 949 solves | 931 solves | a fingerprint, re-pinnable *if* the rest qualifies |

The two motor failures are not moved numbers. The candidate makes the solver
**fail** where master converges. A predicted start that leaves Newton's basin
at a reset edge is the likely mechanism; it has not been isolated. The FM
superhet's programme distortion moving with a Newton start is also a red
flag: a converged solve should not depend on where Newton started. The
change in that answer means one of the two runs is not converged to the
answer the test assumes, and no reference exists to say which.

**Not merged.** To qualify it:
1. Find why the reset benches fail. Likely candidates: the extrapolated
   start across a discontinuity (a reset, a switch), or a remembered failure
   size that outlives the edge that caused it. Fix it so both pass unchanged.
2. Show that the FM superhet's distortion converges to the same value under
   step refinement with and without the predicted start. Then keep the
   assertion unchanged, or move it with that evidence.
3. Re-pin the 949 fingerprint only after 1 and 2, checked on macOS and
   Linux as before.
