# Relay (SPDT) — device model spec

Single-pole double-throw relay with coil threshold, hysteresis, and switching delay.

## Terminals

| Terminal | Function                          |
|----------|-----------------------------------|
| coil_a   | Coil terminal A                   |
| coil_b   | Coil terminal B                   |
| com      | Common (pole)                     |
| nc       | Normally closed contact           |
| no       | Normally open contact             |

## Part definition

```js
{
  id: 'K1',
  kind: 'relay',
  params: {
    coilR: 200,          // coil resistance (Ohm)
    pullInV: 3.7,        // pull-in voltage (coil energized threshold)
    dropOutV: 1.5,       // drop-out voltage (coil de-energized threshold)
    switchTimeMs: 5,     // mechanical switching delay (ms)
  },
  terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'],
}
```

## Electrical model

### Coil side
The coil is a resistor (coilR) between coil_a and coil_b. The voltage across it
determines the relay state:

- V_coil > pullInV → relay energizes (after switchTimeMs delay)
- V_coil < dropOutV → relay de-energizes (after switchTimeMs delay)
- Between: hysteresis, state holds

### Contact side
Modeled as a controlled switch:

- **Energized**: com↔no closed (R_contact = 0.1 Ohm), com↔nc open (R = Infinity / absent)
- **De-energized**: com↔nc closed (R_contact = 0.1 Ohm), com↔no open

The contact resistance (0.1 Ohm) is the MNA stamp — a near-zero resistance branch.

## Oracle: 5V relay with LED

Circuit: VCC → relay coil_a, coil_b → GND, VCC → 1kOhm → LED → relay NO → GND.

1. Power on, relay de-energized: com↔nc closed, com↔no open. LED off.
2. Coil sees 5V > 3.7V pull-in: relay energizes after 5ms.
3. Energized: com↔no closed, com↔nc open. LED on.
   LED current: (5 - 2) / (1000 + 0.1) = 2.997 mA

4. Remove coil voltage (MCU pin goes high-Z): coil V drops below 1.5V.
5. Relay de-energizes after 5ms. LED off again.
