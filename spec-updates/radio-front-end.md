# Radio front end and loudspeaker (round 3, 2026-11-23)

New kinds: `speaker`, `earphone` (src/transducers.js) and `antenna`,
`earth`, `tuning_cap`, `ferrite_coil` (src/radio.js), plus a `1N34A`
germanium detector card (src/parts-library.js). Board API:
`setBroadcast(stations)`, `getBroadcast()`, `radioReport()`,
`rfVoltage(netId)`, `refreshRadio()`; `buzzerTone(id)` covers the speaker
and earphone with `{hz, on, level, amps}`.

## Parts

| kind | terminals | params (defaults) |
|---|---|---|
| speaker | a, b | ohms 8, henrys 2e-4, ratedWatts 0.5; motional impedance when `resonanceHz` is set: motionalOhms 20, qm 2 |
| earphone | a, b | type 'magnetic' (ohms 2000, henrys 0.1) or 'crystal' (capacitance 10 nF, leakOhms 10 MΩ); ratedWatts 1e-3 |
| antenna | a | heightM 5 (effective height), ohms 50, farads 200e-12; optional `stations` overriding the board's broadcast |
| earth | earth | ohms 30 |
| tuning_cap | a, b | minFarads 10 pF, maxFarads 500 pF, position 0.5; a control like the potentiometer (C linear in position) |
| ferrite_coil | a, tap, b, c1, c2 | henrys 250 µH (a–b), tap 0.25 (turns fraction from a), couplingRatio 0.1, k 0.98, couplingK 0.9, q 120 |

## Why the carrier is not simulated

A 1 MHz carrier needs ~20 transient steps per cycle: 2·10⁷ steps per
simulated second, for a circuit whose interesting output is audio. The
radio is therefore split the way envelope (harmonic-balance) simulators
split it; the module note in src/radio.js has the derivations.

1. **RF is linear and solved as phasors.** The antenna is an EMF
   (field × effective height) behind its resistance and its capacitance to
   earth. The engine's own small-signal AC solver (src/ac.js) solves the
   whole circuit at every station's carrier, linearised at the present
   audio-rate operating point: tank, tap, coupling winding (all windings of
   the ferrite coil fully coupled, with loss from its Q), transistors at
   gm = Ic/Vt with Cπ from fT. Output: the complex carrier voltage across
   every junction, per station. Refreshed every 2 ms of simulated time and
   at once when a control moves; blended over 1 ms so the envelope never
   steps.
2. **Detection is the cycle-averaged junction law.** A junction with an RF
   swing A carries `Is·e^{v/nVt}·I0(A/nVt)` on average (square law for
   small A, a peak detector for large A). Every diode and transistor B-E
   junction of a circuit with an antenna gets a solver-only companion
   (`rf_detect`) adding `Is·e^{v/nVt}·(I0(x) − 1)`, zero without RF. The
   envelope A(t) is evaluated at each solve from the stations' modulation,
   so the detected audio is ordinary transient behaviour.
3. **Detector loading** closes the loop: each diode detector's
   describing-function conductance at its self-consistent bias on its DC
   load (estimated from its own smoothed voltage and current), solved
   against the detector's Thevenin equivalent per carrier by bisection
   (monotone). Transistors are compressed by g(x) = 2·I1(x)/(x·I0(x)).
4. **Interference** is the composite envelope: stations within 10 kHz of
   the strongest keep their exact beat (adjacent-channel whistle), others
   enter as a random-phase component averaged over the beat (crosstalk,
   weak-signal suppression), so nothing aliases at audio-rate steps.

The transient step is capped at a tenth of the shortest programme or beat
period (`rf-envelope-fidelity` in `transientAnalysisStatus`).

## Speaker and earphone

A voice coil, Re + Le, on a hidden node that is also the part's own
`coil` terminal in the solver view, so the device model reads its coil
current. Optional motional impedance R‖L‖C (Thiele/Small). Pitch from the
coil current's crossings (as the piezo), loudness `level = I_rms/I_rated`
(I_rated = √(ratedWatts/Re)), capped at 1. A crystal earphone is a piezo
capacitance read by voltage (1 V rms = full level).

## Not modelled

Oscillation at RF (a regenerative receiver past threshold, a Meissner
oscillator: the phasor solve is linear), RF harmonics and intermodulation,
diode junction capacitance and series resistance in the averaged law, the
ferrite coil's coupling winding in the TIME domain when all three windings
are wired (exact in the RF solve; with two windings the time-domain view
is the engine's `transformer`). A transient resistor ωL (at 1 MHz) across
each ferrite winding damps the tank's RF mode in the time domain only.

## Unaffected circuits

`expandTransducers`/`expandRadio` return their input untouched when the
circuit has none of the new kinds; without an antenna there is no
RadioFrontEnd, no detector companion, no step cap and no accept hook.
src/ac.js changes are opt-in (`args.rf`), plus one fix: a Newton-solved
macromodel stage (LM386, LM358) is now linearised by its Jacobian in the
AC sweep instead of throwing.
