# CARDIAC in bw-board

`cardiac` is an independently authored decimal instruction model for the Bell
Laboratories **CARDboard Illustrative Aid to Computation**. One machine powers
standalone lessons, the debugger and the Circuits part. There is no historical
ROM, native build, network request, DOM dependency or timer inside the core.

The historical CARDIAC was an educational cardboard computer operated by a
person. Its decimal memory, accumulator and instruction sequence make code and
data visible. It does not supply a physical gate design or processor clock to
emulate. This implementation's circuit terminals and timed instruction scheduler
are explicitly modern teaching additions.

## Sources and compatibility

Primary references:

- [Bell Laboratories CARDIAC instruction manual, Drexel scan](https://www.cs.drexel.edu/~bls96/museum/CARDIAC_manual.pdf).
- [Bell Laboratories Record, July 1969, CARDIAC article](https://cs.drexel.edu/~bls96/museum/cardiac.pdf).
- [Drexel Computer Museum's technical description](https://www.cs.drexel.edu/~bls96/museum/cardiac.html).
- [Smithsonian collection record](https://americanhistory.si.edu/ne/collections/object/nmah_1465426).

The original model uses 100 decimal memory addresses, three-digit signed words,
a four-digit accumulator, direct memory card input/output and a decimal opcode
followed by a two-digit operand. Fetch advances the instruction counter before
execution. Cell `00` supplies the constant `001`; a jump uses cell `99` for its
return instruction. The manual's paper procedure leaves some software edge
cases open to convention. The following named contract makes those decisions
testable instead of relying on an unspecified emulator dialect.

### Brickwright CARDIAC v1

The checkpoint model identifier is `brickwright-cardiac-v1`.

| Area | Implemented contract |
| --- | --- |
| Words and addresses | Exactly 100 words, addressed `00..99`; each word is an integer `-999..999`. All interface addresses and instructions are decimal. |
| Initial state | Unassigned words are zero; `00 = 001`, `99 = 800`; accumulator is zero; PC is the image's entry. Loading starts paused with empty trays. |
| Fetch | Read the instruction, then advance PC modulo 100, then execute its already-fetched operand. |
| Accumulator | Signed `-9999..9999`. ADD and SUB retain the signed remainder modulo 10000. Zero has one canonical representation. |
| STO | Retains the signed remainder modulo 1000; does not change the accumulator. |
| SFT | For `4LR`, multiply by `10^L`, retain the signed remainder modulo 10000, then divide by `10^R` with truncation toward zero. |
| Cell 00 | Always `001`. Instruction writes are ignored; `INP 00` still consumes one input card. Image and manual edits that change the constant are refused. |
| Cell 99 | Initially `800`, then **fully writable**, including its leading digit. This is an explicit software convention beyond the cardboard's printed leading `8`. |
| JMP | Store `800 + nextPC` into `99`, then jump to the fetched operand. Executing a return at `99` first fetches it; the ensuing link write of `800` cannot change that fetched target. |
| TAC | Branch only if the accumulator is negative. Does not write `99`. |
| Negative instruction | Retires as a skipped instruction. The event explains this compatibility convention. Negative data remains ordinary data. |
| Empty input | `waiting-input`, with PC, IR, memory and instruction count unchanged. No zero is invented. |
| HRS | Halts and sets PC to its operand. Memory, accumulator and trays remain. |
| Host Reset | Restores the originally loaded image and entry, clears accumulator, inputs, outputs and runtime status, and pauses. Breakpoint addresses survive. |
| Numeric I/O | Every OUT appends its full signed word to the tray. `lastOutput` retains the last emitted word when the visible tray is cleared. |
| Resource bounds | At most 10,000 queued input cards and 10,000 output cards. A full output tray pauses with an explicit error before losing an output; clearing it allows continuation. Batches require a finite instruction budget. |

Instruction meanings:

| Digit | Mnemonic | Operation |
| --- | --- | --- |
| 0 | INP | Consume one input card into the addressed memory cell. |
| 1 | CLA | Load memory into the accumulator. |
| 2 | ADD | Add memory to the accumulator. |
| 3 | TAC | Transfer to the address when the accumulator is negative. |
| 4 | SFT | Shift accumulator decimal digits left, then right. |
| 5 | OUT | Emit the addressed memory word. |
| 6 | STO | Store the accumulator's low three decimal digits. |
| 7 | SUB | Subtract memory from the accumulator. |
| 8 | JMP | Write a return instruction at 99, then transfer. |
| 9 | HRS | Halt and select the restart address. |

`0 = INP` and `9 = HRS` are fixed. The alternate Kaleberg `0/9` numbering is
not silently detected or accepted.

### Comparisons consulted, without copying implementation code

| Reference | What informed the review | Licensing observed |
| --- | --- | --- |
| [StrangeQuery/heartburn](https://github.com/StrangeQuery/heartburn) | Explicit signed wrap/shift/return policies, manual fixtures and an empty-reader pause. Useful comparison for distinguishing software conventions. | MIT. |
| [jawhitti/Cardiac](https://github.com/jawhitti/Cardiac) | Another original-opcode implementation; unbounded accumulator and input/error handling differ from v1. | No license file found during review; no code reused. |
| [fzaca/CardiacVisualizer](https://github.com/fzaca/CardiacVisualizer), formerly Xukay101 | Visual instruction walkthrough. Its arithmetic, TAC/link and empty-input behavior were not adopted. | MIT. |
| [cinc / jcinc](https://sourceforge.net/projects/cinc/) | Existing compiler/emulator ecosystem. Exact source edge cases were not verified. | Project lists GPLv2; no code reused. |
| [Kaleberg CARDIAC](https://www.kaleberg.com/software/cardiac/) | Explicitly interchanges opcodes 0 and 9; useful reminder to name a dialect. | No reuse license verified; no code or artwork reused. |
| [Al Williams's spreadsheet project](https://hackaday.io/project/197615-cardiac-paper-computer-spreadsheet) | Author's later spreadsheet exploration. The referenced Dr. Dobb's archive and FPGA details were not available for direct verification. | No implementation reused. |

The new JavaScript and tests are MIT. No historical manual pages, cardboard
artwork, emulator source, HDL or sample program source were bundled from these
comparators. Numeric fixtures in this repository exercise independently stated
machine behavior.

## Core API

Import `bw-board/cardiac-machine.js` for the small, dependency-free module.

```js
import {
  createCardiacMachine, controlCardiacMachine,
  runCardiacMachine, snapshotCardiacMachine
} from 'bw-board/cardiac-machine.js';

const machine = createCardiacMachine({
  entry: 1,
  words: [
    {address: 1, value: 80},  // INP 80
    {address: 2, value: 580}, // OUT 80
    {address: 3, value: 900}  // HRS 00
  ]
});
controlCardiacMachine(machine, 'enqueueInput', 42);
const result = runCardiacMachine(machine, {maxSteps: 100});
// result.reason === 'halted'; machine.output is [42].
const checkpoint = snapshotCardiacMachine(machine);
```

`parseCardiacProgram` atomically validates an addressed image. It also accepts
sequential numeric arrays or a numeric listing (`@01`, `01: 080`). It does not
assemble mnemonics. A host assembler can supply extra source metadata on each
word; the machine stores only `{address, value}` and `entry`.

`stepCardiacMachine(machine)` retires one instruction or returns `null` when it
cannot proceed. `runCardiacMachine(machine, {maxSteps})` returns
`{reason, executed, lastEvent}`. Reasons are `budget`, `input`, `halted`,
`breakpoint` and `error`. A budget ending is distinct from HRS. To continue past
a reached breakpoint, send `controlCardiacMachine(machine, 'run')` before the
next bounded batch. An explicit manual step ignores the current breakpoint.

Controls shared by the core and Board include:

- `loadProgram(image)`, `enqueueInput(numberOrArray)`, `run`, `pause`, `halt`,
  `step`, `reset`, `setPc(address)`.
- `writeWord({address, value})` and `setAccumulator(value)` while paused.
- `setBreakpoint(address)`, `clearBreakpoint(address)`,
  `toggleBreakpoint(address)`, `clearOutput`, `restore(checkpoint)`.

`enqueueCardiacInput(machine, value, {source})` supports `manual` or `circuit`
provenance. Ordinary `enqueueInput` controls use `manual`.

The state keeps the initial `program` image separate from live `memory`.
Self-modifying instructions change live memory. Reset restores the image;
snapshot/restore captures the modified memory, PC, accumulator, inputs with
provenance, numeric outputs, last output, breakpoints and last instruction.
Checkpoints are detached JSON-compatible objects, validated before mutation.
They are machine checkpoints, not claims of electrical waveform replay.

## Observable instruction effects

`onCardiacEvent(machine, listener)` returns an unsubscribe function. Each
completed instruction supplies `lastInstruction` and `lastEvent` containing:

- Fetched address/word, decoded opcode/mnemonic/operand and step count.
- PC and accumulator before and after.
- Memory reads and writes, including values before and after writes.
- Consumed card and its source, emitted output, and branch decision.
- Ordered explanatory events for fetch, PC increment, memory, shift,
  accumulator, branch, I/O, ignored writes and halt.

Input wait and breakpoint events do not pretend an instruction completed.
Listener arguments are detached copies. This is sufficient for a host to ask
the learner to predict a result, reveal the actual transition, animate it and
explain a mismatch without reimplementing the interpreter. Reading a snapshot
or decoding a word cannot execute instructions or consume input.

## Circuits adapter

Call `registerCardiacDevice()` or `registerAllDevices()` before loading a part:

```js
{
  id: 'trainer', kind: 'cardiac',
  terminals: ['IN', 'OUT', '5v', 'gnd'],
  params: {program: {words: [], entry: 0}, instructionHz: 10}
}
```

The part holds its authoritative state in `Board.getDeviceState(id).machine`.
Top-level machine fields are synchronized for existing panels. Use
`Board.setDeviceControl(id, verb, value)` for commands. `params.program` is the
initial authored image; persisting an equivalent image does not restart the
machine or erase live STO modifications.

`sampleInput` is one additional Board control. It samples the most recently
solved `IN - gnd` voltage once, clamps it to 0..5 V, converts it to
`round(voltage * 999 / 5)`, and queues a card tagged `circuit`. Changing a
potentiometer or polling the panel never creates cards automatically. The
input has a 33 kΩ pull-down. The panel can show `inputVoltage` and
`sampledInput: {value, voltage, atNs}`.

Every OUT updates the modern output latch: **word 001 is HIGH; all other
words are LOW**. Numeric output is always retained. HIGH is a 5 V Thevenin
drive through 220 Ω; LOW is 0 V through 10 Ω. The `5v`/`gnd` terminals provide
the ordinary Board supply fallback. These are deliberate teaching interface
values, not electrical specifications of the cardboard artifact.

The configurable instruction rate is 1..1000 Hz, default 10 Hz. All execution
deadlines belong to Board's `_wakeNs` scheduler. Pausing stops instruction
retirement while the circuit remains observable. An empty reader parks the
next instruction; a new card resumes a directly running Board device. There is
no separate wall clock, requestAnimationFrame loop or interval in this model.

## Debugger attachment

`createDebugTarget('cardiac', {board, partId})` returns `{target, adapter}` and
uses the machine already owned by that part. It neither builds nor clocks a
second CPU. With no Board, pass `{program, instructionHz}` for standalone
virtual time. A Board attachment must identify an existing CARDIAC device.

The target implements the shared `DebugSession` contract, instruction steps,
code breakpoints, register views, decimal disassembly and passive memory
reads. Memory space `code` and its alias `program` contain signed **words**:
reads return `Int16Array`; writes accept integer arrays or `Int16Array` and
validate the entire range. They do not accept byte arrays that would silently
truncate words or negative values. Capability metadata declares radix 10 and
the decimal-word address unit.

`target.control(verb, value)`, `target.loadProgram(image)` and
`target.snapshot()` expose the same machine boundary to a dedicated CARDIAC
panel. An attached snapshot also includes the circuit input and latch view.
`runFor` is bounded to 100 ms per call and advances at most one instruction
boundary at a time before deciding whether to stop. A completed single step
therefore cannot accidentally advance a coarse Board frame through later
instructions.

DebugSession halts report `step`, `breakpoint`, `input-wait`, `cardiac-halt`,
`fault` or `user`. At input wait, queue a card then resume. This differs from
the continuously armed direct Board control only in host pacing: both use the
same empty-reader and instruction semantics. DebugSession's first `start` or
`step` invokes target reset; hosts that preload cards or attach to a live
machine must preserve/restore that state across session initialization or
enqueue cards after initializing the session.

## Verification

Run the focused tests with Node 20 or later:

```sh
node --test test/cardiac-machine.test.mjs test/cardiac-circuit.test.mjs test/cardiac-debug.test.mjs
```

Core tests have no external package dependency. The factory integration test
loads the existing shared factory and therefore requires the package's normal
dependencies. Tests distinguish conflicting emulator edge cases, build and
execute a program through cold-start cards, exercise self-modification and
checkpoint validation, and drive a real solved resistor/LED circuit. Coarse
and fine time slices produce equal instruction, output and LED histories.
Debug tests assert object identity with the Board machine and exact stopping
at instruction boundaries.
