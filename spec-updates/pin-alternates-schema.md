# Spec-update: pin alternate-function schema (REVISED)

**From:** bw-board
**To:** bw-parts (data owner), bw-circuit-ui (consumer)
**Re:** bw-parts spec-update 004 + 007, bw-circuit-ui pin-alternate-functions.md

## Decision: adopt `"functions"`, not `"alternates"`

bw-parts (007) and bw-circuit-ui both use `"functions"`. bw-board's
earlier draft used `"alternates"`. **Adopting `"functions"`** — the data
owner and the consumer already agree on the name. bw-board owns neither
the data nor the UI that reads it.

`"analog_only"` is a value inside the `functions` list, not a separate
boolean. One list is simpler to consume than a list plus a flag, and
both parties already use this form.

## Agreed schema (all three repos use these exact words)

```json
{
  "board": "arduino_nano",
  "mcu": "atmega328p",
  "vcc": 5.0,
  "pins": {
    "D13": {
      "port": "PB5",
      "functions": ["SCK", "LED"],
      "notes": "onboard LED"
    },
    "A4": {
      "port": "PC4",
      "functions": ["ADC4", "SDA"],
      "notes": "I2C data — requires pull-up"
    },
    "A6": {
      "port": null,
      "functions": ["analog_only", "ADC6"],
      "notes": "no digital I/O, no port register bit"
    },
    "RST": {
      "port": null,
      "functions": null,
      "notes": "not yet audited"
    }
  }
}
```

## Null vs empty (agreed by all three, not reopened)

- `"functions": null` — not yet audited. Unknown.
- `"functions": []` — audited, genuinely none (GPIO only).

These are different claims. Coverage is measurable.

## Three requirements (unchanged)

1. **Multiple functions per pin**: `["ADC3", "CCP0"]` — ordered by usage.
2. **Analog-only**: `["analog_only", "ADC6"]` — a value in the list, not
   a separate field. The pin chooser shows why the pin is unavailable.
3. **Unknown vs none**: `null` until checked, `[]` means checked-and-none.

## Data flow

- **bw-parts generates** the JSON from audited pin tables (fbfacf8 etc.)
- **bw-board** reads sidecars at `../../bw-parts/parts/` via
  `src/pin-functions.js` → `getPinFunctions(boardKind, pinName)`.
  Node-only (uses `node:fs`); not exported from the browser entry.
- **bw-circuit-ui** reads the same schema from its own vendored copy via
  `src/model/pin-functions.js` → `getPinFunctionsForPart(kind)`.
  Browser-safe; reads from its parts registry, not a sibling path.

One source of truth (bw-parts). No hand-encoded copies.

## Two implementations

The schema has two independent accessors that must agree on the four
states (`null`, `[]`, `[...]`, `["analog_only"]`). This is architecturally
right — a browser bundle cannot import across sibling repo paths — but
it means a schema change (a fifth state, a reinterpretation of
`analog_only`) must update both files:

| Repo | File | API |
|------|------|-----|
| bw-board | `src/pin-functions.js` | `getPinFunctions(boardKind, pinName)` |
| bw-circuit-ui | `src/model/pin-functions.js` | `getPinFunctionsForPart(kind)` |

Both repos test the `null`-vs-`[]` boundary. If the schema evolves,
verify that both accessor test suites cover the new state.
