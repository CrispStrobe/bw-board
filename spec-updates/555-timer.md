# 555 timer — device model spec (implement LAST)

Behavioral model: two comparators + SR flip-flop + discharge switch.
Needs capacitors inside MNA (available after coordinator's solver work).

## Terminals

| Terminal  | Function                        |
|-----------|---------------------------------|
| vcc       | Supply voltage                  |
| gnd       | Ground                          |
| trigger   | Trigger input (pin 2)           |
| threshold | Threshold input (pin 6)         |
| control   | Control voltage (pin 5)         |
| discharge | Discharge output (pin 7)        |
| output    | Output (pin 3)                  |
| reset     | Reset input (pin 4, active LOW) |

## Part definition

```js
{
  id: 'U3',
  kind: 'timer_555',
  params: {
    rOut: 50,     // output impedance
  },
  terminals: ['vcc', 'gnd', 'trigger', 'threshold',
              'control', 'discharge', 'output', 'reset'],
}
```

## Internal model

Two comparators + SR flip-flop:

1. **Upper comparator**: threshold vs control_voltage (default 2/3 VCC).
   threshold > control_voltage → RESET flip-flop.
2. **Lower comparator**: trigger vs 1/2 control_voltage (default 1/3 VCC).
   trigger < 1/3 VCC → SET flip-flop.
3. **Flip-flop output HIGH** → output pin drives HIGH, discharge switch OPEN.
   **Flip-flop output LOW** → output pin drives LOW, discharge switch CLOSED
   (shorts discharge pin to GND through ~10 Ohm).
4. **Reset LOW** → forces output LOW, discharge CLOSED (overrides flip-flop).
5. **Control pin**: if unconnected, internal divider provides 2/3 VCC.
   If driven, that voltage replaces the 2/3 threshold.

## MNA stamps

- Control voltage divider: three 5kOhm resistors VCC→control→GND
  (top 5k to VCC, bottom two 5k to GND, making 2/3 and 1/3 taps)
- Output: Thevenin driver { vTh: 0 or vcc, rTh: 50 }
- Discharge: controlled switch to GND (10 Ohm when closed, open when open)
- Trigger/threshold/reset: high impedance inputs (1 MOhm to GND)

## Oracle: astable mode

Classic circuit: R1=10kOhm (VCC to discharge), R2=10kOhm (discharge to threshold),
C=10uF (threshold to GND). Trigger tied to threshold.

- Charge time: t1 = 0.693 * (R1+R2) * C = 0.693 * 20000 * 10e-6 = 0.1386s
- Discharge time: t2 = 0.693 * R2 * C = 0.693 * 10000 * 10e-6 = 0.0693s
- Period: T = t1 + t2 = 0.2079s
- Frequency: f = 1/T = 4.81 Hz
- Duty cycle: t1/T = 66.7%

Voltage waveform on threshold/trigger pin oscillates between 1/3 VCC (1.667V)
and 2/3 VCC (3.333V).
