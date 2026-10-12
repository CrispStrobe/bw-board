# Finite winding precision diagnostic

This is an evidence tool, not a solver repair or a waveform-fidelity certificate.
It uses the existing authored 5 V, 5 mH / 10 ohm exponential NPN winding with
flyback diode and explicit 12 pF / 10 Mohm probe load. Device equations, source
corners, precision policy and whole-capture ceilings remain unchanged.

Run from the repository root:

```sh
node scripts/diagnose-winding-transient.mjs --case zero-storage --profile precision-v1
node scripts/diagnose-winding-transient.mjs --case time-zero-op --profile precision-v1
node scripts/diagnose-winding-transient.mjs --case dc-turnoff --profile precision-v1
```

JSON records the actual initial capacitor voltage and inductor current, public
operating-point receipt when selected, exact bounded receipt, failure status,
work counts and provisional observation values. Every capture retains one
20000-attempt / 60001-solve / 200-advance authority. Samples are not qualified
merely because the observer received them. Exit 1 means incomplete or inaccurate
capture; exit 0 means completed within that engine policy, **not SPICE agreement**.

The default zero-storage pulse rises for 1 us, stays high for 1 ms and falls
for 1 us. Its falling edge ends at 1.002 ms. The diagnostic ends at 1.01 ms
with 20 us observation intervals. The separately selected time-zero OP charges
the collector capacitor before simulation; it is intentionally not an equivalent
initial state. The DC control starts with drive high at its solved operating
point, falls from 1 us to 2 us, and captures 20 us at 100 ns intervals.

The current zero-storage regression explicitly checks preservation of the known
precision refusal. A passing diagnostic test does not count this circuit as
working. A later repair must replace that known-failure assertion with genuine
completion and independently refined waveform agreement, without substituting
OP initial storage, increasing work/error bounds or clearing the failure latch.
Reference comparisons must explicitly match initialization and physical load.

Runtime diagnosis is hosted. No current measurements or new reference agreement
are asserted by the source-only preparation of this tool. Late nonlinear ringing
and unloaded turn-off remain separate from the existing bounded sample and
passive RLC instrument qualifications.
