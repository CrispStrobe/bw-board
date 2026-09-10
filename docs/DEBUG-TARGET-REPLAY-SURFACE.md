# The debug-target replay surface

A debug target may let a recorder capture the host inputs a run received, and
let a driver push those inputs back into a second run. This document says what
that surface is, what each half is allowed to assume, and — more usefully —
which of its edges are known to be sharp.

The declaration is `src/debug-replay-contract.js`. Nothing here is a proposal:
every rule below is implemented by four targets and pinned by tests.

## The two halves are separate capabilities

```js
applyReplayInput(fact) -> outcome            // the APPLY half
onDebugInput(listener) -> unsubscribe        // the RECORD half
```

A target may implement either without the other, and `replaySupport` requires
only the apply half — a target handed facts produced elsewhere can replay them
without ever having recorded one. The record half is named `onDebugInput`
because that is the name with a consumer: a downstream recorder tests for it and
returns null without it, so a target using any other name is simply not
recorded, silently.

A fact is `{time, producer, payload}`.

## A refusal is a RETURN VALUE, never an exception

This is the one thing an implementer must not get wrong. A target that cannot
apply a fact says so and the driver decides; a target that throws makes every
caller wrap it, and callers that wrap stop distinguishing "this input is not
supported" from "the emulator broke".

`replayOutcome(value)` normalises the shapes already in the wild —
`{accepted}`, bare `true`, `{refused, code}` — into one. `undefined` is a
REFUSAL, deliberately: a method that falls off the end returns `undefined`, and
treating that as success would accept every input a target forgot to handle.

### Three refusal codes, and they mean different things

| code | means | example |
|---|---|---|
| `invalid-replay-input` | the FACT is malformed | a scancode of 999 |
| `unsupported-replay-input` | this target has no path for that PRODUCER | `i8086.paddle` |
| `no-input-path` | the producer is known, this BOARD cannot take it | a key on a board with no PIC |

Collapsing the third into the first is the easy mistake and it misinforms: a
board without an 8259 is not a caller error, and a driver told "invalid input"
will look for a bug in its log rather than at the machine it built.

### A refusal is a claim about the BUILD, so measure the reachable set

The z80 target refused `z80.serial` with "this build has no serial input path"
for weeks. The build had one: `z80-adapter.js:245`. The claim was written after
greping `z80-machine.js` — the file that declares the clock — and not the
adapter the target already holds a reference to. The same error produced two
more false refusals on the 6502 target (`m6502.serial` is `m6502-adapter.js:156`
and `m6502.nmi` reaches `w65c02.js:64` through `machine.cpu`, which the factory
already binds).

A refusal naming a gap the build does not have is worse than an unimplemented
method. An absent method is a `TypeError` somebody fixes. A refusal is a
considered statement that the tier CANNOT do the thing, and a driver believes
it.

**Before writing `no-input-path` with a sentence about the build**: list the
roots in scope at that point in the factory — typically `adapter`, `machine`,
`machine.cpu`, `machine.chips` — and grep the capability across the file of
each. If the sentence you are about to write contains "neither file" or "no X
anywhere", you bounded the search by the files you had open.

## EVENTS AND LEVELS ARE NOT THE SAME KIND OF FACT

Only one of them may be deduplicated, and getting this wrong loses data with
nothing to report it.

- **LEVEL** — a GPIO bit, a button mask, a switch. Setting it to the value it
  already holds is one state, not two facts. Deduplicate by a key naming the
  line (`chip.port.bit`), and SEED that key when replay applies one so the
  replayed value does not read as a change on the next pass.
- **EVENT** — a scancode, a received byte, an NMI. The same scancode twice is
  autorepeat; the same byte twice is two characters. Never deduplicate, and
  never let the event path consult the level map — a colliding key would
  suppress one of them.

Write them as two named functions (`publishInputLevel` / `publishInputEvent`),
not one function with a boolean. A wrong boolean at a call site reads as fine.

## Only a fact the machine TOOK is a fact

Every recording entry point gates on the result of the underlying call. A board
with no PIC returns false from `keyIn`; a board with no VIA returns false from
`setButtons`; a board with no UART takes no byte. Recording those would replay
inputs that never reached anything, and the log would be longer than the run.

This is the same defect as a wrong refusal, seen from the other side, and it is
worth a test on each entry point — it survived the first mutation pass on three
of the four targets.

## The stamp, the epoch, and the limit that remains

The stamp is the machine's own clock, not a host clock:
`{ticks, domain, hz}`. It is integral and needs no floating-point division; a
`tMs` getter is a lossy projection of exactly these two operands, not a
substitute for them.

`domain` names the TIMELINE. When a restore moves the clock backwards, the
epoch bumps and the domain string changes, so a replayer comparing domains can
tell that two facts came from runs that diverged.

Two rules that are easy to get backwards, both learned the hard way:

1. **Take the stamp BEFORE the dedup gate.** A suppressed input that skipped the
   stamp never notices the timeline moved.
2. **A detected rewind must CLEAR the dedup map, not only bump the epoch.** A
   surviving map holds levels from an abandoned timeline, and the first genuine
   change afterwards whose value happens to match one is dropped without trace.

**THE KNOWN LIMIT.** A restore followed by running PAST the old high-water mark
with no input in between is monotonic from the target's side and
indistinguishable from ordinary progress. Detection cannot see it. Closing it
needs a signal from the restore itself rather than an inference from the clock —
which is what a checkpoint API that goes through the target gives you, and is
the reason the checkpoint work is a separate convergence rather than a bigger
version of this one.

Where a target exposes both a reading and an advancing view of the clock
(`debugTime()` and the internal stamp), **reading must not advance**. If asking
the time consumed a rewind, a driver that merely enquired after a restore would
leave the next real input stamped in an epoch nothing could explain.

## What the four targets implement

Measured, not remembered. Two of these are on unmerged lane branches at the time
of writing; the table says which.

| target | producers | domain | where |
|---|---|---|---|
| `emu8051-adapter` | `emu8051.pin`, `emu8051.adc` | `8051-input-ns` | master |
| `z80-debug` | `z80.buttons`, `z80.keys`, `z80.serial` | `z80-cycles` | master + `fix/z80-serial-replay-path` |
| `m6502-debug` | `m6502.buttons`, `m6502.serial`, `m6502.nmi` | `m6502-cycles` | `feat/m6502-replay-input` |
| `i8086-debug` | `i8086.key`, `.gpio`, `.serial`, `.nmi`, `.rom` | `i8086-cycles` | `feat/i8086-replay-input` |

The 8051 refuses everything while a board is attached, and the reason is worth
repeating because the first version of that guard got it wrong: **the hazard is
the attached board, not the mode.** A live board re-asserts its own pin values
through the same native setter replay uses, in poll mode as well as push, so a
replayed level is overwritten on the next run slice. The guard is `if (board)`.

## Open, and deliberately not fixed in passing

- **The domain strings disagree.** `8051-input-ns-reset-N`,
  `z80-cycles-rewind-N`, `m6502-cycles-rewind-N`, `i8086-cycles-reset-N`. Two of
  them say "reset" and none of them bumps on a reset: on the 6502 and the 8086,
  `reset()` ADVANCES the clock by the real reset sequence's cost
  (`m6502-machine.js:510`, `i8086-machine.js:1130`). The 8086's string is kept
  as it is on purpose — a log recorded by the existing downstream consumer
  carries it and equality is what a replayer compares — so the rename is a
  coordinated change on both sides, not a drive-by.
- **Recording lives in the debug target, and some input paths do not.** Where a
  target grew a `sendSerial` to have something to record, a caller holding the
  adapter can still reach past it. That bypass is stated in each such method
  rather than claimed closed. Closing it means recording inside the adapter,
  which is where the 8051 does it.
- **The checkpoint refusal axis is not declared here.** It is a second kind of
  refusal — "this target cannot serialise its in-flight state at all", static
  per target, as against "it can, but this session's wiring makes a restored run
  diverge", dynamic per topology. `replaySupport` already takes reasons as a
  LIST for exactly this reason: one boolean cannot carry both, and a new refusal
  kind should be a new entry rather than a new field.
