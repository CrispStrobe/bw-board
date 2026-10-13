# LM741 phase-varied waveform audit

## Scope (implemented diagnostics, not qualified)

Six loaded followers: positive/negative 10 mV input changes at 10 µs plus
0, 33 or 67 ns. Supplies are ±15 V, offset is explicitly zero and load is
10 kΩ. Each input change is an authored 1 ns ramp. The entire 20 µs experiment,
including the initially quiescent interval, uses one precision-profile
20,000-attempt / 60,001-solve / 200-advance budget. No warm-up resets or budget
renewals hide startup work. There are 200 simultaneous voltage/current
observations on a 100 ns grid; watched means cover 100 ns through 20 µs.

The independent reference is a **continuous linear model**, not a vendor
transistor macromodel or measured physical LM741. It has finite open-loop gain
200,000, 1 MHz gain-bandwidth, output resistance 600 Ω and differential input
resistance 2 MΩ, matching the bounded card's nominal numbers. KCL at the loaded
output gives `y = k*u + d*Vin`, with conductance-derived `k` and `d`.
For open-loop `A(s) = A0/(1+s/wp)`, `wp = 2π*GBW/A0`, follower transfer is
`H(s) = (k*A(s)+d)/(1+k*A(s))`. The finite input ramp and watched means are
integrated analytically. No inferred controller beta, device wake times or
observed output is used to calculate expected values.

This intentionally tests whether the implementation agrees with that continuous
model between its update ticks and across event phases. Its learned-feedback
controller is not itself an oracle. A disagreement may require a timestep,
startup/controller or model-definition repair; it must be diagnosed from the
actual hosted trace before changing production. The six cases use fixed
100 µV / 10 nA bounds. No future larger-signal or nonlinear model's tolerances
are inferred from these small-signal bounds.

`node scripts/qualify-lm741-step-phase.mjs` emits all six case reports and exits
nonzero on any disagreement or refusal. `--case lm741-pos-33` selects a
reviewed case without changing bounds, sample spacing or budgets. Partial
captures/refusals remain failed reports. Hosted output retains summaries,
every comparison, work/profile and diagnostic powered/common-mode/update-tick
state. The latter is evidence only, never an input to the reference.

Three local pure controls cover immutable phases, sign and independently
numerically checked analytic integrals; whole-capture/last-point/mean refusals;
and executable wrong-pole/final-point mutations. Actual engine runs stay
hosted. If all six baseline cases agree, an actual 20% input-amplitude mutation
must complete and disagree; refusal does not satisfy that proof. If baseline
cases disagree, the mutation is not reached and qualification is withheld.

## Limits and follow-ons

### Initial hosted failure and forward diagnostics

Source `c63732511caf21b1654dfe545bf46029f969406f`, numerical job in
[CI 38443238986](https://github.com/CrispStrobe/bw-board/actions/runs/38443238986),
failed the actual six-case gate: 8,544 passed, one failed, 302 documented skips.
The two zero-phase cases completed but disagreed by up to 8.302436 mV;
at 10.1 µs the positive case reported 2.829388 µV versus 4.456190 mV expected.
Reported mean error was 101.967930 µV. Four 33/67 ns cases exhausted the
200-advance limit at 19.4 µs after 193 observer callbacks. Actual attempts and
solves remained within their separate budgets. The amplitude mutation was not
reached; no negative-control completion or waveform qualification is claimed.

The independent audit rederived the reference using a different piecewise ramp
solution and checked the two completed cases' samples, means and resistor-current
identity. Forward diagnostics add actual input/output/current and controller
drive/wake/update observations to each existing callback, explicitly provisional
until the final whole-capture receipt. They retain the partial observations on
budget refusal without grading them as complete. No production code, reference,
accuracy bound, work ceiling or sample grid is changed. A fresh changed-head run
is required to distinguish input timing, controller timing and integration-call
accounting before choosing a repair; the failed source is not rerun unchanged.
Observers read already-published voltage/current maps directly, not public
getters that may refresh a solve. Missing currents remain null and snapshot
presence/convergence/dirty markers are retained. These observations are
provisional evidence, never a replacement for completed instrument captures.

### Actual timing diagnostic

Source `bb0200f29c0063498eb3903417ead073b1317d5a` in
[CI 38448865246](https://github.com/CrispStrobe/bw-board/actions/runs/38448865246)
preserves the same six-case failure. Independent inspection of all 1,172
provisional observations finds no input-grid deviations; completed scope
voltages equal the already-published output voltages. The valid published
resistor currents also obey the output/load relationship. The observer does
not change the baseline work counts or the two completed waveforms.

For the positive zero-phase case, input is 10 mV at 10.1 µs while the internal
output drive remains zero until 10.3 µs. The output is only the differential
input-resistance feedthrough, 2.829388 µV, at 10.1–10.3 µs. At 10.3 µs the
drive becomes 8.479242 mV, but the published solution still uses the preceding
drive; the 10.4 µs observation shows the resulting 7.999851 mV output.
Subsequent drive updates occur at 10.6, 10.9 and 11.2 µs. Negative cases are
sign-symmetric. Offset phases shift those actual wake times to 10.333 or
10.367 µs and split observer intervals, consuming integration advances.

This identifies a discrete controller/publication delay, not a wrong authored
input or a scope-only rendering defect. It does not establish the correctness
of a replacement controller. The numerical gate remains red, the amplitude
mutation remains unreached, and this diagnostic source is not landable.
A continuous solver-native pole is a repair candidate: the existing generic
op-amp macromodel already integrates its hidden capacitor through MNA rather
than scheduled controller ticks. Adapting that route to a physical LM741 needs
explicit supply, offset, input loading, clipping and unsupported-domain
contracts; substituting a generic ideal op-amp is not a repair. Any such work
requires a fresh bounded claim and affected regression qualification.

No production, default model, GUI, package or deployment change is made by this
audit. No physical noise, bias spread, temperature, nonlinear slew, current
limiting, clipping or arbitrary feedback network is qualified. Those require
separate bounded cases. Existing tick-aligned or settled LM741 tests are not
dense continuous-waveform proof. A source repair needs an expanded canonical
claim and affected existing-model regression tests before landing. Regulator
startup and the broader instrument/CLI roadmap remain subsequent tasks.
