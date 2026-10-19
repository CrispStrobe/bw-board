# Spec-update: sparse LU with symbolic reuse (replaces dense Gaussian elimination)

## Problem

`mna.js` stores the system as a dense `Float64Array(dim²)` and runs fresh in-place
Gaussian elimination with partial pivoting **every Newton–Raphson iteration**, after
a full `A.data.fill(0)` + re-stamp + `A.clone()` (a whole new dim² allocation per
iteration). Circuit matrices carry ~5 nonzeros per row; above a few dozen nets the
dense O(n³) solve and the allocations dominate everything. Compounding it,
`findNet()` is a linear scan of all nets × all terminals, called several times per
element per stamp per iteration. Imported boards (dozens–hundreds of nets) pay all
of this per UI tick, times up to 200 transient sub-steps, times up to 50 NR
iterations, times the 10-round device fixpoint.

## Proposal

1. **Terminal→row map** built once per `setNetlist` (and on ground-merge), replacing
   every `findNet` scan. Pure win, no numerics change.
2. **Non-mutating ground merge**: the vcc/gnd net-merge currently `splice`s the
   caller's `nets` array; make it a solver-local index mapping. (Board's netlist
   stops being rewritten by the first solve.)
3. **Assembly**: stamps write (row, col, value) triplets → compressed sparse column.
   The stamp API (`ctx.conductance`/`thevenin`/`current`, device stamps) is
   unchanged; only the sink changes.
4. **Numeric kernel**: sparse LU with partial pivoting and Markowitz-style or
   AMD/COLAMD ordering. **Symbolic factorization (pattern + ordering) is computed
   once per topology** and reused across NR iterations and transient sub-steps;
   numeric refactor only when values change; **RHS-only forward/back solve** when
   only b changed (linear circuit between events). Region-FSM flips (BJT/MOS/opamp/
   CC-clamp) change values but not pattern — pattern survives; a netlist change
   invalidates everything.
5. Dense path retained under a size threshold (dim ≤ ~12) if profiling says the
   constant factor wins there; otherwise deleted. One code path preferred.

## Licence constraints (binding)

- Permitted sources to port/adapt: **Kundert Sparse 1.3/1.4** (MIT-class, SPICE3's
  own solver), **@spice-ts/core**'s Gilbert-Peierls LU (MIT, with attribution in
  THIRD-PARTY.md), **SuperLU** as a paper/reference (BSD-3, excluding its MC64 path),
  AMD/COLAMD ordering (BSD-3).
- **Forbidden: KLU, BTF, CSparse/CXSparse, and mathjs's sparse module (verbatim
  CSparse) — all LGPL. Do not use, port, or read them while implementing.**

## MNA impact

This is the largest mna.js change to date. Land in three separately-tested commits:
(a) terminal map + non-mutating merge, (b) triplet assembly still solved densely,
(c) sparse kernel + reuse. Each commit keeps the full oracle suite green.

## Acceptance

1. **Bit-comparable answers**: the 70 ngspice oracles, 55 Python oracles, and every
   hand-oracle in `test/` pass unchanged (tolerances already in place).
2. New hand oracles: a 3-node divider solved by hand; a 50-node resistor ladder with
   closed-form node voltages (V_k = V·k/N).
3. **Perf budget** (engineering-bar class): a 100-net, 300-element linear board —
   numeric refactor ≥ 10× faster than today's dense solve; RHS-only re-solve ≥ 50×;
   zero allocations in the steady-state solve loop (assert via allocation counter).
4. Non-convergence reporting behaviour unchanged.
5. `board.nets` deep-equals its pre-solve value after 1000 solves (mutation fix).
