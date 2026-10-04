# Finite bounded transient observations

`advanceToBoundedStream(endNs, limits, {stepNs, onStep})` performs one finite,
synchronous capture on a fresh time-zero Board. It retains one cumulative work
context across every chunk, device subdivision and observer-triggered solve.
Existing ceilings remain 20,000 attempts, 60,001 actual MNA solves and 200
integrator entries. At most 200 observer calls are admitted. The final short
chunk lands exactly at `endNs`; no continuation or fresh allowance is granted.

`onStep` receives a frozen `{index, timeNs, qualified:false, work}` record.
It may synchronously read meter/scope observations. Those observations are
provisional until the method returns a completed final receipt. This is actual
chunked execution, not replay of a previously qualified batch. No GUI worker,
asynchronous observer, open-ended stream or wall-time guarantee is supplied.
Observers are application code, not a sandbox; direct private state mutation
is unsupported. Do not edit the circuit/profile while capturing.

The final receipt keeps the existing limits/work/request/completed/failure
contract and adds frozen `stream:{stepNs,observerCalls}` metadata. Observer
throw/cancellation, promise return, work exhaustion or incomplete execution
throws, returns a failed status receipt and invalidates scope/meter observations.
Caught observer attempts to advance time or start another bounded capture stay
latched: catching an error cannot turn the outer capture into success.
Consumers must emit an explicit terminal failure for any previously streamed
provisional records, and never call those records a qualified capture.

Ordinary `advanceTo` and two-argument `advanceToBounded` retain their existing
numerical and receipt behavior. Partitioned streaming can change the adaptive
mesh relative to a single bulk advance; exact equivalence is asserted against
the same ordinary partitions, while independent RC waveforms/integrals check
numerical meaning. This is not a vendor-model or global-error certificate.
The real ADP inrush proof checks all 120 points against the authored continuous
clamp/RC solution at 0.5 microvolt, its window mean at 1 microvolt, and concurrent
VIN/IQ/load/storage delivery and the 0.36 A ceiling. Existing profile tolerances
are unchanged. Five isolated bypass/reset/latch mutants must fail actual callers.
CLI/Lite adoption remains separate and disabled until upstream qualification.
