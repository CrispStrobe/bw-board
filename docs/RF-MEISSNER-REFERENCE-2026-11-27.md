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

Removing the 5 µs smoothing (`CURRENT_TAU_SEC` → 0) makes 20 µs advances
from power-on steady again (8.69–8.93 V); its cost and its effect on the
other RF controls are being measured.

## Consequences

* `lab-meissner-squegg`'s squegging assertions (quiet below 10 mV, bursts,
  a detector swing, a tone of 820 ± 250 Hz) are **physically false for the
  authored circuit**. A correct engine fails them. No engine change can make
  that scenario "genuinely green"; the bench needs a circuit that squegs in
  the carrier reference, and the engine must then reproduce that.
* The engine's target for the authored circuit is steady at ~8.98 V under
  every step cap and advance schedule.
