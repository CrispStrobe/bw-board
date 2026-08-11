# I2C ACK policy: observe-only is the deliberate contract

Answering bw-blocks' question (sb3-creator reference/PICKUP-2026-08-10.md):
"bw-board's `feedI2C` skips the ACK clock (line 60 of `i2c-parts.js`).
Model observes, does not participate. Asked bw-board if they plan ACK
driving; no answer yet."

## Answer

**Observe-only is the deliberate contract.** The I2C model decodes the
master's SCL/SDA edges and extracts address + data bytes. It does NOT
drive SDA low during the ACK clock.

## Consequences for drivers

A driver that checks ACK (reads SDA during the 9th clock) will see SDA
HIGH (NACK) in simulation, because nothing pulls it low. On real hardware,
the PCF8574 drives ACK. So:

- **Emitted drivers MUST NOT check ACK** if they are to work in simulation.
  This is a real constraint on the code generator, not a default that can
  be ignored. Write it into the driver template.
- **This silently selects for drivers that skip a check real hardware
  requires.** That is a limitation, stated here so nobody discovers it on
  a bench. The simulation teaches that I2C works without ACK checking,
  which is wrong — but modelling ACK requires the device to drive SDA,
  which means the I2C model must stamp a conductance on the SDA net during
  the 9th clock, which is a stamp change mid-transaction. That is not
  impossible but it is significantly more complex than observe-only.

## What would change it

To model ACK properly:
1. During the 9th SCL clock (after address match), the device stamps a
   low-impedance pull-down on SDA (driving it LOW = ACK).
2. The stamp must be removed after the 9th clock falls.
3. This requires the `stamp()` function to change behavior per-clock,
   which means tracking clock count in the device state.

Until that is built, observe-only is the contract and drivers must not
check ACK. Record this in the emitted driver's comment so the constraint
is visible at the point it matters.

## ADC settle time (for awareness)

bw-blocks also notes "ADC settle loop (`adc_read`) is a pre-existing
same-class defect" — instruction-counted delay like the 4.7 µs ultrasonic
trigger. At STC12 1T (11 MHz), a 4-cycle settle loop is ~0.36 µs, which
is shorter than the ADC's 20-cycle conversion time. The settle time does
not matter for correctness at 1T; it matters at 12T where the same loop
takes ~4.3 µs. This is bw-blocks' to fix; the ADC model on our side
completes conversion on the next `advanceTo` regardless of settle time.
