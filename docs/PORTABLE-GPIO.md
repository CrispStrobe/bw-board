# Portable digital GPIO profiles

## Feature branch ownership

Owner: ChatGPT, continuing CrispStrobe's branch-only CrispBASIC work.
Base: `cc18f3c8d84d68e008450e65ddf838b8ec03c7f7`, the consumer's exact pin.
Feature branch: `feature/crispbasic-machine-profiles-20261128`.
Scope: new `src/portable-gpio.js`, `test/portable-gpio.test.mjs` and this guide.

Reuse the existing registered board models and Boundary A electrical solver.
Add explicit, immutable logical-pin profiles for host-driven digital simulation,
preserving existing Arduino, Pico and generic STC numbering. Validate actual
terminals, unique mappings, single-controller ownership and model logic voltage
before admitting a host. Qualify each admitted family with solved output/input
voltages and state release. Unknown models and ambiguous aliases remain
unavailable.

These profiles do not install an interpreter on a CPU, claim firmware or physical
hardware execution, or enable analog/PWM/interrupt operations. The user requested
incremental remote feature-branch preservation. This claim and candidate stay on
that branch; no default branch is merged. Consumers adopt the exact producer SHA.
