# Cooperative live device clock

`BoardImpl.advanceToLive(targetNs, {maxSteps: 32})` is an opt-in interactive
clock operation. It is not an analysis capture, a wall-time bound, a real-time
speed promise or an async operation. The caller yields between invocations.

Each call completes at most `maxSteps` ordinary intervals (integer 1–128,
default 32), stopping at the earliest device wake, driven-PWM edge, requested
target or a fixed 1 ms span. It never jumps over outstanding work merely because
its quantum ended. Repeating a call continues from the actual processed time.
Ordinary `advanceTo` retains its existing behavior, including its 200-device-step
backstop. Device models, adaptive integration limits and tolerances are unchanged.

The frozen return object has decimal-string `startedTimeNs`, `requestedTimeNs`
and `processedTimeNs`, boolean `completed`, and integer `steps`/`maxSteps`.
`steps` counts scheduling intervals, not solver attempts or device callbacks.
Completion means the clock request was processed, not a new numerical or
physical accuracy certificate. An unfinished target is normal progress, not
failed integration. A zero-length
request returns completed with zero steps and performs no sampling or callbacks.
Targets must be nondecreasing BigInts within the safe nanosecond horizon.
Unknown options, malformed limits and invalid targets refuse before advancement.

The default interactive profile is required. A current or completed one-shot
bounded analysis cannot enter this API; it cannot replenish finite budgets.
Prior failed measurement/transient history remains refused. A solve failure or
integration failure propagates instead of producing a completed receipt.
Nested live or ordinary clock advancement from a change listener refuses before
advancing, and a swallowed nested-clock error still stops the outer operation.
Listeners must not reset, restore, rebuild or otherwise replace board state
during an advance. After an exception, the live-entry context is always released;
this does not clear any engine failure state or reconstruct omitted history.

Consumer work is separate: synchronize displayed time to processed time, yield
between calls, retain pause/single-step/cancellation and external-engine clock
ownership, and base demo transitions on simulation time. Full CLI budgets remain
finite and unchanged. This API alone is not GUI waveform qualification, physical
amplifier validation or package adoption.
