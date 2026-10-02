# ADP7118 internal startup envelope

The default ADP7118 model remains its existing DC regulation contract. Select
the following explicit model on a fixed-output part to capture internal startup:

```js
{kind: 'adp7118', params: {vOut: 5, startupModel: 'datasheet-envelope'}}
```

Use a 1.2–5 V fixed output, an open SS terminal, and the existing EN/VIN/GND
and direct SENSE connections. An explicitly netted SS terminal is conservatively
refused, including a singleton SS net: this slice cannot qualify an external
SS network. Adjustable mode, authored external soft-start capacitance and
startup into a prebiased output also refuse by name. They are not simulated
as if the pin or stored charge were absent.

## Timing authority and interpolation

[ADI ADP7118 Rev.H, Table 1 and Soft Start](https://www.analog.com/media/en/technical-documentation/data-sheets/adp7118.pdf)
give typical EN-to-10% timing of 80 µs and EN-to-90% timing of 380 µs, with
the latter defined relative to the nominal output. These are typical timing
anchors, not minimum/maximum guarantees or a complete transient macromodel.

This model **chooses**, rather than claims ADI specified, a delayed exponential
envelope through those two points:

```text
tau   = (380 us - 80 us) / ln(9)
delay = 80 us + tau * ln(0.9)
f(t)  = 0                         when t <= delay
f(t)  = 1 - exp(-(t-delay)/tau)    otherwise
```

The existing feedback reference becomes `vOut * f(t)` from the qualified
enable transition. Scheduled 5 µs updates use the engine's existing device
deadline mechanism; scope/adaptive substeps can update more often. The output
capacitor remains a real circuit element. Dropout, current limits and input/
output/ground current accounting retain their existing equations. The opt-in
actuator additionally bounds the output drive to forward current at or below
the selected current limit and applies anti-windup. The old DC load-line
controller is not applied to a charging capacitor or changed on the default path.

EN/UVLO hysteresis does not restart an already enabled device. A real disable
clears startup progress. In this opt-in mode the disabled output is high
impedance, allowing its actual external RC network to discharge; the legacy
DC path is unchanged. A subsequent start with residual positive output charge
refuses instead of inventing active discharge or prebias recovery behavior.

`getDeviceState()` exposes `startupModel` and `startupFraction`. These identify
the interpolation being executed, not an independent accuracy certificate.

## Proof and limits

Focused tests use the real Board, a 2.2 µF output capacitor and 500 Ω load,
the two datasheet timing anchors, voltage scaling, charging current and complete
device KCL. Scope history must contain the finite monotonic ramp. Restart,
hysteresis, UVLO, shutdown RC decay, current limit, invalid parameters and
unsupported SS/prebias configurations have explicit controls. Existing DC
ADP7118/LT1763 cases remain unchanged.
Charging-current observations are explicitly caller-sampled at real 10 µs
instants; engine-clock voltage scope capture is checked separately. They are
not claimed to be an automatically clocked current-channel waveform.
Four in-memory executable production mutants bypass the ramp, retain a stale
restart clock, drop the SS refusal or bypass the current ceiling. Each must
fail its actual Board caller consequence; the registry is restored in `finally`
and the source file remains byte-unchanged.

The interpolated waveform is not vendor transistor-model agreement. External
CSS, adjustable-mode noise-reduction networks, overshoot, load-step feedback,
capacitive-load stability, noise/PSRR, temperature and thermal shutdown remain
outside its qualification. LT1763 startup behavior is unchanged. No GUI,
importer or downstream package adoption is implied by the upstream model.
