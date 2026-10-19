# Spec-update: vsource current-limit parameter

## Problem

The target inventory requires a "power supply source (settable V + current limit)".
The existing `vsource` part kind has voltage and waveform parameters but no current
limiting. A real bench power supply clamps its output when current exceeds the set
limit — it transitions from constant-voltage (CV) to constant-current (CC) mode.

## Proposal

Add an optional `iLimit` parameter to `vsource`:

```js
{ id: 'PS1', kind: 'vsource', params: { volts: 12, iLimit: 0.5 } }
```

When `iLimit` is present and non-null:
- In CV mode (normal): output behaves as today — Thévenin source with low R.
- In CC mode (overloaded): output voltage drops to whatever sustains `iLimit`
  through the load. The stamp changes from a voltage source to a current source.

## MNA impact

This requires the MNA solver to detect when branch current exceeds the limit and
switch the stamp — a nonlinear constraint. Two implementation options:

1. **Newton–Raphson iteration**: stamp as voltage source, check current after solve,
   if |I| > iLimit re-stamp as current source and re-solve. Converges in 1-2 extra
   iterations for typical loads.

2. **Companion model**: a piecewise-linear V-I curve — vertical (voltage source)
   below iLimit, horizontal (current source) above. Same as a diode companion but
   with different breakpoints.

Either way, this is an mna.js change. Filing for the coordinator.

## Interim workaround

Until the MNA change lands, a device-registry `power_supply` can approximate it:
- Stamp as Thévenin with rTh = volts / iLimit (the resistance that would limit
  current to iLimit at the rated voltage with a short circuit).
- This is electrically wrong for partial loads (the output voltage sags linearly
  with current instead of being flat then clamping), but it demonstrates the
  concept and prevents infinite current into a short.

## What the UI shows

The power supply displays its mode: "CV 12.0V" or "CC 0.50A". The mode is
readable via getDeviceState().
