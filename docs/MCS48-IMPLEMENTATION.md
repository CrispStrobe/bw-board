# NMOS Intel 8049 CPU implementation

`src/mcs48.js` implements the documented NMOS 8048/8049 instruction set with the
8049's 128 bytes of internal RAM. `src/mcs48-disasm.js` supplies the matching
instruction descriptions, byte lengths, machine-cycle costs, and disassembler.
All 230 documented opcode encodings have execution handlers. The other 26 byte
values are explicitly undefined; CMOS and UPI-41 extensions are not enabled.

The core is an **instruction-level, machine-cycle-accounted model**. It does not
claim oscillator-edge or pin-waveform accuracy. A machine cycle is 15 oscillator
periods; for example, a 6 MHz oscillator gives 400,000 machine cycles per second.
The CPU does not choose a board's oscillator frequency.

## Authorship and primary sources

The CPU, decoder, disassembler, and tests were independently authored for this
repository. The implementation author did not read any GPL emulator source,
GPL-derived implementation pseudocode, or the separate CP1 reference checkout.
No MAME source or other emulator implementation was consulted or adapted. New
code uses the repository's MIT license; the source files carry MIT SPDX markers.

The following original Intel publications were consulted as hardware and
instruction specifications on 2026-11-24. The linked scans are hosted by
Bitsavers; they are Intel documents, not third-party emulator implementations.
The scans themselves are not included in this repository.

| Original publication | Relevant material | SHA-256 of consulted PDF |
| --- | --- | --- |
| [Intel MCS-48 and UPI-41 Assembly Language Manual, December 1978, order 9800255D](https://bitsavers.trailing-edge.com/components/intel/8048/9800255D_MCS-48_and_UPI-41_Assembly_Language_Manual_Dec1978.pdf) | Chapter 1 register/stack/PSW architecture; chapter 3 instruction behavior, especially pp. 3-8, 3-13, 3-29, 3-31–33 and 3-38–40; appendix A opcode encodings and cycle counts | `2a1e93445c646f4b20da26ff283eecfe016bce87803263e2750f97290a2b500a` |
| [Intel MCS-48 Family User's Manual, July 1978, order 9800270D](https://bitsavers.trailing-edge.com/components/intel/8048/9800270D_MCS-48_Family_Users_Manual_Jul78.pdf) | Sections 2.1.3–2.1.12, particularly port latch diagram p. 2-4, interrupt logic p. 2-7, timer/counter pp. 2-8–9, reset p. 2-12; program banking p. 3-2; BUS/P2 effects p. 3-11; DA behavior p. 4-13; 8243 command encoding p. 6-58 | `d2d79d20e0cec4eafd7beeaad22d6c07a7ad14e28e1b1c499421cc354d8d83f7` |

The tests are original specification-based cases and mathematical checks. They
are not copies of an emulator's tests or captured GPL emulator instruction
traces. This provenance statement applies to the files listed above and
`test/mcs48*.test.mjs`; board firmware and board-level peripherals have their own
provenance.

## Architecture and program addressing

The internal RAM array has 128 bytes. Register bank 0 occupies addresses 0–7 and
bank 1 occupies 24–31. Indirect internal-memory accesses use the low seven bits
of R0 or R1. MOVX supplies the entire eight-bit register value to the board's
external-data callback. The board can combine that address with port outputs to
decode a larger peripheral or memory map.

The eight stack slots are the actual RAM bytes at addresses 8–23. Each slot
contains the return address's low byte followed by its high four bits and the
upper four PSW bits. The stack pointer wraps modulo eight. RET restores the
address and decrements SP; RETR also restores C, AC, F0 and the register-bank
selection, then releases the interrupt-in-progress lock. F1 and the SEL MB latch
are not restored from the stack. PSW bit 3 is always one, including after
`MOV PSW,A`.

The first 2 KiB of the program backing array represent the resident 8049 ROM.
The backing array is 4 KiB so expanded program bank 1 can be supplied without
changing the CPU type. Unloaded bytes contain `0xFF`. An optional `readProgram`
callback can override any fetched address; returning `undefined` falls back to
the backing array. No program-memory images are built into the core.

The hardware distinctions between a PC bank and the SEL MB latch are retained:

- Sequential fetch increments PC bits 0–10 and leaves bit 11 unchanged. It wraps
  from `0x7FF` to `0x000`, or from `0xFFF` to `0x800`.
- SEL MB0/MB1 change a separate latch. JMP and CALL copy that latch to PC bit 11,
  except while an interrupt is in progress, when the target must be in bank 0.
- Conditional jumps and DJNZ use the page after the opcode fetch, before the
  destination-byte fetch. A branch at `0x0FE` can target `0x000–0x0FF`; one at
  `0x0FF` targets `0x100–0x1FF`.
- MOVP and JMPP similarly use the page reached after the opcode fetch. MOVP3
  selects page 3 within the current 2 KiB PC bank, independently of SEL MB.
- Returning across a program bank restores the stacked PC bank, while leaving
  the SEL MB latch as it is.

Intel restricts the placement of some instructions at the end of a 2 KiB bank.
The core applies its fetch/wrap rules consistently even to such invalid program
layouts; those results are not a claim about undocumented silicon behavior.

## Time, timer, and interrupts

`step()` executes one instruction and returns its documented one- or two-machine-
cycle cost. If an enabled interrupt is accepted at the boundary, that call to
`step()` performs only the two-cycle interrupt entry. The first service-routine
instruction executes on the next call. `cpu.cycles` includes instruction cycles
and interrupt-entry cycles. `lastStep` distinguishes instructions from interrupt
entries for debugger use.

Every consumed machine cycle advances `cpu.cycles`, invokes `onCycles(1, cpu)`
when supplied, and then updates the timer or samples the counter input. This
lets a board advance its peripherals and change input levels on a known cycle
boundary. In timer mode, a five-bit prescaler advances the timer once per 32
machine cycles. STRT T starts at the end of its instruction and clears the
prescaler; it does not clear T. STOP TCNT stops at the end of its instruction.
Counter mode increments on a sampled high-to-low T1 transition. STRT CNT first
records the current level so starting with T1 already low does not invent an
edge.

Timer overflow has two distinct state bits. The JTF flag is set regardless of
interrupt enable and is cleared by JTF or RESET. A pending timer interrupt is
latched only while timer interrupts are enabled; DIS TCNTI clears that request.
Accepting a timer interrupt clears the request, while leaving the JTF flag
unchanged. An overflow while timer interrupts are disabled is not retroactively
turned into an interrupt by EN TCNTI.

External interrupt input is level-sensitive. The callback uses the logical
convention `true = asserted`, corresponding to a low voltage at physical /INT.
External interrupts have priority over simultaneous timer requests. They vector
to address 3; the timer vectors to address 7. An interrupt-in-progress lock
prevents nesting independently of the two interrupt-enable bits. A still-low
/INT can immediately cause a new entry after RETR.

### Timing boundaries and limitations

Instruction effects and ordinary I/O callbacks occur at the start of the
instruction-level step; their callback timestamp is the current `cpu.cycles`.
The counted cycles then elapse. Start/stop-counter changes are deferred as
described above. This convention is deterministic but does not reproduce each
S1–S5 phase of Intel's timing diagrams. The board should use the documented
machine-cycle count for elapsed time and should not infer oscillator-edge
timing from callback order.

The counter observes T1 once per machine cycle. Pulses entirely between samples,
minimum pulse-width requirements, metastability, and the silicon's highest
qualified event rate are outside this model. External IRQ is inspected between
steps rather than at the ALE electrical sampling edge. EN T0 CLK records the
enabled state and calls `clockOutput`; it does not synthesize a clock waveform.
No physical-chip differential timing qualification is claimed.

## Pins, ports, external data, and the expander interface

P1/P2 output latches and sampled input pins are separate. IN combines the sampled
pin byte with the latch, so a latched low remains low. ORL/ANL P1/P2 read the
latch, not the external pin sample. Port writes update the latch before notifying
the board.

BUS tracks its output byte and whether it is driving. OUTL and immediate BUS
logic drive the result. INS reads the board's BUS callback. MOVX releases BUS and
invalidates its former static output. The model uses `0xFF` as a deterministic
discarded-latch value; firmware must issue a new OUTL before relying on BUS
logical operations following MOVX. Actual address/data strobes and bus contention
are not simulated.

MOVD, ORLD, and ANLD expose the 8243 command and data nibble on P2 and optional
PROG transitions. A MOVD input releases P2's low nibble, reads only four input
bits, and clears A's high nibble. Expander output operations leave the operand
nibble on P2. A small four-nibble shadow array supports logical output operations;
the `writeExpander` callback receives both its result and the operation/operand
so a board with its own 8243 model can apply the operation to its own latch.
The core does not model the 8243's electrical settling or first-read-after-write
restriction. A real board model owns external expander direction and device
selection.

## API

```js
import { MCS48 } from './mcs48.js';
import { disasmMCS48 } from './mcs48-disasm.js';

const cpu = new MCS48({
  rom: new Uint8Array([0x23, 0x5a, 0x39]), // MOV A,#5A; OUTL P1,A
  readPort: (port, core) => 0xff,
  writePort: (port, value, core) => { /* update board outputs */ },
  readExternal: (address, core) => 0xff,
  writeExternal: (address, value, core) => { /* external RAM / peripheral */ },
  onCycles: (count, core) => { /* count is 1; core.cycles is already advanced */ },
});

cpu.step();
const next = disasmMCS48((address) => cpu.readProgram(address), cpu.pc, {
  memoryBank: cpu.memoryBank,
  interruptInProgress: cpu.interruptInProgress,
});
```

Optional callbacks, with their arguments, are:

| Callback | Purpose |
| --- | --- |
| `readProgram(address, cpu)` | Optional program-memory override; `undefined` uses `cpu.rom` |
| `readPort(port, cpu)` / `writePort(port, value, cpu)` | P1/P2 input sampling and output latch changes |
| `readExternal(address, cpu)` / `writeExternal(address, value, cpu)` | MOVX transactions, eight-bit address |
| `readBus(cpu)` / `writeBus(value, cpu)` | BUS input/output transactions |
| `readTest(index, cpu)` | T0/T1 levels as 0/1; absent callback uses `setTest` state |
| `readInterrupt(cpu)` | Logical assertion; absent callback uses `setInterrupt` state |
| `readExpander(port, cpu)` | Four-bit sample for P4–P7 |
| `writeExpander(port, result, operation, operand, cpu)` | Four-bit result and `write`, `or`, or `and` operation |
| `writeProg(level, cpu)` | Expander command/data strobe notifications |
| `clockOutput(enabled, cpu)` | EN T0 CLK / RESET mode notification |
| `onCycles(count, cpu)` | Advance board time once per machine cycle |

`pc`, `a`, `psw`, `ram`, `p1`, `p2`, `bus`, `timer`, timer/interrupt flags, and
`cycles` are inspectable. `getRegister`/`setRegister` select the active register
bank; `setTest` and `setInterrupt` supply pins when no callback is configured.
Callbacks may inspect the CPU but must not recursively step, reset, or restore
it. Exceptions from board callbacks propagate; external callback side effects
are the board's responsibility.

`loadRom(bytes, { offset = 0, clear = true })` validates the entire input before
changing the existing image. It accepts byte arrays, Uint8Array, or ArrayBuffer.
`reset()` applies the documented reset controls while preserving A, C, AC, T,
and RAM. `reset({ cold: true })` also zero-initializes those otherwise unspecified
power-on data values. RESET releases P1/P2, disables interrupts, clears F0/F1 and
the timer flag, stops counting, and selects both bank-zero controls. By default,
reset restarts the CPU's cycle counter; `resetCycles: false` retains it. A board
can maintain its own monotonic time across CPU resets. Construction does not call
output callbacks, avoiding callbacks against a partially constructed board.

The disassembler exports `disassembleMCS48` and its alias `disasmMCS48`, plus
`disassembleMCS48Range` and immutable `MCS48_OPCODES`. A row contains `address`,
`bytes`, `length`, `mnemonic`, `operands`, `text`, `cycles`, `legal`, and a direct
`target` when applicable. Byte arrays and read callbacks are both supported.
SEL MB state cannot be inferred from a single instruction; callers should pass
that context when available.

## Undefined instructions and snapshots

The default `illegalOpcodeMode: 'trap'` raises `MCS48IllegalOpcodeError` before PC
or machine cycles change. The explicitly requested mode `'nop'` consumes one
byte and one machine cycle for undefined slots. That is a compatibility policy,
not an undocumented instruction claim. The disassembler shows those slots as
`DB` and marks them `legal: false`.

`saveState()` emits a JSON-compatible, versioned snapshot containing program
backing, RAM, port latches, flags, timer phase, pending interrupt state, supplied
pin levels, expander shadow latches, and the illegal-opcode policy. Callback
functions and external peripherals are not serialized. Snapshots are taken only
between instructions.

`MCS48.validateState(state)` and the named `validateMCS48State` export validate
and copy a snapshot without changing any CPU. `loadState` completes that
validation before applying anything. Validation checks exact array sizes, all
byte/nibble/bit ranges, booleans, cycle integrality, the PSW fixed bit, valid modes,
and interrupt-state consistency. Input arrays never alias live CPU arrays.
Restore does not emit output callbacks, allowing a whole-board snapshot to
restore CPU and peripheral state together. An external `readProgram` provider
must have its own snapshot strategy because it can override the saved backing.

## Verification

Run:

```sh
node --test test/mcs48*.test.mjs
```

The 32 tests cover all documented opcode slots and original behavior cases,
including exhaustive 256 × 256 × 2 ADDC inputs, all 100 × 100 × 2 valid packed
decimal additions followed by DA, register-bank and indirect RAM aliasing,
FE/FF page boundaries, two-bank fetch/table/call behavior, RAM stack wrapping,
RETR flags, simultaneous IRQ priority, two-cycle interrupt entry, timer /32
prescaling, disabled-overflow semantics, falling T1 edges inside a two-cycle
instruction, pin versus latch behavior, MOVX and 8243 transactions, reset data
retention, and transactional rejection of malformed snapshots.

All-opcode dispatch coverage and these specification tests are useful evidence;
they are not a statement that every possible full CPU state has been compared
against physical NMOS hardware.
