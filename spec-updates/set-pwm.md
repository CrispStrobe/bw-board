# Spec-update: setPwm — a driven PWM, switched by the board

## Problem

Measured 2026-09-29 (Lite task B1). Every route that runs firmware on an
emulated timer already reached the circuit with its duty: avr8js publishes
the OCR1A edges, rp2040js the PWM-slice edges, the STM32F0 light tier TIM3,
emu8051 the PCA, each through `setPin` after `advanceTo`. `analogWrite(9, 64)`
into 220 Ω + red LED averaged 25.1 % of full-on, a DC motor's speed and a
servo's angle followed too (test/pwm-duty.test.mjs holds all three).

Every host WITHOUT a cycle-level timer could only say "this pin is at N %",
and the board had nowhere to put it:

- the stc12 JS/Python drivers sb3-creator emits call `_board().setPwm(pin,
  percent)` guarded on it existing — no board had it, so a `set <pin> to 25
  percent` was a silent no-op (the defect `setTone` had);
- the MakeCode simulator bridge and the micro:bit+ extension drove
  `setPin(pin, 'pushpull', value >= half)`: 25 % read **0 mA** (dark), 75 %
  read **12.549 mA** (full on).

## Adopted API (boundary A, host side)

```ts
setPwm(pin: PinId, percent: number, opts?: {hz?: number, pulseUs?: number}): boolean
getPwm(pin: PinId): {duty: number, hz: number} | null
```

- `percent` is the fraction of each period the pin is driven HIGH, 0..100,
  clamped. Polarity (active-low parts) is the caller's, as with `setPin`.
- `hz` defaults to 500 Hz. `pulseUs` gives the HIGH time directly and
  overrides `percent` — a servo frame is `{hz: 50, pulseUs: 1500}`.
- A direct `setPin` on the pin takes it back (the timer stops), exactly as a
  direct write stops a driven tone. Re-issuing the same PWM keeps its phase.
- 0 % and 100 % are steady levels with no edges.
- A non-number is refused (false) and recorded in `getWarnings()`.
- The PWM is a pin state: it survives `setNetlist`, and `snapshot`/`restore`
  carry it (the designer restores around every edit); `reset` clears it.

## Model: true switching, not an average

The board switches the pin itself: `advanceTo` is split at each edge of each
driven PWM and every edge is a real `setPin` at its exact time. So a driven
PWM reaches the circuit exactly as an emulated timer's does, and every
consumer reads it with no PWM-specific code: `ledBrightness` (20 ms windowed
average current), `dc_motor` (integrates torque over the real on/off
intervals), `servo` (decodes the real pulse width), buzzers, scopes.

An averaged (duty × V) Thévenin drive was rejected: it is wrong for the
nonlinear load this matters most for. 25 % of 5 V is 1.25 V, below a red
LED's knee, so the averaged model reads the LED dark where the switched
average is 25 % of full-on.

## Error bound

- `ledBrightness` window phase: exact when 20 ms is a whole number of periods
  (the 500 Hz default, 50 Hz servo frames); otherwise one reading is off by
  at most period/20 ms of full-on depending on phase (10.2 % at Arduino's
  490.196 Hz, the same bound the emulated Uno timer has); averaging readings
  over time removes the phase term (measured within 1 % in the tests).
- Against ngspice (test/pwm-duty-ngspice.test.mjs, 500 Hz PULSE transient,
  averaged over five settled periods): the duty-linearity error is below
  0.002 % of full-on at 10/25/50/75 %; the absolute offset is -0.66 % at every
  duty INCLUDING 100 %, i.e. the DC LED model on this bench, not the PWM path.
- Cost: one solve per edge, ~50 ms of CPU per simulated second at 500 Hz for
  the LED bench.

## Actuator intent (2026-09-29, Lite B5)

`setDeviceControl(motor, 'speed', N)` and `setDeviceControl(servo, 'angle', N)`
drive the MCU pin behind the part with `setPwm` (N % duty; the 50 Hz frame
the servo decodes to N degrees) — one mechanism for every actuator, see
spec-updates/set-device-control.md. The servo's default calibration is now
500..2500 us for 0..180 degrees, what every driver that reaches it emits
(sb3-creator's C for the 8051 PCA, AVR Timer 1 and the Pico slice, its
MicroPython driver, CODAL's setServoValue); at the old 1000..2000 default a
45-degree program (1000 us) showed 0 and a 0-degree one (500 us) was ignored.
The servo state names where its angle came from: `signal` = 'pulse' | 'control'
| null.

## Motor direction through an H-bridge (2026-10-05, Lite B7)

`setDeviceControl(motor, 'direction', D)`, D = forward | reverse | brake |
coast, was refused ("has no simulator action for this"), and could not have
worked: the dc_motor model clamped omega at 0, so a motor driven backwards sat
still. Now:

- **The motor turns both ways.** `velocity` is the signed rad/s (+ = current
  a -> b), `omega` stays the speed `|velocity|` (every reader of it reads what
  it read before; forward motion is bit-identical, measured on PWM, coasting
  and the NPN + diode bench), and `direction` is 'forward' | 'reverse' |
  'stopped' (below 0.01 rad/s). A step that would carry it through zero stops
  it at zero; load torque opposes the motion and cannot start it backwards.
- **Direction is the driver's.** The board finds the `h_bridge` channel whose
  outputs carry the motor's two leads (the L293D, and KiCad's L298, map onto
  it), the MCU pins on its IN pins and EN, and applies the L293D truth table
  oriented by the motor's own `a` lead: forward drives that input high and the
  other low, reverse the opposite, brake both high with EN high, coast drops
  EN. `speed` on such a motor is a PWM on the ACTIVE input with the other low
  and EN held high (sign-magnitude, braking between pulses) — measured 20-30x
  cheaper to integrate than the same duty on EN, where every pulse commutates
  the clamp diodes. A program that drives the inputs itself and only sets a
  speed keeps its inputs, and the speed is a PWM on EN (B5's route).
- **Refused by name, not guessed:** a motor on one MCU pin (a single
  transistor, or the pin itself) turns one way — forward is accepted as
  already true, reverse and brake are refused; a bridge whose inputs are not
  both MCU pins cannot be steered; coast with EN tied high (both inputs low
  is a brake there); any other word.
- **The L293D's clamp diodes are solver diodes** (`_expandBridgeClampDiodes`,
  beside the motor-winding expansion; solver view only). A disabled output was
  an open circuit and the winding's current had nowhere to go: one EN-low on a
  spinning motor took 347 s of wall time to advance 100 ms, a 500 Hz PWM on EN
  66 s per 40 ms. `params.clampDiodes: false` keeps a bare L298-style bridge.

Not covered: `gearmotor` and `dc_motor_encoder` still clamp at 0 (the devices
blocks address `dc_motor` only); a diode turn-off still latches the
integrator's `minimum-step-accuracy-unmet`, exactly as the gallery's
NPN + flyback-diode bench does; that bench integrates at about 0.19 s of wall
time per ms of PWM, which no route here changes.

## What a meter shows (2026-09-29, Lite B5)

`meterVoltage(netA, netB?)` and `meterCurrent(part, terminal)` are what a DMM
shows: the mean over the last 100 ms of the same quantity `nodeVoltage` /
`branchCurrent` report per instant. 100 ms is five 20 ms cycles — a bench
meter's reading rate and a whole number of periods of every carrier the board
drives by default (500 Hz, 50 Hz), where the mean is exact; at any other
carrier the partial period at the window's edge moves one reading by at most
period / 100 ms of the swing. A steady net reads exactly the instantaneous
value. Only watched quantities are recorded: the first read of a pair starts
the watch (and returns the instantaneous value); a watch unread for 2 s of sim
time is dropped; setNetlist/reset/restore clear them.

## Not covered (named gaps)

- `nodeVoltage`/`branchCurrent` stay instantaneous on a PWM net by design (the
  solve is per instant; scopes and the LED window read them); the meters above
  are the averaged reading.
- `operatingPoint()` sees the pin's instantaneous level.
