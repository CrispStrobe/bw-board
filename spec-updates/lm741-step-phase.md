# LM741 phase-varied waveform audit

## Scope (qualified linear-pole slice)

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

### Hosted qualification

Exact source `a5aa2b5ff2be9ea75ff6c25725c697e975fc757e` passes
[CI 38457137645](https://github.com/CrispStrobe/bw-board/actions/runs/38457137645)
and [Harris 38457137856](https://github.com/CrispStrobe/bw-board/actions/runs/38457137856).
The numerical suite reports 8,550 passed, zero failed and 302 unchanged
documented skips. Every enabled job passes; only the declared optional
full-vector job skips. Actual hidden history/reset, continuous 100 ns response,
package-output KCL and changed-supply/input refusals pass alongside existing
LM741 and other op-amp regressions.

An independent piecewise-reference/raw-log audit accepts all six cases:
1,200 paired voltage/current observations (2,400 scalar readings), 12 watched
means and 1,200 provisional timing records. Maximum point errors are
3.781350 nV and 0.378135 pA; maximum mean errors are 0.249721 pV and
0.024973 fA. These are agreement with the stated nominal continuous model,
not physical LM741 accuracy. Inputs match their authored grid values, sampled
scope voltages match the published solver voltages, and valid resistor-current
observations obey the independent load relationship. No scheduled wake or
learned-feedback controller is active.

All six experiments complete with exactly 200 charged integration advances,
including the four previously refused phases. Maximum actual work is
741 attempts and 2,217 solves, below the unchanged 20,000/60,001 ceilings.
The actual 20% input-amplitude mutant also completes and fails the unchanged
reference comparison. No accuracy tolerance, reference, grid or accounting
rule was relaxed. Earlier diagnostic failures remain recorded below.

### Explicit solver-native repair candidate

The runner now requests `transientModel: 'linear-pole'` on the physical `lm741`
package, with `inputOffsetV: 0`, `supplyPositiveV: 15` and
`supplyNegativeV: -15`. The absent-mode legacy controller is unchanged.
The shared nominal card supplies gain, bandwidth and impedances to both
implementations. A solver-only current source, capacitor and pole resistor
implement `du/dt = 2π*GBW*(Vin+ - Vin- - u/A0)`; a unity buffer and 600 Ω
output resistor drive the real output net. The original package remains for
its differential input resistance, admission and instrument-current mapping.
Hidden parts/nets are not added to the public drawn topology. The internal
30 pF realization choice is not an external LM741 capacitance claim: its
transconductance and pole resistance preserve GBW and A0 independently.

This first continuous mode admits one explicit ground reference, connected
signal/supply leads, open trim/NC pins and declared 10–36 V supply span.
Each supply must be a single ideal DC source connected to that reference;
waveforms, controls, extra pin sources, current limiting and nonzero source
resistance refuse. Declared values are checked against the actual physical
converged solution, not used in place of a solved supply. Explicit zero offset
is required; unknown parameters/modes and hidden identity collisions refuse.
The initialized mode and output-drive authority cannot change silently.

Final physical solutions must remain within the nominal common-mode/output
headroom, below the nominal slew bound, and below a conservative 1 mA output
load admission ceiling. These are named refusals, not clipping or an invented
current-limit model. This is cold-start linear dynamics, not supply startup,
large-signal saturation recovery, noise, input bias or physical supply-current
simulation. The package output-current reading is mapped from its exact
hidden output resistor; quiescent/dynamic supply currents remain unmodelled.

Six pure controls pass locally: expansion/card/default identity and caller
nonmutation; parameter/topology/solved-domain refusals; executable wrong-pole
and removed-slew-admission mutants; and the three existing phase/reference
controls. Hosted tests additionally check actual hidden charge/reset, the
100 ns response, no scheduled wake, output-port KCL and changed-source/input
refusals. All six dense phase captures and the completed amplitude mutation
remain mandatory with unchanged reference, grid, tolerances and whole work
budget. Local pure checks do not qualify this candidate's waveforms.

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

The initial audit made no production change; the qualified repair changes only
the explicit LM741 linear-pole mode. The legacy default, GUI, package pins and
deployment remain unchanged. No physical noise, bias spread, temperature, nonlinear slew, current
limiting, clipping or arbitrary feedback network is qualified. Those require
separate bounded cases. Existing tick-aligned or settled LM741 tests are not
dense continuous-waveform proof. A source repair needs an expanded canonical
claim and affected existing-model regression tests before landing. Regulator
startup and the broader instrument/CLI roadmap remain subsequent tasks.
