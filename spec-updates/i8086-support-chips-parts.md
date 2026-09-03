# 8086 family — DIP part definitions (for the parts/art repo)

The 8086 extractor (`bw-board/src/i8086-extract.js`) can already turn a
hand-wired breadboard into a machine config or a **named refusal**, but only
if the drawn parts exist with the right terminal names. It recognises the
SELECT pattern of each chip below; what is missing is the placeable DIP part
+ pinout sidecar, the way the W65C22 and W65C51 got theirs.

**Load-bearing contract:** the terminal names in the LOGICAL column below are
read by name in the extractor. They must match exactly, or a correctly wired
chip extracts as a floating-select refusal. Everything else on each package
is for drawing and wiring realism and the extractor ignores it.

`62256` (RAM), `28c256` (ROM) and `74hc138` already exist and are reused
as-is. `mc6850` and `ns16c550` already exist. New parts needed: **i8086,
8088, i8255, i8254, i8259, i8251, 8284**.

Address lines are presented DE-MULTIPLEXED (a0–a19 as direct terminals),
exactly as the z80 and 6502 parts present their address bus — the real
8086's AD0–AD15 multiplexing and its 74LS373 latch are abstracted away, the
same simplification those parts already make. A learner wires a0–a19 to the
memory and decode chips directly.

## i8086 / 8088 (DIP-40)

Two kinds, identical terminals (the 8088's 8-bit bus is invisible at this
resolution); ship both slugs.

| Logical (extractor reads) | Pin function |
|---|---|
| `a0`–`a19` | 20-bit address bus (de-multiplexed) |
| `mio` | M/IO# — HIGH = memory cycle, LOW = I/O cycle. **The extractor's cycle-type input.** |
| `rdb`, `wrb` | read / write strobes (active low) |
| `clk`, `reset`, `ready`, `intr`, `nmi`, `intab` | clock, reset, ready, maskable/non-maskable interrupt in, INTA# out |
| `d0`–`d15` (`d0`–`d7` for 8088) | data bus |
| `vcc`, `gnd` | supply |

```js
{ id: 'U1', kind: 'i8086',
  terminals: ['a0','a1','a2','a3','a4','a5','a6','a7','a8','a9','a10','a11',
              'a12','a13','a14','a15','a16','a17','a18','a19','mio','rdb','wrb',
              'clk','reset','ready','intr','nmi','intab',
              'd0','d1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11',
              'd12','d13','d14','d15','vcc','gnd'] }
```

## i8255 PPI (DIP-40)

| Logical (extractor reads) | Pin function |
|---|---|
| `csb` | chip select, active low — **the SELECT** |
| `a0`, `a1` | register select (port A/B/C/control). **Must ride CPU A0/A1.** |
| `rdb`, `wrb`, `resetb` | read / write / reset |
| `pa0`–`pa7`, `pb0`–`pb7`, `pc0`–`pc7` | the three 8-bit ports |
| `d0`–`d7`, `vcc`, `gnd` | data, supply |

## i8254 PIT (DIP-24)

| Logical (extractor reads) | Pin function |
|---|---|
| `csb` | chip select, active low — **the SELECT** |
| `a0`, `a1` | register select (counter 0/1/2, control). **Must ride A0/A1.** |
| `rdb`, `wrb` | read / write |
| `clk0`–`clk2`, `gate0`–`gate2`, `out0`–`out2` | the three counters' clock / gate / output |
| `d0`–`d7`, `vcc`, `gnd` | data, supply |

## i8259 PIC (DIP-28)

| Logical (extractor reads) | Pin function |
|---|---|
| `csb` | chip select, active low — **the SELECT** |
| `a0` | register select (command/status vs data/mask). **Must ride A0.** |
| `rdb`, `wrb` | read / write |
| `ir0`–`ir7` | the eight interrupt request inputs |
| `intr`, `intab` | INT out (to the CPU's `intr`), INTA# in |
| `cas0`–`cas2`, `sp_enb` | cascade lines, slave-program/enable |
| `d0`–`d7`, `vcc`, `gnd` | data, supply |

## i8251 USART (DIP-28)

| Logical (extractor reads) | Pin function |
|---|---|
| `csb` | chip select, active low — **the SELECT** |
| `cd` | C/D# — data vs control/status. **Must ride A0.** (On a 16-bit bus a build may wire it to A1; the machine models that with a chip `stride: 2`, but the extractor's straightness check expects A0.) |
| `rdb`, `wrb`, `reset`, `clk` | read / write / reset / clock |
| `txd`, `rxd`, `txc`, `rxc` | transmit/receive data and clocks |
| `dtrb`, `dsrb`, `rtsb`, `ctsb` | modem control |
| `txrdy`, `rxrdy`, `txempty`, `syndet` | status pins (rxrdy is the usual IRQ source) |
| `d0`–`d7`, `vcc`, `gnd` | data, supply |

## 8284 (DIP-18) — clock generator, drawable only

No registers, not on any bus; the extractor never decodes it. Included so a
learner can place the real clock chip. Terminals: `x1`, `x2`, `f_c`, `efi`,
`asuncb`, `csync`, `clk`, `pclk`, `osc`, `ready`, `rdy1`, `rdy2`, `aen1b`,
`aen2b`, `res`, `resetb`, `vcc`, `gnd`.

## Refusals this unlocks (the teaching moment)

Once these exist, a learner drawing an 8086 gets a NAMED refusal for a wrong
wiring rather than a dead board — the same pedagogy the 6502/Z80 extractors
already give. The extractor already emits, verbatim:

- `<chip>.csb is undriven — a floating chip select is not a decode`
- `<chip>.a1 must ride A1 — register selects are the low address lines`
- `memory-space contention at <addr>: <a> and <b> are both selected`
- `port-space contention at port <addr>: <a> and <b>`
- `no ROM is selected at FFFF0h-FFFFFh — the 8086 fetches its first
  instruction from FFFF:0000 and this machine would never boot`

## Reference presets these parts let a learner DRAW

`bw-board/src/i8086-machine.js` now exports two reference-build configs a
drawn breadboard can be checked against — `SLADOR8088` (8088 + 8254 + 8255 +
8259, timer IRQ wired) and `GREENSHELLRAGE8086` (8086 + 8259 + 8251, 256K/
256K). Both reproduced from public chip lists only.

— requested by the bw-board 8086 lane; the parts + SVG art are the parts
repo's to author.
