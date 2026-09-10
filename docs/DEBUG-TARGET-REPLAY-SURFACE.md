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

**THE KNOWN LIMIT, AND HOW AN INTEGRATION CLOSES IT.** A restore followed by
running PAST the old high-water mark with no input in between is monotonic from
the target's side and indistinguishable from ordinary progress. Detection
cannot see it, and closing it needs a signal from the restore itself rather
than an inference from the clock.

**So the clock is injectable, and the era gate is DERIVED from it.** Each of the
three JS targets takes an optional `opts.debugTime`; the default is its own
clock, so a standalone target is unchanged. What the record half watches is not
a tick regression but **the DOMAIN STRING changing**:

```js
const time = clock();
if (lastDomain !== null && time.domain !== lastDomain) observedInputs.clear();
lastDomain = time.domain;
```

Two things follow, and the second is the one worth having:

1. A consumer whose checkpoints and instruction events already share an epoch
   can hand that clock in, instead of the target carrying a second one. One
   machine on two timelines — a checkpoint stamped in one era and an input in
   another at the same instant — is what a second epoch produces, and a
   replayer comparing domains by equality reads it as two runs.
2. **The record half inherits every trigger the injected clock has**, including
   an EXPLICIT one from a restore. That is exactly the signal this limit needs,
   and it arrives as a side effect of removing a duplicate clock rather than as
   a feature anyone had to build.

Deriving is why `debugTime()` alone is not enough. A shared clock's read is a
pure READ — it reports the era, it does not detect a change — so stamping from
it and dropping the epoch would get the domain right and never clear the map.
That is this surface's oldest defect reintroduced, and no existing test would
notice, because a map that fails to clear is invisible unless something replays
the same value across a rewind.

**A CONSEQUENCE TO NAME: with a clock injected, the domain string is a property
of the INTEGRATION, not of the target.** The same target code stamps
`m6502-cycles-rewind-N` standalone and something else when wired to a shared
clock. That is correct — a domain names a timeline, and an integration's
timeline is the one its checkpoints are on — but it means **an upstream test
asserting an exact domain string is describing the DEFAULT wiring and not the
target.** Say so where the assertion lives, or the next reader takes a green
test here as a claim about a wiring it says nothing about.

**What is still uncovered**: a clock whose own detection is deferred — one that
bumps on the next instruction step rather than at the restore — leaves a window
in which the rewind has happened and the domain has not moved yet. An input
arriving inside it is stamped on the old era. Narrower than detecting nothing,
and the same window that integration's other events already sit in.

**The 8051 is deliberately not injectable.** Measured: it imports no shared
event module, its downstream fork has been retired so no integration is waiting
to inject one, and its epoch is bumped by an explicit trigger in `reset()`
rather than by detection. An injection point with no caller is a capability
invented rather than needed. If a mixed-target session ever wants one clock
across tiers, that is the moment to add it.

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

Epoch suffixes: `-rewind-N` on the z80, 6502 and 8086, whose epochs are bumped
by a DETECTED rewind; `-reset-N` on the 8051, whose epoch is bumped by an
explicit trigger inside its `reset()`. The suffix names the mechanism, so the
two spellings are a distinction and not an inconsistency.

The 8051 refuses everything while a board is attached, and the reason is worth
repeating because the first version of that guard got it wrong: **the hazard is
the attached board, not the mode.** A live board re-asserts its own pin values
through the same native setter replay uses, in poll mode as well as push, so a
replayed level is overwritten on the next run slice. The guard is `if (board)`.

## Open, and deliberately not fixed in passing

- ~~**The domain strings disagree.**~~ **DONE, 2026-09-10, and the correction
  matters more than the fix.** The item used to read: *"two of them say reset
  and neither bumps on a reset"*. That was true of the 8086 and FALSE of the
  8051 — a claim verified about one member and written about two, which is the
  species this page already warns about, committed by the page itself.

  Measured: the 8051's epoch bumps at exactly one place, inside its `reset()`
  (`emu8051-adapter.js`), and that reset takes its clock to zero. **Its epoch
  really is a reset epoch and `8051-input-ns-reset-N` is the correct name.**
  The 8086's was not: `i8086-machine.js:1130` does `this.cycles += 4`, so a
  reset ADVANCES that clock, and the only backward move is `loadState:1817`.

  So the fix was one target, not two: `i8086-cycles-reset-N` →
  `i8086-cycles-rewind-N`, converging with `z80-cycles-rewind-N` and
  `m6502-cycles-rewind-N`. The goal was never that all four read alike; it is
  that each name matches its own mechanism, and now all four do. **Do not
  "converge" the 8051's.**

  **A log recorded before the rename is not replayable, and there is no
  migration.** A replayer compares `domain` by equality, so a log carrying
  `i8086-cycles-reset-2` and a live run producing `i8086-cycles-rewind-2`
  describe the same era and will not match. That note lives in
  `src/i8086-debug.js` as well as here, because the person who needs it is
  someone staring at a replay that refuses for no visible reason — and the test
  that asserts the new string names the old one for the same reason: a rename
  leaving no trace of the old spelling makes their grep come back empty.

  **The coupling was over-stated when this item was written, and the accurate
  version is narrower.** The claim was that a one-sided rename breaks replay.
  It does not: the domain is stamped by the target and compared by the
  replayer, and for the downstream consumer both of those are downstream, so
  each repo stays internally consistent on its own. What a one-sided rename
  actually breaks is CONVERGENCE — the vendored copy would gain a fresh
  divergence in the same file being grafted to remove one. A real reason to
  land the two together, and a weaker one than the one first given. Recorded
  because acting on the stronger sentence would have been acting on something
  the measurement does not say.

  **It is not a deletion, and calling it one sends the next reader to the wrong
  tool.** An earlier version of this page, and the commit that ported the apply
  half up, described the downstream file as something that could then be
  deleted and taken from upstream. That is true of the APPLY HALF and false of
  the FILE. Measured against this tree: the downstream copy holds **196
  lite-only lines** that have no upstream counterpart — a checkpoint capture, a
  live-input-source predicate, a video-frame cache, a DOS trap layer's
  boundary-service dispatch, a disassembler integration — none of it replay.
  The file is a GRAFT, and a whole-file sync would refuse on those 196 lines,
  which is the good outcome but only after someone had already formed the wrong
  plan.

  And the graft is not purely additive, which is the part worth knowing before
  starting it. Eight identifiers exist on both sides, and one of them decides
  the result: `eventTime` differs by exactly the rewind behaviour. The upstream
  one CLEARS the dedup map on a rewind; the downstream one does not, because it
  has no map — but the downstream file bumps the epoch EXPLICITLY on
  `restoreCheckpoint`, which upstream cannot do because its restore does not go
  through the target. **The merged version needs both**, and neither side alone
  is correct after the graft: take upstream's and you lose the explicit restore
  bump, keep downstream's and the map survives a rewind holding levels from an
  abandoned timeline. `keyIn`, `setInput` and `nmi` are replacements rather than
  additions for the same reason — the upstream versions record.

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
