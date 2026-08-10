# Device behaviour census

Derived from the registered device models, not from memory. The question:
if a real driver existed tomorrow, could the simulator show it working?

**Answer: yes, for the core devices.** The models respond to pin voltages
and edge timing, not to block calls. A PCA pulse train → servo reads pulse
width → produces angle. The chain is end-to-end.

## Core devices: behaviour modelled from pin voltages

| Kind | Responds to | State produced | End-to-end verified? |
|------|------------|----------------|---------------------|
| `servo` | Pulse width on `signal` pin (rising→falling edge timing) | `targetAngle`, `actualAngle` (slew-limited) | Yes: PCA PWM → pin → pulse decode → angle |
| `dc_motor` | Terminal voltage `(Va-Vb)`, back-EMF from omega | `omega` (rad/s), integrated from torque/inertia | Yes: voltage → current → torque → speed |
| `dc_motor_encoder` | Same as dc_motor + quadrature output from angular position | `omega`, `angle`, encoder A/B outputs | Yes: sub-stepped in advanceTo |
| `relay` | Coil voltage `|V(coil_a)-V(coil_b)|` vs pull-in/drop-out thresholds | `energized` (with switching delay) | Yes: advanceTo sub-steps to deadline |
| `timer_555` | Threshold, trigger, control, reset pin voltages | `ffOut`, discharge switch state | Yes: astable oscillates, cross-validated vs analytic |
| `h_bridge` | Enable + IN1/IN2 logic levels | OUT1/OUT2 drive states (H/L/float) | Yes: truth table tested |

## Sensors: control-driven (params set by UI, not by pin voltage)

| Kind | Control param | Output |
|------|--------------|--------|
| `ultrasonic` | `distance` (cm) | Echo pulse timing on `echo` pin |
| `tmp36` | `tempC` | Analog voltage on `out` (10mV/°C + 500mV) |
| `pir` | `motion` (0/1) | Digital level on `out` |
| `flex_sensor` | `bend` (0-1) | Resistance between terminals |
| `force_sensor` | `force` (0-1) | Resistance between terminals |
| `gas_sensor` | `gas` (0-1) | Resistance between terminals |
| `ldr` (built-in) | `light` (0-1) | Resistance between terminals |
| `soil_moisture` | `moisture` (0-1) | Voltage on `out` |

These respond to `setControl()` or `part.params`, not to pin voltages.
For sensor reporters (`readSensor` blocks), the board returns the voltage
at the sensor's output pin via `readAnalog()` — the ADC path.

## Display devices: decode serial protocols from pin edges

| Kind | Protocol | State |
|------|----------|-------|
| `neopixel` | WS2812B 1-wire (800kHz edge timing) | `pixels[]` RGB array |
| `pcf8574` | I2C (SCL/SDA edge decode) | `outputReg` 8-bit |
| `char_lcd_i2c` | I2C → HD44780 4-bit nibbles | `display[][]` character grid |
| `clock_display` | 2-wire serial (CLK/DIO) | `digits[]`, `colon` |
| `cd4511` | Parallel BCD input | 7-segment output drives |
| `shift_register` (built-in) | Clock/data/latch edges | `shiftReg`, `latchReg` |

## The gap: stubs and missing models are NOT the same gap counted twice

bw-blocks has 36 device stubs that compile to no-ops. The board has
behaviour models for the same devices. These are **different gaps**:

- **bw-blocks gap**: no C driver function body (`bw_servo_set` is a stub)
- **bw-board gap**: none — the model already responds to pin voltages

When a real driver is written (e.g. `bw_servo_set` configures PCA for the
correct pulse width), the board will show the servo moving without any
board-side changes. The chain: block → C → PCA → pin edges → board model
→ angle. Every link except the first (the driver body) is already proven.

## What would NOT work today

A block that calls `bw_servo_set(90)` and expects the board to jump to 90°
without generating any pin activity. The board model reads **pulses on the
signal pin**, not a side-channel. This is by design: a shortcut that
bypasses the pins would disagree with hardware the moment a real driver
exists.
