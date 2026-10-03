# Opt-in whole-advance transient work budget

`BoardImpl.advanceToBounded(targetNs, {maxAttempts, maxSolves, maxAdvances})`
performs one capture on a fresh Board at time zero. The target is a positive
BigInt no larger than Number.MAX_SAFE_INTEGER nanoseconds. All three limits are positive safe integers, capped respectively at
20,000 adaptive attempts, 60,001 MNA solves and 200 integrator entries. Driven
PWM and reentrant calls refuse. Unknown options and partially advanced/reused
Boards refuse before consuming work. This is not a general CPU/wall-clock,
Newton-iteration or arbitrary device-callback budget.

Each counter is charged **before** its work executes. MNA calls include
device-triggered solves, not only the adaptive integrator's local solve tally.
Attempts and entries accumulate across all device sub-intervals of the one
public advance. Existing per-integrator/profile and device-substep backstops
remain unchanged; an incomplete backstop result also refuses the bounded call.

Success returns a deeply frozen receipt containing requestedTimeNs, limits,
actual work, completed and failure. `transientAnalysisStatus().boundedAdvance`
exposes the same receipt after success or failure; ordinary untouched Boards
have no additional status field. A hard stop throws code
`WHOLE_ADVANCE_BUDGET_EXCEEDED`, marks local accuracy unsuccessful, preserves
the original exception and invalidates prior, partial and fresh analog
scope/meter/current observations. There is no fabricated endpoint or resumable
partial capture. Use a new Board after failure. A receipt's completed flag
describes execution, not a global waveform accuracy or independent oracle claim.

Default `advanceTo` callers and all numerical/model/profile tolerances retain
their previous behavior. Tests compare full scope storage, endpoint, mean and
ordinary status bit-for-bit between bounded and unbounded passive and timed
ADP7118 captures. Separate hard stops prove all three counters, including
multiple device intervals. Isolated charge-bypass mutants must fail real caller
consequences and restore the original method. CLI/GUI admission is a separate
consumer change; this engine API alone does not enable any new CLI domain.
