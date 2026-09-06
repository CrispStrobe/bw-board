# Chip refusals: what the model will not do, said out loud

A refusal is the model declining something the silicon does. Not a bug and not
a crash — a boundary, reached by a program that asked for something real.

This file is the contract for how those boundaries reach a consumer. It exists
because there are now two of them outside this repo (a debugger session line
and brickwright-lite's matrix P lane), and a shape with consumers is an
interface whether or not anyone writes it down.

## The problem it was built for

The chips here have always been careful about announcing their limits. The 8255
and 8251 set `modeWarning`. The uPD765 returns IC=invalid and names itself in
`lastRefusal`. The SB DSP and YM3812 count unknown commands. The 8237 records
unmodelled command bits.

On 2026-09-05 a grep showed that **nothing outside each chip read any of it**.
The announcements were real, individually well designed, and unreachable. A
driver programming memory-to-memory left a precise record in a field no
consumer ever asked for — which is the same silence the record was written to
replace, arrived at more expensively.

`I8086Machine.chipRefusals()` is the collector that fixed that. What follows is
the row it produces.

## The row

Every row, from every chip, has exactly these eight fields:

    {part, kind, feature, symptom, count, at, ats, atsMore, space}

**A downstream vendor should import the contract, not retype it.** The same
list is exported as `ROW_FIELDS` from `src/chip-ledger.js`, which is part of
the merge set — this document is bw-board's and a vendor does not take it, so
prose alone would force a second list that has to agree with this one. A gate
binds all three: the list here, the exported array, and the row the collector
actually builds. Any two of them drifting is red.

```js
{
    part:    'dma',        // the key it is filed under in machine.chips/devices
    kind:    'chip',       // 'chip' | 'device'
    feature: 'memory-to-memory transfer',
    symptom: 'a block copy programmed through the DMA controller moves nothing '
           + 'and the temporary register reads back zero',
    count:   1,            // every refusal of this feature
    at:      0x08,         // the first address it was refused at, or null
    ats:     [0x08],       // every address, first-seen, bounded
    atsMore: false,        // true when the bound dropped one
    space:   'port',       // what `at` is an address IN: 'port' | 'register'
}
```

**`feature` is what was asked for. `symptom` is what the program gets instead.**
They are separate because they answer different questions and a reader needs
both: the feature names the gap, the symptom is why the program is behaving
strangely. A row with only a feature tells a learner *what they are looking at*
and nothing about *what it did to their code*.

**`at` is in the part's own space** — a port number or a register offset, never
a machine-bus address. The board's decode is the board's business, and a chip
that baked one in would be wrong on the next board. A consumer that wants an
absolute address adds it from its own bus map, which it has and the chip does
not.

One deliberate exception, commented at its call site: the **YM3812 reports the
OPL register index**, not the ISA port. Its port pair is two wide, so the port
is identical for every OPL refusal and joins to nothing, while the register is
what the part's map is keyed by and what the program actually named.

**`space` says which of the two `at` is** — `'port'` or `'register'`. It exists
because brickwright-lite-ea, building the first consumer, could not tell them
apart: a panel line holding a bare integer must either say the weaker thing
("at 08h") or keep a part-to-space table on the reading side, and that table is
a second list that has to agree with these chips — the thing `ROW_FIELDS`
exists to stop. `'port'` is the default, true of every chip but the one above,
and it is set where the chip writes the refusal rather than guessed where a
consumer reads it. The writing end knows the answer; the reading end does not.

**`at` is the first address, not the last, and it is `ats[0]`** — derived, not a
second claim, with a gate asserting they cannot disagree. First rather than last
so a row's anchor does not move under a reader while the program runs.

**`ats` is a set because `count` is a total.** The first version kept one `at`
and let a later address overwrite it, so a feature refused at two ports reported
`count: 2` beside one address: a true count printed next to a location that
quantified over less than the count did. That is the failure this repo has spent
the week naming, in miniature.

**`atsMore` exists so the bound is not silent.** The set is capped (`AT_CAP`,
8) because a program that walks every port would otherwise turn a diagnostic
into a leak. Truncating is fine. Truncating without saying so produces a list
that reads as complete.

**`symptom` and `at` are `null` when the chip records none**, and null means
"no anchor, render the sentence alone" — never `0`. Inventing an address would
point a debugger at somewhere the program never touched, which is worse than
pointing nowhere.

## Writing a ledger in a new chip

Use `src/chip-ledger.js` and you get the shape for free:

```js
import {noteRefusal} from './chip-ledger.js';

noteRefusal(this.unmodelled ||= new Map(), 'DREQ sense inversion', {
    symptom: 'a device that requests by pulling DREQ LOW is never seen as requesting',
    at: reg,
});
```

**The name is load-bearing, and that is a real limit.** Collection is by name,
so a ledger called `notes` or `caveats` is not collected and never will be —
there is a test asserting exactly that, so the limit is stated rather than
discovered. If you name a field something the pattern does not match, it is
unreachable, and the source scan will tell you so at the next run.

A ledger that is a **sentence** rather than a Map — because there is only ever
one of it — carries its companions in siblings: `modeWarning` is accompanied by
`modeWarningAt` and `modeWarningSymptom`. The collector reads both shapes and a
consumer never learns which a given chip used.

## How the collector finds a ledger, and the two ways that bit

Collection is **derived, not enumerated**. Any own field whose *name* says it
records a refusal — `/refus|unsupport|unmodel|warning|invalid/i` — holding a Map
or a non-empty string is collected. The first version listed the four names it
knew, and the reachability gate immediately found two it did not reach
(`i8259.initWarning`, `board._refusedControls`). Adding those two by name would
have fixed the instances and left the class, which is how the list got short in
the first place.

Deriving has its own failure modes, and both showed up in the first smoke of the
finished vocabulary:

- **A sibling is not a ledger.** `modeWarningSymptom` contains "warning";
  `lastRefusalSymptom` contains "refus". Each sentence was collected as a
  refusal of its own — a row whose feature was the symptom and whose symptom was
  null. Fields ending `At`/`Symptom` are now skipped, *but only when the field
  they belong to exists*, so a chip whose ledger is genuinely named `refusalAt`
  is still collected.

- **One refusal is one row.** The YM3812's rhythm-mode refusal and the FDC's bad
  opcode each appeared twice: once through the chip's own `report()`, once
  through the field that report was built from. Every count was right and the
  row count was doubled — the same error one level up, quantifying over *views*
  instead of over events. The explicit paths now mark the field they consumed.

Both are gated in `test/chip-refusals.test.mjs`, and both are written up as
species in brickwright-lite's `docs/GATES-THAT-CANNOT-FAIL.md` — "one thing,
counted once per view" and "a rule that matches its own output". The short
version of why each is worth a name:

The **double rows** are the general form of that document pointing the *other*
way. Everything catalogued there is loop-set ⊊ goal-set producing a false
green. This is the superset case, and it produces no false green at all: every
count on every row was correct, and what was doubled was the number of rows.
The collector enumerated *representations of the ledger* where it meant to
enumerate *events in it*. There is no line to disagree with, and the error
lives only in the cardinality of the result — which is the thing a reader never
checks. Deduplicating the rows would have hidden it and left the cause; the
fix is that each ledger is read once.

The **sibling** case is not "the regex was too loose". The regex is right:
`modeWarningSymptom` *is* named for a refusal — it is the refusal's symptom.
Narrowing the pattern until it stopped matching would have destroyed the
property that made deriving worth doing. The rule did not need to be narrower;
it needed to tell a subject from a companion, which is a distinction about
role, not about naming.

## What is gated

`test/chip-refusals.test.mjs` is the consumer and the gate. Beyond the two
above it holds:

- a **source scan** requiring every chip that keeps a ledger to be reachable, so
  a chip added later with a private field fails here rather than quietly joining
  the unread;
- the counterpart: a ledger whose *name* does not say what it is stays
  unreachable **by design**, asserted, so the limit is documented in the place
  that would otherwise hide it;
- every chip that can refuse produces a row with a symptom *and* an address;
- `at === ats[0]`, always;
- a capped set reports `atsMore`;
- a `report()` that throws does not break a read;
- a save-and-restore reports the same refusals as the machine it was taken from;
- an old checkpoint restores a missing anchor to `null`, not to a plausible
  address;
- an empty ledger is not a finding.

Every property was mutation-proved: the check was reverted, the suite went red,
and red on the test that claims it.

## A refusal has to survive a checkpoint

The gate above proves every chip that can refuse produces a full row. It says
nothing about the same machine after a save and restore — and asking that next
question found two chips losing the refusal there, in different ways.

The **8251** cleared `modeWarning` in `loadState`, so a machine saved in
synchronous mode came back running as async with nothing saying so. The refusal
was still true — the chip still could not do the thing — and the only record of
it had been erased by an unrelated operation. The **8259** had no way to carry
`initWarningAt`, so a chip restored mid-init reported its refusal with nowhere
to point: a row that got thinner after a checkpoint than before it.

Neither invents anything on restore. The 8251's `mode` and `_sync` are both in
the checkpoint, so the warning is **derived from restored state** rather than
remembered; the 8259's anchor now travels with the phase. A checkpoint written
before the anchor existed restores it as `null` and not as `0` — zero is the
8259's command port, an address the saved program may never have touched and
indistinguishable from one it did.

**One ledger deliberately does not survive**: the YM3812's, which is not
serialised at all. It is a diagnostic, not part of the audio state, and
restoring it is not the same problem as the one below.

## One bug this shape found on its way in

`YM3812.setState` rebuilds derived operator state by replaying all 256 registers
through `_poke` — and `_poke` also refuses. So a save/restore added a refusal
for every unsupported bit that happened to be set, and `count` said "the program
asked N times" when the program asked once and was restored N−1 times. A
consumer joining to that count would have been reading restore traffic. The
ledger is a diagnostic, not part of the audio state being rebuilt, so it is now
put back as it was.

## Changes a consumer has to know about

**The SB DSP's ledger key changed** (2026-09-06). It was the raw command byte —
`unsupported.has(0xb6)` — and it is now the name: `DSP command b6h`. A row keyed
`182` says nothing to a reader, and this ledger now feeds `chipRefusals()`.

This one bites quietly: **a `.has(0xb6)` that returns false is not an error.**
Anything reading that Map by number finds nothing and reports no refusals, which
is indistinguishable from a chip that refused nothing. The bw-board test that
read it by number now asserts the stronger property instead — the command must
be identifiable from the entry *and* the entry must say what the driver sees.

**The 8237's Map values changed shape** but not its keys: a bare count became
`{count, symptom, ats, atsMore}`. The collector reads both, so a partially
merged tree degrades to thinner rows rather than to a crash. Do not lean on
that — thinner rows are what this whole change removes.

Nothing else changed key or shape.

## A row does not mean the same thing for every part

**Some refusals are RETRACTED and some are permanent, and the row does not say
which.** This is the sharpest limit in the document and it was found by a
consumer, not by me: brickwright-lite-ea spent two CI runs trying to observe a
refusal that had already been withdrawn.

    RETRACTED — the field returns to null when the condition passes
      pic    8259.initWarning     cleared the moment the ICW sequence completes
      usart  8251.modeWarning     cleared when a later mode word selects async
      ppi    8255.modeWarning     cleared by a mode-0 control word

    PERMANENT — nothing removes the entry short of a reset
      dma    8237.unmodelled      Map entries are only ever added
      opl    YM3812.unsupported   same
      dsp    SB DSP.unsupported   same
      fdc    uPD765.lastRefusal   overwritten by the next refusal, never cleared

Both behaviours are correct where they are. The 8259's refusal is TRUE while
its init sequence is incomplete and FALSE afterwards; recording it as a
retraction is right, and making it permanent would mean a chip that was
correctly programmed still reported a fault. Equally, a driver that asked for
memory-to-memory once should stay on the record.

**The consequence for a consumer that polls** — and the debugger polls. On a
real boot ea measured the `pic1` refusal appearing at step 1513 and gone by
1517: four steps out of 1,579,840. A poller will see the permanent four
reliably and the retracted three only by luck.

So: `chipRefusals()` answers **"what is refused now"**. It does not answer
**"what was ever refused"**, and for four of the seven parts it happens to
answer both because nothing ever clears them. If a consumer needs the second
question — and it is a reasonable question, "did this program ever program the
PIC wrongly" — that wants a different mechanism, not a longer poll. A poll
cannot see a window it was not inside.

## The limits, stated rather than discovered

**Collection is by NAME.** A ledger called `notes` or `caveats` is not collected
and never will be. There is a test asserting exactly that, so the limit lives
next to the mechanism instead of being found by whoever writes the next chip.
The source scan will tell you at the next run if you have named one wrong.

**The address set is bounded.** `AT_CAP` is 8. A feature refused at more
addresses reports the first eight and sets `atsMore`; `count` is still the true
total. So `ats` answers "where did this happen" only up to the cap, and
`atsMore` is the flag that says the answer is partial. Never infer the number of
distinct addresses from `ats.length` when `atsMore` is true.

**One ledger is deliberately not serialised.** The YM3812's does not survive a
checkpoint, because it is a diagnostic rather than part of the audio state being
rebuilt. Every other refusal in this document does survive one, and there is a
gate for that.

## What is deliberately not here

The 8255's modes 1 and 2, the 8251's parity on a clean wire, and the CPU's
prefetch queue are **refused on purpose**, each for a reason written where the
refusal is. They produce rows; that is the point. A row here is not a to-do
list entry.
