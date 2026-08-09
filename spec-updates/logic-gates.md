# Logic gates — device model spec

74xx-flavored CMOS logic gates: AND, OR, NOT, NAND, NOR, XOR.

## Electrical model

Each gate is a behavioral Thevenin driver, reusing the same thinking as pin-model.js:

- **Inputs**: threshold at 30% VCC (V_IL) and 70% VCC (V_IH). Below V_IL = logic 0,
  above V_IH = logic 1, between = undefined (last known state held).
- **Output**: Thevenin driver.
  - Logic HIGH: `{ vTh: vcc, rTh: R_GATE_OUT }` with R_GATE_OUT = 50 Ohm
    (74HC series output impedance, order-of-magnitude).
  - Logic LOW: `{ vTh: 0, rTh: R_GATE_OUT }`.
- **Propagation delay**: scheduled event, default 10 ns (74HC typ). Output changes
  `tPD` after input crosses threshold. For the closed-form path, this means the output
  updates on the next advanceTo that crosses the deadline.

## Part definition

```js
{
  id: 'U1',
  kind: 'gate_and',     // gate_or, gate_not, gate_nand, gate_nor, gate_xor
  params: {
    inputs: 2,           // 1 for NOT, 2-8 for others
    rOut: 50,            // output impedance (Ohm), default 50
    tPropNs: 10,         // propagation delay (ns), default 10
  },
  terminals: ['in0', 'in1', 'out'],   // NOT: ['in0', 'out']
}
```

## Terminal naming

- Inputs: `in0`, `in1`, ..., `in{N-1}`
- Output: `out`
- NOT gate: single input `in0`, output `out`

## Truth tables (for oracle tests)

AND:  out = in0 & in1 & ... & inN
OR:   out = in0 | in1 | ... | inN
NOT:  out = !in0
NAND: out = !(in0 & in1 & ...)
NOR:  out = !(in0 | in1 | ...)
XOR:  out = in0 ^ in1 (2-input only for now)

## Oracle values at VCC = 5V

- V_IL = 0.3 * 5 = 1.5V
- V_IH = 0.7 * 5 = 3.5V
- Output HIGH: V_out = 5.0 * R_load / (R_load + 50) for load R_load
  With 10kOhm load: V_out = 5.0 * 10000/10050 = 4.975V
- Output LOW: V_out = 0.0 (ideal, through 50 Ohm)

## MNA stamp

Each gate contributes:
- Input terminals: high impedance to ground (1 MOhm, representing CMOS gate input)
- Output terminal: Thevenin stamp (vTh, rTh) that changes based on logic state

This is identical to how MCU pin stamps work — the device plugin interface should
let gates register the same way.
