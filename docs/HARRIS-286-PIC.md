# Opt-in wired PIC and I/O bridge

2026-09-08. The experimental Harris board can now run owned real-mode guest
code that initializes a PIC, reads/writes masks, receives IRQs, reads ISR/IRR,
issues EOI and returns with IRET. This is not a complete PC/AT board, complete
8259/82C288, or a wired DOS-boot acceptance result. No application pin, GUI
default, saved-profile schema, deployment or guest-media distribution changes.

## Construction and nets

```js
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';

const pic = new Harris8259Adapter({enabled: true});
const board = createHarrisMemoryBoard({
    enabled: true, intrEnabled: true, ioEnabled: true,
    interruptDevice: pic, rom, romLowAlias: true
});
// External laboratory source. Future timer/peripheral outputs can replace
// these wires through editWires; the PIC never receives a CPU callback.
board.circuit.drive('irq_inputs', {ir0: 1});
```

Register the existing bus-memory models before constructing the board. The
adapter is an ideal PIC **plus address decoder and byte-lane bridge**, not a
drop-in bare 8259 pin model. Its declared `harris-pic-byte-lanes` interface adds
latched A0–A23/BHE/M_IO, controller I/O strobes, D0–D15 and eight IRQ input nets
to the existing interrupt connector. Existing low-eight-bit lab peers remain
unchanged. Every new option defaults off; the PIC requires both INTR and I/O.

Default ports are `20h` (command, low lane) and `21h` (data, high lane).
An even `portBase` can relocate this pair. The adapter decodes resolved latch
outputs, not CPU pending transactions or instruction operands. ALE captures
I/O addresses; memory strobes remain inactive. A read drives only the selected
lane; a write commits once at the WR trailing edge. READY can stretch either
command. Read data is latched once per RD assertion, including a poll read's
side effect, so repeated settle calls cannot acknowledge additional requests.

The first INTA assertion consumes one request and sets ISR without driving
data. The second drives the latched vector on D0–D7 until INTA releases. New
higher-priority requests cannot replace this vector. The board's existing
external READY logic stretches the acknowledgement pair. RESET abandons the
pair and any incomplete port write, and requires guest reinitialization.

## Supported programming subset

```asm
MOV AL,13h       ; ICW1: single, edge-triggered, ICW4 follows
OUT 20h,AL
MOV AL,40h       ; ICW2: vectors 40h..47h
OUT 21h,AL
MOV AL,01h       ; ICW4: 8086 mode, explicit EOI
OUT 21h,AL
MOV AL,0FEh     ; OCW1: unmask IRQ0 only
OUT 21h,AL
; Install the IVT/stack before STI. At the end of the handler:
MOV AL,20h       ; non-specific EOI
OUT 20h,AL
IRET
```

Reuses the existing `I8259` register/priority core without modifying it. The
adapter adds sampled IRQ transitions, programming guards and physical-command
sequencing. Fixed priority, normal masks, non-specific/specific EOI (`20h`,
`60h..67h`), no-op `40h`, IRR/ISR selection (`0Ah/0Bh`) and poll (`0Ch`) are
enabled. Other OCW modes are refused, even where the underlying core provides
them. ICW1 resets initialization state; requests already high during
initialization need a fresh low-to-high transition. A held-high serviced IRQ
does not retrigger after EOI. Keep a request high until acknowledgement;
withdrawal beforehand cancels it in this ideal model and can produce spurious
IRQ7 without setting ISR if the CPU already accepted INT.

Explicit refusals: cascade, level-trigger mode, MCS-80/85, auto-EOI, buffered
mode, special fully nested mode, rotation/special-mask commands, overlapping
strobes, incomplete initialization and active two-lane PIC transfers. Odd
word I/O has already been split by the CPU into separate byte transactions;
the adapter cannot infer original instruction width or undo an earlier byte.
Unmapped writes are unclaimed; unmapped reads float rather than returning a
fabricated byte. Broken command/address/data/IRQ wiring fails on resolved nets.

This is a sampled digital model: no nanosecond timing, minimum pulse-width,
metastability, exact internal edge latch/freeze windows, cascade handshake,
electrical loading, power-on silicon state or silicon-oracle claim. The reset
pin is an adapter/lab reset, not a physical 8259 RESET terminal.

## Evidence

Final targeted run: **218/218 passed, zero skips**, including the existing
PIC core tests. No full CI or browser acceptance was run.

Fifteen owned tests in `test/harris-pic.test.mjs` cover the subset above, including
actual CPU IN/OUT, HLT/IRQ/IRET, mask/unmask and ISR readback, missing EOI versus
deferred guest EOI, stable two-pulse vectors, READY-held writes, poll idempotence,
RESET cancellation, mode refusals, inactive memory commands and disconnected
command/address/odd-lane data wires. These are implementation regressions, not
an independent hardware conformance suite.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs
```

The CPU, SST adapter and runner SHA-256 values still match
[SST286-INTR-REPORT.json](SST286-INTR-REPORT.json): the prior full run had
1,477,997 passes, three revocations, zero failures/unsupported/budget exits.
**No new full-vector run** is claimed for this PIC-only increment. Those
vectors do not exercise this board or asynchronous IRQ/PIC behavior.

Primary reference: [Intel 8259A datasheet, December 1988, 231468-003](https://www.pcjs.org/documents/datasheets/intel/INTEL_8259A_PIC.pdf),
pin descriptions, interrupt sequence, initialization, fully nested/EOI and
edge/level-trigger sections. The supported subset and digital policies above
must not be confused with every mode described by that datasheet.

## Next gate

Wire a programmable timer output into PIC IR0 and run a guest-programmed,
periodic timer/EOI/HLT regression, including masking and READY interference.
Then address storage, BIOS services and the memory map needed by actual wired
DOS guests. Full 286 coverage still needs protected mode, additional faults,
debug/shutdown behavior, timing validation and broader board acceptance.
