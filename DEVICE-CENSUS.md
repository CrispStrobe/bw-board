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
| `pcf8574` | I2C both ways (SCL/SDA edge decode) | `outputReg`, sensed `port`, latching `int` |
| `char_lcd_i2c` | I2C → HD44780 4-bit nibbles | `display[][]` character grid |
| `clock_display` | 2-wire serial (CLK/DIO) | `digits[]`, `colon` |
| `cd4511` | Parallel BCD input | 7-segment output drives |
| `shift_register` (built-in) | Clock/data/latch edges | `shiftReg`, `latchReg` |

## Pins that were declared and did nothing (closed 2026-08-28)

The census question — *could the simulator show a real driver working?* — has
a second half it did not ask: **could a real driver wire the pin at all?** Six
devices named terminals the model never consulted. They stamped a conductance
so the node would not float, and otherwise ignored them, so the pin could be
connected and changed nothing.

| Kind | Pin(s) | What it does now |
|------|--------|------------------|
| `ds1302` | `x1`/`x2`, `vcc1` | Oscillator decided by WIRING (quartz has no DC signature, so `ctx.netFor` is the only thing that can answer); runs from whichever rail is higher and LOSES its registers below 2.0 V |
| `tcs34725` | `int` | Clear-channel threshold window, latching `AINT`, open-drain pin actually driven |
| `pcf8574` | `int` — and READS | The expander could not be read at all: its decoder sampled SDA and never drove it. Now senses its pins and interrupts on change |
| `vl53l0x` | `xshut`, `gpio1` | Shutdown that is a RESET (the only way to run two — they all boot at 0x29), plus the ranging-complete interrupt |
| `mpu6050` | `int` | Data-ready interrupt, with `INT_PIN_CFG` ACTL/OPEN deciding polarity and drive |
| `bargraph` | all ten segments | It reported no brightness at all, so every segment was dark; and it was a resistor, not ten diodes |

Two lessons worth keeping:

- **Drawing the pad comes SECOND.** Adding art for a pin the model ignores
  hands the user a terminal that does nothing. Each of these got behaviour
  first, then the sidecar.
- **A pin that cannot change an outcome is indistinguishable from a missing
  one.** `tcs34725` hid two more bugs behind its dead pin: `STATUS` returned
  AINT hardcoded SET, and the command byte's TYPE field was discarded so the
  "clear interrupt" special function overwrote a threshold register.

Sweeping for the same shape at DEVICE level found ten with no behaviour; nine
are legitimately static (batteries and the resistor network work in `stamp`,
headers and USB are passive, the crystal and the VGA card are documented
placeholders). The tenth was `bargraph`.

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
