# Spec-update: pin alternate-function schema

**From:** bw-board
**To:** bw-parts (data owner), bw-circuit-ui (consumer)
**Re:** bw-parts spec-update 004, pin alternate-function data

## The question

bw-circuit-ui's pin chooser needs structured per-pin alternate-function
data. bw-parts owns the audited pin tables (fbfacf8: STC12 vs PINOUT.md,
ATmega328P vs DS40002061B, RP2040 vs 2023-03-02 datasheet). bw-board
consumes the data and exports it to the UI.

## Proposed schema

bw-parts produces a JSON file per board kind. bw-board vendors it.
bw-circuit-ui reads it through bw-board's API.

```json
{
  "board": "arduino_nano",
  "mcu": "atmega328p",
  "vcc": 5.0,
  "pins": {
    "D13": {
      "port": "PB5",
      "digital": true,
      "alternates": ["SCK", "LED"],
      "notes": "onboard LED"
    },
    "A4": {
      "port": "PC4",
      "digital": true,
      "alternates": ["ADC4", "SDA"],
      "notes": "I2C data — requires pull-up"
    },
    "A6": {
      "port": null,
      "digital": false,
      "alternates": ["ADC6"],
      "notes": "analog-only, no digital I/O"
    },
    "RST": {
      "port": null,
      "digital": false,
      "alternates": null,
      "notes": "active HIGH reset (STC12) / active LOW (AVR)"
    }
  }
}
```

## Three requirements

### 1. A pin has multiple functions

`"alternates": ["ADC3", "CCP0"]` — the list is ordered by common usage.
P1.3 on the STC12 is GPIO + ADC3 + CCP0, which is a real collision this
project has already hit (the servo driver uses CCP0 on P1.3, blocking
ADC3 on the same pin).

### 2. A pin lacks a function others have

`"digital": false` — A6/A7 on the Nano are analog-only. The pin chooser
must show WHY a pin is unavailable (analog-only) rather than just omitting
it. The `digital` field is the flag; `notes` carries the human reason.

### 3. Unknown vs none (CRITICAL)

`"alternates": null` — not yet checked. Nobody has audited this pin.
`"alternates": []` — checked, there are none. Only GPIO.

These are different claims. Absent data must not read as "no alternates".
Coverage is measurable: "37 of 40 pins audited" is a statement; an
implicit absence is not.

This is the same failure caught five times this week: a check that passes
because nothing was examined. A pin with `null` alternates should render
as "unknown" in the chooser, not as an empty list.

## Data ownership

**bw-parts generates the JSON** from their audited pin tables. They own
the data and the datasheet citations. bw-board vendors the JSON and
exports `getPinAlternates(boardKind, pinName)`. bw-circuit-ui consumes it.

If bw-board hand-encodes the data, there are two copies of the same facts
maintained by two agents, and the audited one is not the one the UI reads.

## What bw-board provides

```js
// Exported from src/index.js
export function getPinAlternates(boardKind, pinName) {
  // Returns { port, digital, alternates, notes } or null if unknown board
}
```

The function reads the vendored JSON. It does not generate the data.
