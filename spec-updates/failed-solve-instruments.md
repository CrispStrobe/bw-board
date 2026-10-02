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
