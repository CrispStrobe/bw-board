# Room fields and junction noise (round 4, 2026-11-23)

New kind `field_probe` (src/fields.js, src/devices/field-parts.js); new
params `bvEbo` (npn/pnp) and `bv` (diode) with avalanche noise. Board API:
`fieldReport()`; `buzzerTone()` of a speaker/earphone gains `irregularity`
and `noise`. Circuits with neither a probe nor a breakdown param are
untouched (`expandFields` returns its input arrays).

## field_probe

| param | default | meaning |
|---|---|---|
| source | 'mains' | 'mains' (live cable), 'charge' (rubbed ruler), 'body' (finger) |
| position | 0 | knob 0..1: how close the source is (a control; a change moves over moveSeconds) |
| maxFarads | 2 pF (charge: 0.1 pF) | coupling at position 1 |
| strayFarads / leakOhms | 5 pF / 1 TΩ | the wire's own capacitance and leak to the room |
| mainsVolts / mainsHz | 230 / 50 | the room's mains |
| commonFarads | 50 pF | the circuit common's capacitance to the room (1 TΩ leak) |
| adaptorFarads | 0 | > 0: powered from a mains adaptor, common coupled to half the mains |
| rodVolts / moveSeconds | 10 kV / 0.2 s | the ruler; how long a hand movement takes |
| contact, skinOhms, paperFarads | 'skin', 1 MΩ, 20 pF | the finger: through skin or paper |
| bodyMainsFarads / bodyEarthFarads | 3 pF / 150 pF | the body's coupling to wiring and floor |

Coupling C(t) = maxFarads·x(t) is the solver's capacitor with live farads
(C·dv/dt) in parallel with a conductance dC/dt (v·dC/dt): together
d(C·v)/dt, so a moving ruler drives a current and a still one leaves charge.

## Reverse breakdown and noise

I = ibv·e^{(vr−bv)/(n·Vt)} (ibv 10 µA, n 1) across B-E (npn emitter
positive) or a diode (cathode positive); current noise S_i = 2qI·F
(`noiseFactor` 1e7, `noise: false` off), deterministic (seed `noiseSeed` or
hash of the id), band `noiseBandwidthHz` (2.5 kHz). Amplitude follows the
last accepted breakdown current. Steps capped at 1/(2B) only while a junction
carries ≥ 10 nA of breakdown current.

## Not modelled
1/f/popcorn noise, forward-junction and resistor noise, breakdown voltage
temperature drift, charge decay on the ruler, mains harmonics.
