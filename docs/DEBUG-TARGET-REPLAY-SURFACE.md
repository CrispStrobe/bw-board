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

### The rule is about REACHING, not about returning

The section above is about what `applyReplayInput` returns, and that is not
where this goes wrong. What goes wrong is that the method never gets as far as
returning, because it reached for `adapter.sendSerial`, or `machine.chips`, or
`cpu.nmi`, on an object that has none of them.

**`{machine: {cpu: {}}}` is a construction that exists.**
`test/code-address-progression.test.mjs:32` builds it literally, and
`z80-machine.test.mjs:77`, `debug-parity.test.mjs:23` and
`audio-ay.test.mjs:219` all construct a target over a bare `{machine}`. A
target is not always handed a full adapter over a full machine, and the
contract's rule has to hold for the ones that are not.

So: **guard every reach outside the closure**, and check the preflight as well
as the apply half — the preflight is what a runner calls FIRST. The one-line
version, which is the same sentence as the reachable-set rule above with the
second half attached: *grep every file the target can reach, and then guard
every reach you find.*

This is worth spelling out because it is the lesson that does not transfer on
its own. Within one hour, three targets each got a partial application of it,
every one by someone who had just applied it correctly a few lines earlier:

| target | guarded | threw |
|---|---|---|
| `z80` | `sendSerial`, after a review asked for it | — |
| `m6502` | `m6502.buttons` (checks for its VIA) | `m6502.serial`, `m6502.nmi` |
| `i8086` | `sendSerial`, with a comment explaining why | the preflight beside it, on three producers |

The 8086 row is the sharp one: the method whose whole job is to turn a
hardware fact into a refusal is the method that threw instead. A rule learned
about one call site is not yet a rule about the method, and a rule about the
method is not yet a rule about the file.

**The test shape that holds it**: read the producer list out of the source,
drive every producer against a hollow target with a VALID payload, and assert
each returns a refusal. Both halves are load-bearing. Scanning the source means
a producer added later cannot reintroduce the defect silently. Using a valid
payload means the refusal comes from the missing hardware and not from a
validation short-circuit — a table of malformed payloads passes against a
throwing implementation too, which is the whole reason this was not caught.

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

Measured, not remembered. All four are on master as of `0b00f6a`; the `where`
column stays because a row that names a branch is how a reader tells a shipped
surface from a proposed one, and the next target added here will need it again.

| target | producers | domain | where |
|---|---|---|---|
| `emu8051-adapter` | `emu8051.pin`, `emu8051.adc` | `8051-input-ns` | master |
| `z80-debug` | `z80.buttons`, `z80.keys`, `z80.serial` | `z80-cycles` | master |
| `m6502-debug` | `m6502.buttons`, `m6502.serial`, `m6502.nmi` | `m6502-cycles` | master |
| `i8086-debug` | `i8086.key`, `.gpio`, `.serial`, `.nmi`, `.rom` | `i8086-cycles` | master |

The 8051 refuses everything while a board is attached, and the reason is worth
repeating because the first version of that guard got it wrong: **the hazard is
the attached board, not the mode.** A live board re-asserts its own pin values
through the same native setter replay uses, in poll mode as well as push, so a
replayed level is overwritten on the next run slice. The guard is `if (board)`.

## Open, and deliberately not fixed in passing

- **The domain strings disagree, and the rename is scheduled rather than
  refused.** `8051-input-ns-reset-N`, `z80-cycles-rewind-N`,
  `m6502-cycles-rewind-N`, `i8086-cycles-reset-N`. Two of them say "reset" and
  neither bumps on a reset: on the 6502 and the 8086, `reset()` ADVANCES the
  clock by the real reset sequence's cost (`m6502-machine.js:510`,
  `i8086-machine.js:1130`).

  Renaming one side alone breaks replay of existing logs — a log carries the
  string and a replayer compares by equality — which is why the 8086's is kept
  for now. But "a wrong name kept because the consumer knows it" is a debt that
  gets more expensive with every target that copies the pattern, and there are
  four. **The ruling is: do the rename, as one change across both sides, in the
  same week as the downstream retirement**, with a note that logs recorded
  before it are not replayable after it. Not before, and not never.

- **The 8051 is covered by enumeration, not detection.** Its clock lives in the
  WASM core, so it cannot compare against a last-stamped tick; the epoch bumps
  at one explicit trigger inside `reset()`. That is complete today — measured:
  `reset()` takes the clock to zero and `loadHex` leaves it alone — and
  `test/emu8051-clock-enumeration.test.mjs` is what keeps it complete, by
  calling every public method and reddening on one that rewinds without a row.
  Detection alone would not replace it: a reset issued while the clock is
  already zero moves nothing, so the explicit trigger stays necessary either
  way.
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
