# Spec-update: device drives referenced to a terminal, not to node 0

## Problem

Both generic device-source mechanisms — `state.drives` (stamped in `stampDevice`)
and `ctx.thevenin(terminal, vTh, rTh)` — stamp `A[i][i] += g; b[i] += vTh·g`,
i.e. a Norton source **between the terminal's net and implicit ground**. A device
that drives one of its pins *relative to another of its own pins* cannot be
expressed. Consequences already observed:

- A battery whose `neg` terminal is not on the reference net is electrically wrong
  (its EMF appears between `pos` and ground instead of between `pos` and `neg`).
- `devices/power.js` additionally stamps the battery twice (`state.drives.pos` in
  `init()` AND `ctx.thevenin('pos', …)` in `stamp()`), halving the effective
  internal resistance. The two bugs compound.
- Any future floating supply (charge pump, isolated secondary, stacked cells) hits
  the same wall.

## Proposal

Add a referenced form alongside the existing ground-referenced one:

```js
ctx.theveninBetween(termPlus, termMinus, vTh, rTh)
```

Stamp: conductance g = 1/rTh between the two nets (four G entries), plus Norton
current ±vTh·g into the two nets' RHS rows — the standard floating-Thévenin
companion. `state.drives` gains an optional `ref: '<terminal>'` field with the same
semantics; absent `ref` keeps today's ground-referenced behaviour (no existing
device changes meaning).

`devices/power.js` is rewritten in the same commit: single stamp,
`ctx.theveninBetween('pos', 'neg', volts, rInt)`, `drives` removed.

## MNA impact

Pure stamping change; no new matrix rows (Norton form, not a source row). The
dc-motor device already hand-builds exactly this floating pair with two
`ctx.current` calls — it migrates to the new call, deleting its workaround.

## Acceptance (hand-computed oracles, same commit)

1. 9 V battery, rInternal 0.5 Ω, across 1 Ω: I = 6.000 A (catches the double-stamp).
2. Two AA cells in series (floating middle node) across 10 Ω: middle node reads
   1.5 V above the bottom terminal's net, I = 0.300 A.
3. Battery with `neg` lifted through a 1 kΩ to ground, `pos` open: no current flows,
   `pos`−`neg` reads 9.000 V (today it reads wrong).
4. Existing ground-referenced drives regression: full test suite unchanged.
