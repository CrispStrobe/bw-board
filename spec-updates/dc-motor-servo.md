# DC motor and servo — device model specs

## DC motor

### Terminals
| Terminal | Function |
|----------|----------|
| a        | Motor terminal A |
| b        | Motor terminal B |

### Part definition
```js
{
  id: 'M1',
  kind: 'dc_motor',
  params: {
    windingR: 10,     // winding resistance (Ohm)
    kV: 0.01,         // back-EMF constant (V per rad/s)
    kT: 0.01,         // torque constant (Nm/A), equals kV for ideal motor
    J: 0.001,         // rotor inertia (kg·m²)
    loadTorque: 0,    // constant load torque (Nm)
  },
  terminals: ['a', 'b'],
}
```

### Electrical model

The motor is modeled as: `V_applied = I * R_winding + kV * omega`

Where omega (angular velocity, rad/s) is integrated in advanceTo:
```
torque = kT * I - loadTorque
alpha = torque / J
omega += alpha * dt
```

MNA stamp: voltage-dependent current source.
- Branch current: `I = (V_a - V_b - kV * omega) / R_winding`
- This is a resistor (R_winding) in series with a voltage source (kV * omega).

### Speed state

`board.getMotorSpeed(partId)` returns `{ omega, rpm }`:
- `omega`: rad/s
- `rpm`: omega * 60 / (2*pi)

### Oracle: steady-state speed

Given: V = 5V, R = 10 Ohm, kV = 0.01 V/(rad/s), load = 0.
At steady state: I * R + kV * omega = V, and torque = kT * I = 0 (no acceleration).
So I = 0 at steady state (no load), omega = V / kV = 5 / 0.01 = 500 rad/s = 4775 RPM.

With load torque 0.001 Nm: kT * I = 0.001, I = 0.001/0.01 = 0.1A.
omega = (V - I*R) / kV = (5 - 1) / 0.01 = 400 rad/s = 3820 RPM.

## Servo motor

### Terminals
| Terminal | Function |
|----------|----------|
| signal   | PWM control signal |
| vcc      | Power supply |
| gnd      | Ground |

### Part definition
```js
{
  id: 'S1',
  kind: 'servo',
  params: {
    minPulseUs: 1000,   // pulse width for 0 degrees (µs)
    maxPulseUs: 2000,   // pulse width for 180 degrees (µs)
    maxAngle: 180,      // total range (degrees)
    slewRate: 300,      // degrees per second (typical ~60deg/0.2s = 300)
  },
  terminals: ['signal', 'vcc', 'gnd'],
}
```

### Behavioral model

The servo decodes the PWM pulse width on the signal pin:
1. Detect rising edge → record timestamp.
2. Detect falling edge → pulse_width = t_fall - t_rise.
3. Map pulse width to target angle:
   `targetAngle = (pulse_width - minPulseUs) / (maxPulseUs - minPulseUs) * maxAngle`
   Clamped to [0, maxAngle].
4. In advanceTo, slew the actual angle toward target at slewRate.

The servo draws current from VCC/GND (not modeled electrically beyond power pins).
The signal pin is a high-impedance input.

### Angle state

`board.getServoAngle(partId)` returns `{ target, actual }` in degrees.

### Oracle

50 Hz PWM (20ms period), 1.5ms pulse → midpoint:
- target = (1500 - 1000) / (2000 - 1000) * 180 = 90 degrees

1.0ms pulse → 0 degrees, 2.0ms pulse → 180 degrees.

Slew: starting from 0, target 90, slewRate 300 deg/s:
- After 0.1s: actual = min(90, 0 + 300*0.1) = 30 degrees
- After 0.3s: actual = min(90, 0 + 300*0.3) = 90 degrees (reached target)
