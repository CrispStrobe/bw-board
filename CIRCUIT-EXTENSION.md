# The `circuit` VM extension — design notes

How boundary B becomes blocks.

## The seven blocks

| block | opcode | type | boundary B call |
|-------|--------|------|----------------|
| `(voltage at [NET])` | `nodeVoltage` | reporter | `board.nodeVoltage(net)` |
| `(current through [PART])` | `branchCurrent` | reporter | `board.branchCurrent(part, 'anode')` |
| `(resistance [A] to [B])` | `resistance` | reporter | `board.resistance(a, b)` — returns `'requires-power-off'` when live |
| `(brightness of [LED])` | `ledBrightness` | reporter | `board.ledBrightness(led)` |
| `(tone of [BUZZER])` | `buzzerTone` | reporter | `board.buzzerTone(buzzer).hz` |
| `set [CONTROL] to (N)` | `setControl` | command | `board.setControl(control, n)` |
| `turn power [ON/OFF]` | `setPower` | command | `board.setPower(on)` |

All seven calls verified clean with no gaps (`bw-board` commit `88ac0d6`).

## How the Board instance reaches the extension

**Injection, not import.** The extension does not import `bw-board` — it receives a
`Board` instance at construction time or via a setter, the same adapter pattern the
LEGO extensions use (they receive a peripheral, we receive a board):

```js
class CircuitExtension {
  constructor() {
    this._board = null;
  }

  /** Called by the host to inject the board instance. */
  setBoard(board) {
    this._board = board;
  }

  getInfo() {
    return {
      id: 'circuit',
      name: 'Circuit',
      blocks: [ /* ... */ ],
    };
  }

  nodeVoltage({ NET }) {
    if (!this._board) return 'needs the simulator';
    return this._board.nodeVoltage(NET);
  }

  resistance({ A, B }) {
    if (!this._board) return 'needs the simulator';
    return this._board.resistance(A, B);
    // returns 'requires-power-off' when powered — a DIFFERENT refusal
  }

  // ...
}
```

**Never return 0 when no board is attached.** Zero volts is a real measurement (a
grounded net reads 0 V), so the no-board case would be indistinguishable from a
real result. All five reporters must return `'needs the simulator'` when `_board`
is null. Two distinct refusals:

- **no board attached** → `'needs the simulator'`
- **powered, so ohms cannot be measured** → `'requires-power-off'`

Commands (`setControl`, `setPower`) returning nothing when there is no board is fine.

Why injection:
1. The extension runs in the VM's sandbox. It cannot `import` from a sibling bundle.
2. The `Board` instance is owned by the simulator orchestrator, which creates it,
   feeds it `setPin`/`advanceTo`, and passes it to the extension.
3. Multiple targets may share one extension but have different boards (or no board).

## Three constraints (decisions, not details)

1. **Meter reporters sample at display rate (~60 Hz), not per edge.**
   `branchCurrent` on a PWM'd LED is 7.0K ops/sec against 7.2K edges/sec.
   A real meter integrates; so should this. Cache the last MNA result and
   return it for 16ms before re-solving.

2. **`resistance` teaches by refusing.** When `board.resistance()` returns
   `'requires-power-off'`, the block should report that string, not 0.

3. **Simulation-only blocks are greyed on hardware targets, with the reason.**
   `nodeVoltage`, `branchCurrent`, `ledBrightness` have no meaning on a live
   board. `setControl` is meaningless when the button is real. Grey them out
   with "needs the simulator" — same treatment as the debug monitor.

## Menu sources

Block dropdowns (`[NET]`, `[PART]`, `[LED]`, `[BUZZER]`, `[CONTROL]`) come from
the Board's query methods:

- `[NET]` → `board.getNets().map(n => n.id)`
- `[LED]` → `board.getLeds()`
- `[BUZZER]` → `board.getBuzzers()`
- `[CONTROL]` → `board.getControls().map(c => c.id)`
- `[PART]` → `board.getParts().filter(p => p.kind !== 'vcc' && p.kind !== 'gnd').map(p => p.id)`

These update when the netlist changes (`board.onChange` with `type === 'netlist'`).
