# Matched transistor transient checks

The default piecewise transistor and an exponential SPICE transistor are different
models. Comparing their gains does not by itself identify a numerical error.
This repair addresses independently reproduced omissions in the explicit
exponential model: CJE/CJC/TF were used by AC analysis but absent from transient
integration, PNP ignored RB/RC, and non-UIC initialization omitted intrinsic
stored charge.

The transient now integrates the same depletion and forward diffusion charge
whose derivatives the existing AC calculation uses. It retains the SPICE3
undeclared defaults VJE=VJC=0.75 V, MJE=MJC=0.33 and FC=0.5. TF includes the
existing VAF/IKF charge law and its cross derivative. BE and trapezoidal history
use the existing accepted-step, snapshot, reset and error-controller state;
no convergence threshold or integration budget is relaxed. Zero charge fields
retain the memoryless path. Invalid charge and a piecewise model declaring
nonzero charge are refused on transient execution.

A zero-time algebraic read after a charge-bearing circuit edit is explicitly
not ready until an accepted transient step. This is not a failed capture and
does not latch a permanent scope error. A separately requested DC operating
point remains available in its existing supported domain.

Run:

```sh
node --test test/bjt-transient-charge.test.mjs test/bjt-transient-school-circuits.test.mjs
node scripts/verify-bjt-transient-oracle.mjs
node scripts/verify-bjt-transient-oracle.mjs --school
```

The oracle requires ngspice and makes no network requests. Each SPICE process
is bounded to 30 seconds, must finish the requested transient, and is compared
at the same times and with the same initial conditions. The quick cases cover
CJE, CJC and TF separately for NPN and PNP. The school cases cover three organ
trim resistances, released-key silence and a point-by-point amplifier waveform.
The numeric tolerances are stated in the script; a failure is not rerun or
accepted by adjusting them.

The organ reference is the OPITEC 107056 topology with a 180 kΩ series resistor,
1 MΩ base bleed, 3.3 nF/10 nF capacitors and an 8 Ω electrical speaker load. It
uses a stated 10 µs supply rise and a generic exponential card, not measured
BC548/558 parameters. At 500 kΩ, a 60 ms comparison measured 255.700 Hz versus
255.663 Hz in ngspice (about 0.015%); the peak is approximately 8.021 V in both.
The 20 ms automated comparisons also cover 1 MΩ and 150 kΩ and require frequency
agreement within 0.5% and peak agreement within 5 mV.

The amplifier reference is the Winkler PRINT 101455 topology, with a 100 kΩ
volume pot represented by two 50 kΩ legs, a 1 mV/1 kHz microphone test voltage
and an 8 Ω electrical output load. Both tools start from their DC operating
point. Across 801 matched samples the local comparison had about 40.9 µV maximum
and 24.8 µV RMS output error; peak-to-peak gains were 41.851 versus 41.817.
Those results qualify the stated model, not the real kit's gain, acoustic
speaker/microphone response, battery dynamics or speech intelligibility.

Rejected Newton trials are refined without publishing their state or latching
a measurement failure. Accepted failed steps and a failure at the existing
minimum step still invalidate measurements. The oracle also requires healthy
transient analysis status; matching numbers alone cannot qualify a failed run.

The open-terminal audit additionally guards diode/LED/zener stamps and Newton
bookkeeping, two-terminal passive current readback, and each potentiometer leg
independently. An absent terminal contributes neither a ground load nor phantom
current. Twenty controls exercise both orientations and connected rheostat legs.

A browser integration check ran the native organ through the live Board clock,
the actual ScopePanel and Web Audio capture replay, stop and WAV export. The
time-domain pulse repetition was 255.700 Hz with nonzero rendered audio. The
largest FFT peak can be a harmonic of this narrow-pulse waveform; it must not
be reported as the fundamental pitch. Replay is a finite electrical capture,
not a real-time acoustic speaker model.
