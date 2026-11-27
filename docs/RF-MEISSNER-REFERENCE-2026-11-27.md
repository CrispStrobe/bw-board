# Meissner squegging bench: a full-carrier reference (2026-11-27)

sb3-creator's `lab-meissner-squegg` asserts that the authored Meissner
transmitter, with its 1 µF emitter bypass switched in, **squegs**: RF below
10 mV between bursts, an earphone tone of 820 ± 250 Hz. On bw-board the
answer has depended on numerics: steady at the default step and the
scenario's advance schedule, bursting at ~2.7–2.8 kHz with any outer-step
cap or with 20 µs advances from power-on, ~2.15 kHz with the stale-history
repair of `codex/rf-bias-history-2026-11-27`. Every earlier "reference" refined
only one half of the coupled envelope/DC trajectory (sb3-creator
`docs/RF-DIRECT-CONVERSION-QUALIFICATION.md`), so none settled it.

This one does not use the envelope at all.

## The reference

`test/golden/run_ngspice_meissner.py` integrates the **carrier itself**
(~800 kHz) in ngspice 47, with the values bw-board resolves for the bench
(each source line is named in the script: ferrite windings and Q, tuning
capacitors, link coefficient, pot and switches, Q_DEFAULT transistor with the
RF view's Cjc/fT, 1N34A, crystal earphone). Summary:
`test/golden/ngspice_meissner_squegg.json`. Window 6–9 ms, as the scenario.

| Run | Carrier envelope (V) | Emitter (V) | Bias node (V) | Detector (V) |
| --- | ---: | ---: | ---: | ---: |
| gear, 20 ns max step | 8.967–8.982 | 0.0528–0.0530 | 0.520–0.529 | 1.029–1.038 |
| gear, 10 ns | 8.973–8.984 | 0.0516–0.0518 | 0.518–0.528 | 1.035–1.044 |
| trapezoidal, 10 ns | 8.975–8.988 | 0.0514–0.0516 | 0.518–0.527 | 1.037–1.045 |
| gear, 5 ns, reltol 1e-5 | 8.984–8.987 | 0.0514–0.0516 | 0.518–0.527 | 1.037–1.045 |
| from the DC operating point, kicked | 8.970–8.984 | 0.0519–0.0543 | 0.519–0.530 | 1.035–1.044 |
| from the squeg-entry state (tank quiet, bias at −0.4 V) | 8.973–8.984 | 0.0516–0.0518 | 0.518–0.528 | 1.035–1.044 |
| transistor Is 1e-13, Vaf 100, Rb 50 | 9.002–9.010 | 0.0527–0.0530 | 0.463–0.472 | 1.047–1.056 |
| small bypass (steady case, 22–25 ms) | 8.933–8.944 | 0.034–0.076 | 0.529–0.539 | 1.002–1.011 |
| coupling winding reversed (5–8 ms) | 0.0000 | 1.039 | 1.695 | 0.000 |

No run has a burst. Step, method, tolerance, start state and transistor
card change the envelope by at most 0.4 %.

**The authored circuit does not squeg.** With the slow bypass it oscillates
steadily at ~8.98 V; the small-bypass and reversed-winding controls agree
with the scenario (8.94 V against the asserted 8.89 ± 0.1 V; silent).

### Why it cannot squeg

The amplitude is held by the collector bottoming out (the base–collector
junction conducting at each trough), not by the bias. The bias network
cannot then over-run: the run from the squeg-entry state (tank quiet, the
4.7 nF bias capacitor at −0.4 V) restarts once at ~0.36 ms, overshoots to
10.06 V for about one microsecond, pulls the bias node from 0.625 V to
0.477 V (0.15 V) and holds 9.03 V from the next microsecond on.

The emitter bypass hardly takes part: the emitter sits at 0.05 V with the
1 µF in or out; the self-bias forms at the base node (Cb 4.7 nF behind
710 kΩ).

## What bw-board does wrong

On `b47e7e09`, the same entry, traced every 0.5 µs: at the start of a burst
the base node falls from 0.748 V to −0.216 V within 30 µs (SPICE: 0.15 V
within ~2 µs) and keeps falling, the transistor is cut off from the second
microsecond (v_BE −0.05 V and below), yet the band's transconductance keeps
pumping the tank for ~25 µs: it is taken from the collector current
**smoothed over `CURRENT_TAU_SEC` (5 µs)**, which decays from 1.9 mA with a
~7 µs time constant after the device has stopped conducting. The tank swing
creeps from 9.0 V to 9.88 V; the base–collector clamp, whose rectified current
is drawn from the base alone, drains Cb ~5× further than the carrier run
does. The base is then far below cut-off, the swing decays with the tank's
own Q, Cb recharges through 710 kΩ (2.55 V/ms) and the cycle repeats: a
~2.8–3.1 kHz numerical squeg.

Measured on `b47e7e09` (`sb3-creator` bench, `sbig` = 0, window 6–9 ms):

| Advance schedule / outer cap | RF min–max (V) | Tone |
| --- | ---: | ---: |
| `run(6)` then 20 µs (the scenario) | 8.897–8.908 | none |
| 0.5 ms advances | 8.900–8.908 | none |
| 20 µs advances from power-on | 0.00012–9.84 | 2784 Hz |
| `run(6)`, outer step ≤ 1 µs | 0.0014–9.61 | 2782 Hz |
| `run(6)`, outer step ≤ 0.25 µs | 0.0023–9.63 | 2723 Hz |
| 0.5 ms advances, outer step ≤ 1 µs | 0.0010–9.71 | 2780 Hz |

The steady answer at the scenario's schedule agrees with the carrier run
(8.90 V against 8.98 V, bias node 0.58 V against 0.52 V: the generic
transistor's piecewise knee against Shockley's law). The bursting answers
are the artefact. The stale-history repair removes a masking effect and so
moves the default schedule onto the bursting branch too.

Removing the 5 µs smoothing altogether (`CURRENT_TAU_SEC` → 0) makes 20 µs
advances from power-on steady again (8.69–8.93 V), at six times the work
(41 461 solves at the scenario's schedule against 6 730).

## Repair attempts: none qualified

Both candidates are kept, with their measurements, on
`r11/rf-bias-gm-candidates-20261127`. Master is unchanged.
`test/radio-meissner-reference.test.mjs` is the executable witness: it fails
on master (20 µs advances squeg, 0.002–9.52 V) and is marked `todo` until a
repair passes it together with the existing RF controls.

**A. Smooth the swing, not the current** (`dbb65169`). The rectified part
was taken from the companion's law at the accepted bias, with Σ ln I0
smoothed over `CURRENT_TAU_SEC`. On the Meissner bench it gave 8.916–8.921 V
under every schedule, with the emitter at 0.051 V (reference 0.052 V) and
fewer solves (4 993 instead of 6 730). **Rejected:** the rectified current is
e^(v_BE + ln I0), and in class C the two terms cancel. Lagging one of them
starves oscillators. A superhet's local oscillator ran at 3.5 µA instead of
0.75 mA, and four radio-mixing controls failed locally.

**B. Smooth a transistor's current rising only; follow it at once when it
falls** (`2f714359`). Meissner: 8.895–8.915 V under every schedule
(8 173 / 5 551 / 27 736 solves for a 6 ms advance / 20 µs advances / a
1 µs outer cap). **Rejected:** hosted CI run 46075189076 fails five
radio-envelope-bands controls:
- a regenerative stage past its threshold now squegs, 0.001–7.287 V;
- the VHF Colpitts swing wanders, 5.52–8.29 V;
- the resonance-scan control oscillates at only 0.27 V;
- the short-wave beacon beat is 775 Hz against 1850 ± 300 Hz;
- the platform fingerprint reads 946 solves against 949.

A falling-only time constant of 1 µs passes two of those controls, and 2 µs
fails one again. A knob whose outcome is not monotone in its value is not a
repair.

**Diagnosis.** All three behaviours come from the same scheme. The band
uses the bias of the last accepted step, and the transient solve uses the
band's swing as a given function of time. That is an explicit coupling of a
stiff loop: the rectified current answers the swing exponentially. Each
filter on the exchanged current moves the spurious relaxation from one
circuit to another. A real repair has to make the exchange consistent
within the step, for example by re-integrating the band over the step with
the trial bias and iterating to agreement, or by solving the junction's
DC/RF balance jointly. It cannot just retune `CURRENT_TAU_SEC`.

## Not repaired: strong feedback

The same bench with `couplingRatio` 0.2 does squeg in the carrier run
(bursts of 13 V every 0.96 ms, ~1040 Hz, RF below 1 µV between them; steady
8.95 V without the slow bypass; the 5–8 ms traces are in the script's
style, `couplingRatio` 0.1 bursts at ~2300 Hz). The engine runs that variant
steadily at 8.89 V (with candidate A; on master its band runs away at ~2 ms). Its first-
order mode estimate places the stage's growth (σ ≈ 2.6·10⁷ s⁻¹) hundreds of
kHz off the band's centre, where `_own` discards it, so the band steps at
16 µs and backward Euler damps a growth it should resolve. That is a
separate defect of strongly fed-back stages and is not claimed here. Note
also that in that variant the linked receiver's detector swings only
0.02–0.11 V (the bursts are short and the receiver 11 kHz off): the
scenario's "> 0.5 V detector swing" would fail physically there too.

## Consequences

* `lab-meissner-squegg`'s squegging assertions (quiet below 10 mV, bursts,
  a detector swing, a tone of 820 ± 250 Hz) are **physically false for the
  authored circuit**. A correct engine fails them. No engine change can make
  that scenario "genuinely green"; the bench needs a circuit that squegs in
  the carrier reference, and the engine must then reproduce that.
* The engine's target for the authored circuit is steady at ~8.98 V under
  every step cap and advance schedule. Master reaches it only at coarse
  steps; no repair is qualified yet.
