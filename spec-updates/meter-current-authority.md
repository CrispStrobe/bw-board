# Current-meter authority

A powered current meter requires a finite current explicitly represented at
the selected part terminal. Current-value validation reports missing
part/terminal authority as `MISSING_BRANCH_CURRENT` and a present nonfinite
value as `NONFINITE_BRANCH_CURRENT`. Neither condition is a measured zero. A represented
finite zero, including signed zero, remains valid.

The existing failed-solve and indeterminate-source checks take priority.
Current signs remain **out of the part terminal**, and the meter retains its
existing observation window and mean calculation. Power-off behavior is
unchanged. If an accepted sample or accepted midpoint/end loses current
authority, its watch retains the failure and refuses later means. A later
transient-accuracy failure may replace the reason under the existing policy;
it cannot restore a reading. Later mean reads retain the existing
`meter mean refused` prefix. This
failure does not abort unrelated simulation or erase another meter's reading.
Unknown programming errors still propagate.

## Signal-model scope

An authored assessment used eleven related requests covering two intended
topologies and controls, not eleven distinct circuit designs. The nominal
noninverting LM741 bench used fixed ±15 V rails, explicit zero offset, equal
4.7 kΩ feedback resistors, a 100 kΩ load and a 10 µs input ramp. Its 20 µs
captures produced approximately ±0.999989 V output endpoints and ±0.732945 V
window-mean voltage readings. These are different observation quantities.

The signal model does not represent LM741 physical quiescent supply or bias
current. A connected supply pin previously returned zero through the meter's
missing-current fallback. It now refuses that unsupported observation. Adding
a separate rail resistor measures that resistor's network demand, not the
chip's missing consumption law. Represented output and load currents remain
available; this change adds no device-current stamps or chip physics.

The [TI LM741 datasheet](https://www.ti.com/lit/ds/symlink/lm741.pdf)
provides manufacturer operating conditions and nominal component facts. The
authored bench is a bounded model assessment, not a factory-grade waveform or
physical-device certificate. In particular, the model's 600 Ω output resistance
is an implementation choice. No new quiescent-current, bias, noise, temperature,
overload or physical oscilloscope accuracy claim follows from this repair.

## Executable boundary

`test/meter-current-authority.test.mjs` checks actual resistor zero/nonzero
signs and the actual signal-model LM741 unsupported rail port. Fault-injected
accepted, midpoint and endpoint maps exercise missing/nonfinite authority and
failure latching without inventing an electrical model. Restoring the former
zero fallback fails the unsupported-port assertion; rejecting genuine zero
fails the real resistor control. Existing meter, scope and LM741 regressions
remain required, along with affected clean qualification before adoption.
