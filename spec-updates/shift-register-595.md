# 74HC595 shift register — device model spec

8-bit serial-in, parallel-out shift register with output latch.

## Pins (terminals)

| Terminal | Function              |
|----------|-----------------------|
| SER      | Serial data input     |
| SRCLK    | Shift register clock (rising edge) |
| RCLK     | Storage register clock / latch (rising edge) |
| OE       | Output enable (active LOW) |
| MR       | Master reset (active LOW, clears shift register) |
| Q0-Q7   | Parallel outputs       |
| QH_PRIME | Serial output (for daisy-chaining) |
| VCC      | Power (for stamp)      |
| GND      | Ground (for stamp)     |

## Part definition

```js
{
  id: 'U2',
  kind: 'shift_register',  // already in PartKind
  params: {
    bits: 8,
    rOut: 50,        // output impedance per channel
  },
  terminals: ['SER', 'SRCLK', 'RCLK', 'OE', 'MR',
              'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7',
              'QH_PRIME', 'vcc', 'gnd'],
}
```

## Digital FSM

State: `shiftReg[8]` (shift register), `latchReg[8]` (output latch).
Inputs sampled at CMOS thresholds (30%/70% VCC).

- **SRCLK rising edge**: shift `shiftReg` left, new bit = SER logic level.
  `QH_PRIME` = old MSB (before shift).
- **RCLK rising edge**: `latchReg = shiftReg` (copy).
- **MR LOW**: `shiftReg = 0x00` (async, immediate).
- **OE LOW**: outputs drive from `latchReg`. OE HIGH: outputs high-Z.

Each output Qn:
- OE active: `{ vTh: latchReg[n] ? vcc : 0, rTh: 50 }`
- OE inactive: `'high-z'`

## Oracle: clock in 0xA5, latch, assert Q0..Q7

Sequence (MSB first, 0xA5 = 10100101):
1. MR LOW → MR HIGH (clear shift register)
2. OE LOW (enable outputs)
3. Clock in bits: SER=1,SRCLK↑; SER=0,SRCLK↑; SER=1,SRCLK↑; SER=0,SRCLK↑;
   SER=0,SRCLK↑; SER=1,SRCLK↑; SER=0,SRCLK↑; SER=1,SRCLK↑
4. RCLK↑ (latch)

Expected Q0..Q7 drive states (Q0=LSB):
- Q0=1, Q1=0, Q2=1, Q3=0, Q4=0, Q5=1, Q6=0, Q7=1
- Corresponding: bits of 0xA5 = 10100101

With 8 LEDs (each: 1kOhm + LED, VCC to Qn):
- Q=HIGH outputs: LED current ≈ (5 - 2) / (1000 + 50) = 2.86 mA
- Q=LOW outputs: LED off (0V output)

Expected LED bar pattern: ON OFF ON OFF OFF ON OFF ON
