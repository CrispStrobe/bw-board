# Measurements require a valid circuit solve

An explicitly failed MNA solve or conflicting ideal supply constraints are
not voltage or current measurements. Voltage/current meters and branch-current
reads refuse with `SOLVE_FAILED_MEASUREMENT`; analog scope captures refuse with
the same code and do not record fallback zeros. A failed interval remains
unavailable after recovery: reset the meter netlist/watch or start a new scope
capture. Fractional transient observations use their matching solution.

This does not change the solver, regularize independent ideal-source cycles,
invent current sharing, or change general `nodeVoltage` and digital event APIs.
Successful zero measurements, power-off branch current and existing valid-solve
unknown-terminal fallbacks retain their contracts. Strict operating-point and
precision admission remain separate authorities.

A live solver exception also invalidates measurement authority, even when the
cache was cleared or still holds an earlier converged result. The original
exception is rethrown unchanged. Meter history and analog capture remain invalid
across recovery; fresh observations can use a subsequent successful live solve.
Observational operating-point and test-current solves do not invalidate live
state. A null cache alone is not a failure.

Placeable `voltmeter`, `ammeter` and `analog_meter` device states expose
`available`, `measurementError` and nullable `reading`. An unavailable analog
meter also has nullable `deflection`, not a fabricated needle position. These
devices opt into `measurement: true` and receive `read.measurementError` from
the actual accepted solution. Their `invalidateMeasurement` hook clears stale
state immediately on live solve exceptions. Loading and shunt burden are
unchanged. Ordinary device callbacks and the logic probe are unchanged; this is
an engine state contract, not a claim of new artwork or browser rendering.
