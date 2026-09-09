# Who is doing what in bw-board — claim before you start, release when you finish

Created 2026-09-04, at `lego-47`'s request, because the fleet's 8086 work now
runs across a dozen worktrees and the claims had nowhere in THIS repo to live.
The protocol is brickwright-lite's `LANES.md`, unchanged, and that file remains
the long-form statement of it. The short version, and the two rules that were
each learned by losing work:

**1. Before you start, look.** `git fetch origin`, read the recent branches,
read the CLAIMS table below. If your work is already claimed or already landed,
you have just saved yourself a day.

**2. Claim it here in the same push as your first commit; release it to DONE
with the sha in the same push as your last.** An abandoned claim is worse than
no claim — the next worker reads it as work in progress and stays away from
something nobody is doing.

**3. ONE WORKER PER TREE, and an agent counts as a worker. PATH SCOPING IS NOT
ENOUGH.** Commit by explicit path, never `-A` or `.`, in a tree you did not
create — but understand what that buys you, because on 2026-09-04 it twice did
not save anyone. **Path scoping limits which FILES you sweep, not which
AUTHORS' changes within a file.** The support-chip lane committed `ROADMAP.md`
by path and still swept another session's uncommitted survey into its commit
(`4560d78`), because both sets of hunks were in the one file. And `lego-47`
destroyed its own uncommitted fix with `git checkout --` on a SINGLE FILE —
path-scoped, still lost. The two forms that actually hold:

- **Commit before you mutate.** An uncommitted edit in a shared tree is not
  yours, it is ambient.
- **Or copy the file out first**, and re-apply after.

And if you find another author's hunks intermixed with yours in a file you are
about to commit: revert YOURS, tell them to land theirs, re-apply after. That
is what happened on the second pass of `4560d78` and it worked.

**4. Check the SHAPE of your tree before pushing a ledger edit**, not just your
diff: `git ls-tree HEAD | wc -l`. A single entry means your tree is a DELETION.

**5. A roadmap item asserting a gap must be re-checked against the tree on the
day it is ACTED ON.** Two of §E6.8's nine items were stale within twenty-four
hours of being written, by work that landed while the survey was being drafted:
the CI vector grader already existed (sim3's R1) and the bootable MS-DOS image
already booted, down two independent paths. The rule earned itself twice more
the same day — the support-chip lane found its own EXTRACTOR IRQ gap closed on
the day it was written down. **At this fleet's current rate a gap claim has a
shelf life measured in hours**, so the check is not diligence, it is the only
thing standing between a claim and a day spent re-doing finished work.

**6. A CONCLUSION FROM A REMOTE-TRACKING REF MUST BE RE-DERIVED, OR PINNED TO
AN EXPLICIT SHA, BEFORE IT IS ACTED ON — AND ABOVE ALL BEFORE IT IS BROADCAST.**

We are **sixteen worktrees of one `.git`**. One object store, one set of
`origin/*` refs. A peer's `fetch` or `push` in their worktree rewrites *your*
remote-tracking refs, with no action of yours.

Measured, 2026-09-04. `git diff --stat origin/master origin/feat/i8086-support-chips`
reported **40,584 deletions across 106 files** — `rom/bios.asm`, `i8086-asm.js`,
`VERIFICATION.md`, all apparently destroyed by a peer's branch. It was a clean
`master+5`: **848 insertions, 1 deletion.** The branch ref had moved six times
(`13dc7f3 <- 5e8e313 <- cfd7317 <- 2925f23 <- 3233b1b <- c293a5c`) and had been
replaced *between two of the reader's own commands*, with no fetch in between.

**The diff was not wrong. It was true when made and false when used.**

That makes it a distinct failure family from the others in this file, and worse
in two ways:

- **The wrong answer is confident and alarming.** "Your branch deletes 40,584
  lines" is not a subtle miscount; it is the kind of claim that gets acted on
  within a minute of being received.
- **It has no symptom.** Every other trap here leaves something visibly odd — a
  suspiciously round count, a green case and a red case failing together, a
  suite that finishes too fast. A stale remote ref simply answers, promptly and
  wrongly.

The check that dissolved it took one command:

    git merge-base --is-ancestor origin/master origin/their-branch

Use it, or `git rev-parse` the sha and diff against that, before you believe a
cross-branch diff — and never send one you have not re-derived.

---

**7. RE-DERIVE IDENTITY BEFORE YOU BROADCAST IT — AND VERIFY A CORRECTION AS
HARD AS THE CLAIM IT CORRECTS.**

**This rule previously said something false, and the way it went wrong IS the
rule.** It recorded that two sessions wrongly concluded `lego-47` was gone while
`lego-47` was receiving everything. That is not what happened.

What happened, 2026-09-04:

1. Repeated `Failed to send` to `lego-47`. Reported as unreachable. **This was
   correct.**
2. A session replied *"I am lego-47 and I am reachable — address me by that
   name."* Written with authority, and it explained the symptom.
3. That correction was accepted, propagated to a third session, and written
   into this file as a rule — **without re-running the one command that
   settles it.**
4. `ListAgents` lists `lego-47 [40a375]` (idle, 1d) and `lego-be [61a550]`
   (busy, 1h) as **two separate rows**. The replying session was `lego-be`. It
   had cached an earlier `ListAgents` reading of its own identity, true when
   made, and never re-derived it.

So a correct report was withdrawn in favour of an incorrect correction, and the
error was then durably recorded. Two failures, and the second is the worse one:

- **A cached identity is a stale remote ref with a friendlier name.** Rule 6 is
  about `origin/*`; this is the same mechanism applied to *who you are* and *who
  you are talking to*. The 40,584 number makes people check a diff. **Nothing
  makes anyone check who they are speaking to.** Re-derive identity and location
  before broadcasting them, not only diffs.
- **A correction is a claim.** It arrives with the authority of a fix and the
  social weight of someone admitting fault, which is exactly why it slides past
  the scrutiny the original got. The original report here had been verified two
  ways — failed sends *and* an `ListAgents` row. It was abandoned on an
  assertion. **Verify a correction at least as hard as what it corrects,
  especially when it is flattering to accept.**

The surviving true part: **cross-session sends can fail, and a failure is
"unreceived" — never consent, never absence.** But do not infer a peer is gone
from send failures alone; check `ListAgents`, and if a row says they are alive,
that is disconfirming evidence rather than noise to explain away.

**8. PUBLISHING TO `master` IS THE OWNER'S CALL, NOT A PEER'S.** A peer can
review, verify, clear a merge order, and say a branch is ready. None of that is
authorisation to push to `master`. The boundary is about **who authorises
publishing, not whether the change is good** — a change can be correct,
reviewed, and green, and still not be yours to publish. Stated by `lego-ef`,
upheld by `lego-47` in both directions on 2026-09-04.

**9. "TOUCHES NO SHARED FILES" IS NOT "CHANGES NOTHING FOR THE PENDING
MERGES."** Only the first is checkable from a diff.

2026-09-04: a commit landed on `master` touching exactly two files that no
pending branch touched — genuinely orthogonal **by content**. It was not
orthogonal **by base**: it staled the base of *both* branches in a merge order
that was still being negotiated, and forced a re-rebase in a required sequence
(theirs, then mine) to avoid replaying one lane's commits under the other's
shas.

A diff can prove file-level independence. **Nothing can tell you what is
pending except knowing what is pending.** So before pushing to a shared branch,
ask who is mid-merge — and remember that **being authorised to push is not the
same as it being the right moment**.

---

**10. A MESSAGE THAT FAILS TO SEND LEAVES NO TRACE ON THE RECEIVING END.** When
your send fails, the recipient does not know you tried. They see silence
identical to your never having written.

This asymmetry is the entire argument for putting anything load-bearing in a
**file in their tree** rather than a message: a commit is durable, addressable,
and does not depend on a channel working in the direction you assumed. On
2026-09-04 a lane that could not be reached by five separate attempts was
finally warned by a commit to `LANES.md` in its own repository.

And when relaying something you have not checked, **mark it unverified**.
Passing on a second-hand report as fact makes you the next link in a chain
nobody has confirmed — which is exactly how a phantom "40,584 deletions"
(rule 6) nearly travelled to three sessions.

**AMENDED 2026-09-05: A FAILED-SEND REPORT CAN BE A FALSE NEGATIVE.** A send
to lego-ac returned `Failed to send to lego-ac` -- an explicit failure, not a
timeout -- and the message had already arrived. Retrying on the strength of
the rule above then delivered it twice. So the report is evidence the message
MAY not have arrived, not that it did not, and the two failure modes need
different handling:

- treat the peer as possibly uninformed, so retry rather than assume silence
- but SAY IT IS A RETRY in the first line, because the cost of a duplicate is
  paid by the reader, and one sentence turns "read this whole thing again to
  find out if it is new" into a glance

**MECHANISM FOUND, later the same day, and it makes the retry advice WORSE
than useless in one common case.** A `Failed to send to X` is what this tool
reports when the message was actually **HELD FOR THE RECIPIENT USER'S
APPROVAL**. It is not a failure at all; it is a queue. Three sends to the
kerotakis sessions reported failure, and the delivery notices then arrived:

```
  held for the recipient user's approval ... not delivered yet
  approved and released to that session
```

So the first copy was never lost, and the retry did not recover a dropped
message -- **it added a second copy to a queue that already held the first.**
Retrying on a failure report does not merely RISK duplication when the peer's
user gates inbound messages: it GUARANTEES it. I did this to kerotakis-59
within ten minutes of writing the paragraph above.

**The corrected rule:**

- A `Failed to send` means UNKNOWN, and the most likely cause is a held
  message rather than a lost one. Say the thing once.
- Do not retry on that report alone. Wait for a delivery notice, which does
  arrive and does distinguish held / approved / released.
- If you retry anyway -- because the content is time-critical and a duplicate
  is cheaper than silence -- label it, and say plainly that it may be a
  duplicate rather than a correction. Mine said "discard if you already have
  it", which is the only reason the duplicate cost the reader one line.
- NEVER escalate to a third channel on two failure reports. I relayed a
  decline through a sibling session on the strength of two "failures", both of
  which had already been delivered; that relay is now a third copy of a message
  its recipient did not need.

The underlying error is the day's error at one more remove: trusting a report
ABOUT the send instead of the send. Here the report was not merely unreliable,
it was WRONG IN A SPECIFIC DIRECTION -- it named as failure the one outcome
that most needed patience -- and acting on it produced exactly the harm the
first version of this rule was written to avoid.

**11. THE MACHINE LAYER IS VENDORED INTO `brickwright-lite` AND ALL THREE FILES
ARE DIVERGED IN BOTH DIRECTIONS.** Your change here does not reach lite, and
lite has changes that do not reach here.

Measured 2026-09-05 against `ec1272a`, versus
`lite/overlay/scratch-gui/src/lib/bw-board/`:

```
                      lite AHEAD    lite BEHIND
i8086-machine.js         171            59
z80-machine.js            88            33
m6502-machine.js          75            28
```

With `CircuitDesigner.jsx` (19 ahead / 46 behind, found by lego-be) that is
**four files**, three of them the machine layer. The general form, theirs:

> A vendored file that is BEHIND is an inconvenience. One that is AHEAD is a
> fork nobody declared. One that is **both** cannot be resolved by any tool,
> because no tool can know which of two changes was intended.

**The corollary the count adds: this is not an accident that happened twice.
With four, it is the steady state of any vendored directory both sides edit.**

**The AHEAD content is a subsystem, not drift.** Lite has an entire
`machine-checkpoint.js` — `MACHINE_CHECKPOINT_SCHEMA`, `checkpointSupport`,
`checkpointTopology`, `checkpointRefusal`, `validateCheckpointEnvelope` — wired
into `z80-machine.js` and `m6502-machine.js`, and absent from bw-board
entirely. A sync from here **deletes a whole feature and nothing fails**: the
machines construct, checkpointing just stops existing. Same shape as lite's
`displayRevision` repaint optimisation.

**So: do not sync either direction wholesale.** `sync-bw-board` already refuses
on a stale checkout, and `--check` reports differing files while stating it
cannot tell direction. Both correct, neither sufficient. Graft your own hunks
by hand and verify the other side's survive.

**AND ONE HAZARD THAT IS SPECIFIC AND SILENT.** The `_advanceChips` schedule
cache is two pieces that must travel together:

1. `this._advList = null` in the constructor, `_buildAdvanceList()`, the flat
   loop — the visible part, and the reason anyone would port it;
2. `this._advList = null` in **`attachDevice`** — one line, easy to miss.

Port (1) without (2) and any device attached after the first `step()` silently
never ticks: no exception, no wrong value, nothing red. **Lite has no
`machine-contract` test**, so the guard that catches this
("a device attached AFTER stepping still gets advanced", asserted for all three
machines and verified by deleting the invalidation until all three go red)
does not exist in the repo where such a graft would happen. Port the test with
the cache, or do not port the cache — lite's machines are correct as they are.

**12. `cmd | grep` REPORTS GREP'S STATUS, SO `&& git commit` COMMITS ON A RED
SUITE.** This is a shell mechanism, not a lapse in attention.

Every test run in this repo gets filtered — `node --test test/ | grep -E "^# (pass|fail)"`
— because the raw TAP output is thousands of lines. A pipeline's exit status is
its **last** command's, so the chain gates on whether *grep matched*, never on
whether the *tests passed*:

```
  (echo "# pass 5"; exit 1) | grep -E "^# pass"          -> exit 0
  set -o pipefail; same                                   -> exit 1
```

The left side failed. Without `pipefail` the chain proceeds and commits.

**Written as a rule about shell rather than about care, because the discipline
version demonstrably does not work.** It is in this file already as "a failed
patch step does not stop a commit unless you chain it" (rule 3's neighbour),
and the author of that line then pushed a red test twice in the same day. Two
sessions hit it today; one caught it once. When a rule has been written twice
and violated twice by the person who wrote it, the fault is in the mechanism.

**The fixes, cheapest first:**

- `set -o pipefail` at the top of any command that chains on a filtered result.
- Or drop the pipe when the result gates something: run the suite unfiltered
  into a file, `grep` the file for display, and chain on the run's own status.
- Or simply do not chain. Run the gate, LOOK at it, then commit as a separate
  command — which is what "verify, then act" means when the verification is
  a program rather than a claim.

**The tell, when it has already happened:** a red line scrolled above a
successful push in the same output block. If a commit and a test result appear
in one command's output, the commit did not depend on the test.

**13. A VERIFICATION MEASURES SOMETHING ADJACENT TO THE QUESTION UNLESS YOU
SAY WHICH THING IT MEASURES.** Three times on 2026-09-05, across two sessions,
a check was run whose number was real, honestly obtained, and about something
next to what was being asked:

```
  question                        what got measured            verdict
  does the core double-fetch?     busTrace entries             "no"      WRONG
  do jobs cluster at the cap?     run duration                 "no"      WRONG
  does the vendor gate hold?      the INCOMING file            "yes"     WRONG
```

Every one of these passed its own local checks. The method was sound, the
tool worked, the output was accurate. The error is entirely in the gap between
the quantity and the question, and **that gap is invisible from inside the
check** — nothing about counting trace entries announces that the bus is a
different thing from the trace.

**The prefix case is the clean specimen.** `busTrace` is a MODEL of the bus;
`read()` is the bus. A bare `this.read()` pushes no trace entry, so the peek
was silent in the trace BY CONSTRUCTION. Verifying the fix through the trace
could not have failed, whatever the code did. The verification was not weak,
it was structurally incapable of detecting the defect — and it was written by
the same commit that introduced it, which is how it crossed a pin before a
downstream test caught it.

**The rule:** before a check counts as verification, state the substitution
out loud — "I am measuring X to answer about Y" — and then ask what would make
X and Y disagree. If X is a model, a proxy, a log, a cache, or a summary of Y,
measure Y. If you cannot measure Y, say the result is about X.

**The tell:** you are about to report a NEGATIVE result ("no duplicate", "no
clustering", "no leak") from an instrument built by the same work that would
have caused the positive. A negative from a proxy is the weakest evidence
there is, and it is the one we keep believing.

**THE SAME RULE WITH THE SAMPLE IN PLACE OF THE INSTRUMENT**, added
2026-09-05 after two more instances in one hour. A check cannot contradict you
when you chose what it looks at:

```
  general claim written              what it was checked against       verdict
  "EOT=18, 360K unaffected"          47 tests I picked myself          WRONG
  "failures have an ODD start"       only the cases that failed        WRONG
```

The first: 47 disk tests passed, so the claim went into the ROM and the
roadmap. The full suite failed three, and they were the tests that PIN the
behaviour being changed -- `test/bios-fdc.test.mjs:245` requires the head
switch at EOT=9 on a 9-sector medium. A subset chosen by the person changing
the behaviour is selected, however honestly, for not containing the objection.

The second: every failing read had an odd start sector (s9, s11, s13, s15,
s17), so "odd" went in as the predicate. s1, s3, s5 and s7 are odd too and
read correctly -- the predicate was "reaches sector 9", the declared EOT. A
pattern read off the failures alone has nothing to disagree with it.

**Both fixes are the same move:** run the cases that could refute you before
writing the general claim -- the tests that pin the behaviour you are
changing, and the cases that PASSED. If you cannot name what would have
falsified the sentence, it is not a finding yet.

**WHAT NAMING A FAILURE MODE ACTUALLY BUYS YOU**, added 2026-09-08 after
committing this one four times in a single file, twice AFTER writing it down:
naming a failure mode buys the ability to CATCH it, not to avoid it
(lego-ac's phrasing). All four were caught, and two of them by the run's own
output contradicting itself — which is only possible because the evidence was
printed beside the conclusion. Print the measurement next to the sentence it
supports, and a wrong sentence has something to disagree with.

**Corollary for tests:** a test guarding a proxy-invisible property must not
use the proxy. `test/i8086-prefix-fetch.test.mjs` deliberately does not look
at `busTrace` and counts `read()` invocations instead, and its injection reach
was verified by running it against the unfixed core (3 of 4 fail, with the
addresses printed) rather than assumed from its passing.

**14. A PEER MUST NOT SUPPLY A USER TURN IN SOMEONE ELSE'S SESSION, AND NO
AUTHORISATION CAN MAKE THAT WORK.** On 2026-09-07 lego-ac could see an owner
instruction typed but never submitted in lego-a4's input box, held an explicit
owner authorisation — given in lego-ac's OWN session — to press Enter on such
pending lines, and did. It did not arrive; lego-a4 held and did not start the
work. Both sessions then agreed the mechanism was wrong independently of
whether it worked.

**Why it is wrong even when the peer is right about what the owner wants.** A
user turn is the one signal a session cannot obtain from outside itself, and
that is its entire value. Manufacture it and the receiving session gets
something INDISTINGUISHABLE from its owner typing — so it cannot tell an
authorised affirmation from an invented instruction, and neither can the owner
reading the transcript back later. The boundary is not a lock to be opened by
someone with the key; it is a property of where the message came from, and a
mechanism that satisfies it from outside destroys the thing it is respecting.

**An authorisation is scoped to the session it was given in.** lego-ac's
permission was real. It made them free to act in their own lane; it could not
make them a channel for another user's intent in another lane. This is rule 8
("publishing to master is the OWNER'S call") one level down: there, a peer
cannot consent on the owner's behalf; here, a peer cannot SPEAK on it.

**What to do instead, which costs one sentence:** tell the owner the
instruction is typed and unsubmitted, and let them send it. Both sessions
reported exactly that and the line was unblocked without anyone pretending to
be anyone.

**The part worth copying is what lego-ac did after:** they said plainly what
they had done, rather than letting a mysterious instruction appear. A peer who
reaches into your session and TELLS you leaves you able to refuse. That is the
difference between an error and a trap, and it is why this rule is written
without blame attached to it.

**15. A STEADY-STATE INVARIANT IS SILENTLY FALSE AT INITIALISATION.** Found
2026-09-08 in brickwright-lite's stage container, and it is the reason I argued
twice against the fix that turned out to be the fix.

The measurement was correct: the Scratch stage's size is a pure function of two
props the component's `shouldComponentUpdate` gates on, so **every size change
already reaches the resize path** and an observer would guard a case that
cannot occur. A pane resize confirmed it — the stage moved sideways, x 1285 to
846, and kept its 240x180.

**All true, of every change AFTER the stage has a size. False of the first
one.** The 0 -> 480 transition is driven by no gated prop, so nothing in the
update path can see it, and that transition is the entire defect.

```
  the rule            "every size change comes through a gated prop"
  where it holds      once the component is in its working state
  where it fails      the transition INTO that state
  what it cost        two wrong fixes and two arguments against the right one
```

**The general shape: the code that ESTABLISHES a state is exactly the code the
state's invariants cannot describe.** An invariant is a statement about a
system that is already running. Initialisation is the interval in which it is
not yet true, and reasoning that treats the two as one place will be confidently
wrong about the interval — while being right about everything else, which is
what makes it persuasive.

**The tell:** an argument of the form "X always happens, therefore we need not
handle the case where it has not happened yet". The second clause is about a
time the first clause does not cover.

**And the fixes fail the same way.** Sizing the buffer at mount was a no-op
because at mount the container has no box — a repair that looks EXACTLY like
the bug it is meant to fix, and would have shipped as done by anyone who did
not measure afterwards.

**WHAT SETTLED IT WAS AN EXPERIMENT, NOT AN ARGUMENT** — lego-ac's, who asked
for the measurement rather than accepting my reasoning, and who says they would
not have predicted the answer either. That is the method: when two people
reason to opposite conclusions from the same correct measurement, the
disagreement is about which regime the rule covers, and only a run tells you.

## OPERATIONAL — archiving to /mnt/storage, 2026-09-05

**THE CIFS SHARE CANNOT STORE SYMLINKS, AND A PLAIN COPY DROPS THEM SILENTLY.**

`/mnt/storage` is a symlink to `/mnt/akademie_storage`: one CIFS share, 5 TB,
mounted `nounix` **without `mfsymlinks`**. Creating a symlink there fails:

```
ln -s /tmp /mnt/storage/probe
  -> ln: failed to create symbolic link: Input/output error
```

So `cp -a` of a tree containing symlinks **succeeds overall** while omitting
every link, and reports only a line per failure in stderr that is easy to lose
in a long run. Measured:

```
mbit-fw-src            117 symlinks   bytes DIFFER after copy
mbit-fw-build          175
bw-bundle              171
wt-spike-fw-firmware    10
brickwright-sdcc-o2      1
bw-pages, sdcc-git       0            bytes MATCH — safe to copy plainly
```

**This is not cosmetic.** The lost links in `mbit-fw-src` and
`wt-spike-fw-firmware` include `nuttx/include/arch` and `nuttx/Make.defs` —
load-bearing build symlinks. The archive looked successful; the restored tree
would not build, and nobody would find out until they tried.

**So: choose the method by whether the tree contains symlinks.**

```
find TREE -type l | wc -l
  > 0   ->  tar -czf on CIFS, symlink the original path at the .tgz
  = 0   ->  rsync -a to CIFS, symlink the original path at the directory
```

**And verify BYTES, not file counts, before deleting anything.** `mbit-fw-src`
copied 79,114 files against 79,114 in the source — a perfect count match — and
was still wrong by two symlinks. The byte total is what caught it.

**Two more things that bit during this cleanup:**

- **Check `lsof` at the moment you act, not when you plan.** `crisp-flutter-sdk`
  showed 0 open handles in the survey and 25 when the copy reached it, and was
  skipped automatically. `clean-checkout-1XQqF8` had 14 handles despite being
  the same age as five idle siblings that were safe to delete — age alone would
  have destroyed a live tree under another session.
- **mtime recency misreads a fresh clone as hot.** `retro-corpus-8086` reported
  1,348 files modified in 7 days; it was cloned on the 3rd, so *every* file is
  recent. Cloning is not editing.

## OPERATIONAL — the box, 2026-09-05

**Written here because cross-session sends are FAILING.** Three warnings to
three lanes were refused within a minute of each other, after hours of working
sends. A failed send leaves no trace on the receiving end (rule 10), so this is
the channel that still works.

**Measured 11:27, nine sessions busy at once:**

```
load average    71.72          (18 an hour earlier)
memory          172 MB free, 646 MB available
swap            12,285 of 12,287 MB used  ->  2 MB FREE
disk /          97%, 2.4 GB free
node processes  16
```

**Swap is exhausted.** At 2 MB the next sizeable allocation OOM-kills
something, and not necessarily the process that asked for it.

**Hold, until this clears:** a full `npm test`, the 646,000-vector grind, and
`audit-clean-checkout --all` — the last archives the whole tree per invocation,
and `--integrate` adds a populate step on top of that. Single test files are
fine. `free -m` before anything expensive; abort below ~600 MB available, which
is roughly where we are now.

**AND IF YOU SEE THESE FOUR FAILURES, THEY ARE THE BOX, NOT YOUR CHANGE:**

```
Digital parity: 74LS157   74LS107   74HC138   74HC283
```

`test/sap1-digital-parity.test.mjs` says so in its own assertion, and it is the
best-behaved failure message in this repository:

> *"74157: ENVIRONMENT, NOT THE CIRCUIT — the Digital JVM was killed after
> 120s. A bare invocation on this box takes about 5s, so a failure at the cap
> means the machine was loaded, not that the truth table disagreed. Check
> `free -m` AND `swapon --show` before chasing this, and re-run the file
> alone."*

It names its likeliest cause **without asserting it**, gives the discriminator
(5 s against a 120 s cap), and says what evidence settles it. Checked: it was
right. Do not chase them.

**Combined master at `d95d597` is otherwise green:** 3,846 tests, 3,796 pass,
46 skipped, 4 environment-limited. That is the whole fleet's work today — the
8086 REP cycle fix, the census derivation guard, the NE2000 and port-conflict
check, the WAIT/STP tests and the two new census rows — verified together
rather than each against the master it branched from.

## CLAIMS — work in progress

| lane | who | started | what |
| --- | --- | --- | --- |
| wired-286-dma-registers | Codex | 2026-09-09 | Channel-2 physical register bridge; refuse transfer requests until HOLD/HLDA exists. No app pins/defaults/deploy/media. |

## DONE

286 FDC control/IRQ6 bridge: source `6b18924` on `feat/x86-backend-lab`,
2026-09-09. Explicit optional DOR/MSR/FIFO byte-lane wiring and FDC IRQ6 net
to PIC; private unchanged UPD765 core admits only control commands. Data/DMA/
PIO commands refuse before core admission, no media API or transfer callback.
Owned guest programs PIC, pulses DOR, receives vector 0Eh via two physical
INTA pulses, sends EOI/IRET, drains four reset replies into wired RAM, then
SPECIFY/HLT. Tests cover gates, port conflicts, control replies, reset, READY,
missing wires and refusal boundaries. Ten FDC tests plus one probe CLI test;
targeted suite including unchanged FDC core 431/431 pass, zero skips. Optional
--fdc-mode control probe metadata/provenance added; default none. No new long
POST run or DOS boot claim. Next: wired DMA channel 2, bus ownership and TC,
owned sector transfers before admitting data commands; larger normal POST
probe separately. Details HARRIS-286-FDC.md. CPU/SST hashes unchanged; no new
full vectors/CI/browser, app pins/defaults, merge/deploy or media. Claim released.

286 static net-layout resolver: source `e6fbc0d`, extended probe receipt/docs
`aa95abe`, on `feat/x86-backend-lab`, 2026-09-08. Precompute fixed membership,
canonical roots and driver order; still resolve every current level and settle
normally. Three differential tests; targeted suite 371/371 pass, zero skips.
Pinned synthetic benchmark measures 3.0–5.9x resolver-only improvement, not
overall emulator/RT speed. New configured 64 KiB/110,000-clock probe matches
old 48k/50k/64k checkpoints and ends at F000:0453, 7,511 retired, still banner
dispatch. Budget-exhausted/accepted:false, no next fault or POST/DOS completion.
Historical receipts preserved. Next functional task: FDC control-port/IRQ6
bridge and owned microguest tests, then larger normal POST probe; reject data
transfers until physical DMA exists. CPU/SST hashes unchanged. No new full
vector run, full CI/browser, app defaults/pins, merge/deploy or media hosting.
Claim released.

286 net-read optimization / longer POST diagnostic: source `c658507` on
`feat/x86-backend-lab`, 2026-09-08. Internal scalar reads avoid defensive
diagnostic copies; inspection, net resolution and physical bus behavior stay
unchanged. Three differential tests plus broader regression: 368/368 pass,
zero skips. Probe provenance now includes digital-circuit.js. Original-code
64 KiB/65,000-clock run passes screen clear into banner handling, ending at
F000:0447 with 3,293 retired, budget-exhausted/accepted:false. Historical source
hashes and new receipt preserved in HARRIS-286-BIOS-BANNER-REPORT.json. No next
peripheral fault, complete POST, DOS boot or end-to-end speedup claimed. Next:
larger normal POST budget, then physical FDC reset/IRQ6 and DMA acceptance gates
documented in HARRIS-286-BIOS-POST.md. CPU/SST hashes unchanged. No new full
vector run, full CI/browser, app pins/defaults, merge/deploy or media hosting.
Claim released.

286 BIOS POST configuration: source `de39245` on `feat/x86-backend-lab`,
2026-09-08. Full 640 KiB baseline reaches actual PIC ICW4=09h refusal at
F000:00F9 after 13,543 completed clocks/1,516 retired. Explicit source-level
single-unbuffered BIOS build changes only the ICW4 byte; original default ROM
remains hash-identical and PIC guards unchanged. Configured 640 KiB probe
initializes PIC/timer, reaches text-memory REP clear, exhausts 20,000 clocks
with 1,763 retired; accepted:false, no POST/DOS completion or next-fault claim.
Reusable bounded CLI, profile/provenance tests and two-run hashed receipt in
docs/HARRIS-286-BIOS-POST*. Five new tests; suite including existing BIOS ROM/
floppy tests 345/345 pass, no skips. CPU/SST hashes unchanged; no new full-vector
run, full CI/browser, app pins, default changes, merge/deploy or media hosting.
Claim released; continue configured POST toward disk/peripheral prerequisites.

286 conventional/text memory map: source `b301310` on `feat/x86-backend-lab`,
2026-09-08. Explicit 64–640 KiB conventional RAM and optional B8000h text RAM
use additional registered chip pairs/full latched-address decoders. Defaults
and saved recipe remain 64 KiB. Ten new tests cover chip isolation, boundaries,
READY/partial faults, holes and owned code relocation/far call at 9000:0200
with an upper-memory stack and text-memory write. Targeted run 274/274, no skips.
Unmodified BIOS probe: 6,000 clocks/747 retired, budget exhausted in IVT setup
at F000:0073, zero PIC writes; accepted:false, no POST/DOS boot claim.
CPU/SST hashes unchanged; no new full-vector run, full CI/browser, app pins,
merge/deploy or media hosting. Claim released; longer BIOS probe/peripheral
gates in docs/HARRIS-286-MEMORY-MAP.md. BIOS ICW4=09h mismatch is source-audited,
not yet the observed runtime stop; PPI/video/FDC/DMA wiring remains pending.

286 wired programmable timer: source `1d9ab7c` on `feat/x86-backend-lab`,
2026-09-08. Default-off counter-0 binary modes 0/2/even-3 subset with independent
ideal divider, resolved CLK/GATE/OUT0-to-PIC-IR0 and port/lane wiring. Separate
pin-clocked counter preserves visible pulses; production I8254 unchanged.
Sixteen owned tests cover waveform/count/load/latch/gate/guards and actual
guest periodic IRQ0/EOI/IRET/HLT, READY stalls, mask/unmask and disconnected nets.
Targeted suite including production PIC/PIT tests: 264/264 pass, zero skips.
CPU/SST adapter/runner hashes unchanged from SST286-INTR-REPORT.json; no new
full-vector run, hardware oracle, full CI/browser or wired DOS boot claim.
No app pin/default changes, merge/deploy or media hosting. Claim released;
storage/BIOS/memory-map boot prerequisites next in docs/HARRIS-286-TIMER.md.

286 wired programmable PIC: source `25d39dd` on `feat/x86-backend-lab`,
2026-09-08. Explicit I/O/controller gate and PIC+decoder/byte-lane adapter
reuse the existing unchanged I8259 core. Guest IN/OUT initialization, masks,
ISR/IRR, paired INTA vectors, HLT/IRET and EOI; fixed-priority single edge-mode
subset only. Cascade, auto-EOI, level/rotation/special modes explicitly refused.
Fifteen new owned tests; targeted run including PIC core tests 218/218, no skips.
CPU/SST adapter/runner hashes unchanged from SST286-INTR-REPORT.json; prior
1,477,997-pass receipt retained, no new full-vector run or hardware oracle claim.
No app pin/default changes, full CI/browser, merge/deploy or media hosting.
Claim released; timer/IRQ0 guest gate next in docs/HARRIS-286-PIC.md.

286 wired INTR integration: source `14549f0` on `feat/x86-backend-lab`,
2026-09-08. Opt-in controller INTA outputs and independent READY gate connect
the CPU's paired acknowledgement to an external part/vector-net connector.
IF/STI/SS blocking, qualified level requests, NMI priority, HLT wake, IRET and
REP restart tested with an independent lab peer (not a programmed PIC).
Twelve new tests; final targeted run 176/176, no skips. Fresh full pinned SST286
1,477,997 pass, 3 revoked, zero fail/unsupported/budget, exit 0; hashed receipt
SST286-INTR-REPORT.json. SST is not an asynchronous/bus oracle. PIC ports,
timer, cascade, timing/protection and actual wired DOS boot remain pending.
No app pin/default changes, full CI/browser, merge/deploy or media hosting.
Claim released; next programmable PIC/port gate in docs/HARRIS-286-INTR.md.

286 INTA sequencer foundation: source `5bfe02e` on `feat/x86-backend-lab`,
2026-09-08. Bus-only `intrEnabled:true` enables a paired INTA transaction and
resolved INTR-level observation, not CPU interrupt selection. Five new net-peer
tests verify ignored first data, second-byte vector, six-system-clock gap,
address/BHE release, LOCK, external wait enforcement and RESET cancellation.
Final targeted regressions 164/164, zero skips. CPU/adapter/runner hashes still
match the previous 1,477,997-pass SST286 receipt; no new full-vector run claimed.
Controller/PIC wiring and CPU IF/shadow/priority/HLT/REP integration remain
pending; memory-board INTR remains refused. No app pins/defaults, full CI/browser,
merge/deploy or media changes. Claim released; next gates in HARRIS-286-INTA.md.

286 NMI foundation: source `bbf7cdd` on `feat/x86-backend-lab`, 2026-09-08.
Explicit `nmiEnabled:true` board option samples resolved NMI, qualifies edges,
delivers wired vector 2, supports HLT wake, SS shadow, IRET blocking/coalescing
and REP element-boundary restart. Thirteen new tests; final targeted run
159/159, no skips. Full pinned SST286 remains 1,477,997 pass, 3 revoked,
zero fail/unsupported/budget, exit 0; hashed receipt SST286-NMI-REPORT.json.
SST supplies no NMI inputs: asynchronous evidence is owned wired tests plus
cited manuals, not silicon timing. INTR/INTA, controller, debug/trap priority,
full reset/halt/shutdown and protected mode remain gates. No application
pin/default changes, full CI/browser, merge/deploy or media hosting. Claim
released; next INTR acknowledgement gate in docs/HARRIS-286-NMI.md.

286 system-state prerequisites: source `c38e0d6` on `feat/x86-backend-lab`,
2026-09-08. Real-mode LGDT/LIDT/SGDT/SIDT/SMSW/LMSW(non-PE)/CLTS, protected-only
real-mode faults, IDTR-based INT/IRET and debugger register inspection. Twelve
new owned tests; final targeted run 146/146, no skips. Full pinned SST286 rerun
1,477,997 pass, 3 upstream revoked, zero fail/unsupported/budget, exit 0;
new hashed receipt in `docs/SST286-SYSTEM-STATE-REPORT.json`. System forms lack
SST silicon vectors: cited Intel manual + owned wired/semantic tests only.
PE=1, nested-fault delivery failure, LOADALL and external INTR/NMI stay explicit
limitations. Default-off, no app pins, full CI/browser, merge/deploy or media
hosting changes. Claim released; next gates in HARRIS-286-SYSTEM-STATE.md.

286 real-mode expansion: source `aff6a67` on `feat/x86-backend-lab`, 2026-09-08.
All 326 pinned SST286 files selected: 1,477,997 executed/pass, 3 upstream
revocations, zero fail/unsupported/budget, exit 0; hashed per-file receipt in
`docs/SST286-REAL-MODE-REPORT.json`. Local targeted regression 134/134, no skips,
including wired fault/INT/REP/READY tests, Paterson on 8086/80186/wired 286 and
DOS file persistence on 8086/80186. Semantic vector coverage is not physical
bus/timing or full 80286 acceptance; protected mode, external interrupts,
system instructions outside the suite, devices and wired DOS boot remain.
LOCK bypass and inactive-coprocessor profile are explicit test conditions,
not physical protocol support. Default-off; application pins unchanged; no
full CI/browser acceptance, merge, deployment or new media hosting. Claim
released at this incremental handoff; remaining gates in SST286-RUNNER.md.

286 vectors/private media increment: engine `7b7f92f`, paired Lite docs `15be58905`. Pinned SST286 inventory traversed all 326 files / 1,478,000 vectors: 675,501 matched, 802,496 unsupported (42,341 exception/interrupt cases refused before execution), three revoked, no completed-state mismatches or budget exhaustion; exit 1, NOT full acceptance. Test-only 16 MiB semantic memory drives unchanged boot decoder; no physical-board/timing/protected-mode claim. Added external-only reviewed/hash-checked private media admission, no game downloads/uploads or private repository creation. Fourteen new harness tests and 30 existing Paterson/prerequisite tests passed locally (42 combined before two additional parser/CLI tests, final 14 harness tests green). No app runtime/vendor/production pin change, merge/deploy or full hosted CI. Claim released at incremental handoff; CPU expansion and guest milestones remain pending.

Paterson guest increment: source `f2eeb5964bc1285a6c8f3b1c297d2998833cc56f`, paired Lite `9b5ea89dc55ea0e987591c3db4b6d4d2cf3c7745`. Preserved MIT original/adapted FAT12 routines pass on 8086/80186/wired 286 subset; byte/stack/segment/ALU prerequisites remain experimental. Real DOS shell disk persistence passes on 8086/80186. 71 targeted engine tests passed locally, no skips; Lite preservation/runtime and isolated browser passed. No full 80286 vector run, general 286, accepted ELKS/MINIX boot, games import, DOSBox package support, production pin change, merge or deployment. The five requested milestones remain open in the plans; this bounded implementation/research increment is handed off, claim released.

286 saved profile/debugger session: source `14f2538` on `feat/x86-backend-lab`; strict JSON construction recipe for the fixed latched-memory profile, editable saved wires, fresh-state reload, bank/net inspection, bounded clock/instruction stepping and 24-bit physical code breakpoints. Unsupported parts/backends/live snapshot and mutation operations fail explicitly. 10 new tests; final targeted run 117/117, four suites, no skips. Engine-only, default-off; no full Boundary-D registration, application controls, production defaults/pins, merge or deployment. Full CI/browser/hardware not run. Claim released; application import/export and debugger controls remain next.

286 addressing and loops: source `bf83dac` on `feat/x86-backend-lab`; word ModR/M MOV/ADD/CMP in both directions, register INC/DEC, JE/JNE/JMP/LOOP. Owned ROM fills/sums wired RAM and checks the result in guest code (47 instructions, sum 10; deliberate failure branch also verified). 13 new tests include all 256 ModR/M decoder encodings as a unit check, representative wired accesses and delayed RMW flags/retirement. Final targeted run 107/107, no skips; loop demo passed. Still no general 286, timing/prefetch/protection or editor integration; no production defaults/pins/deployment. Full CI/hardware/browser not run. Claim released; saved circuit/debugger integration remains planned.

286 boot instruction subset: source `8e9d684` on `feat/x86-backend-lab`; generator-resumable real-mode subset fetches owned reset/program ROM through the latched board, retires ten instructions and writes `0x68ac` to wired RAM, then halts. Low ROM alias is explicit board decode, default-off. Assembly sources reproduce ROM bytes; shared-subset results agree with separate 8086 decoder. 15 new tests; final targeted run 94/94, zero skips; demo `cpuExecuted:true`. Still no general 286, prefetch/instruction timing/protection/interrupts, physical HLT signalling, snapshots or editor component. Full CI/hardware/browser not run; no production promotion or deployment. Claim released; broader CPU and Circuit Editor integration remain planned.

286 latched memory bridge: source `5e5c71a` on `feat/x86-backend-lab`; external phase controller and address/control latch feed existing 62256/28C256 update models through an ideal-digital adapter. Write storage changes on command trailing edges, not CPU callbacks; late-bank preflight is staged before commit. 16 new integration tests; final targeted run 79/79, no skips; demo verifies `0x68ac`, zero/one writes before/after edge, `cpuExecuted:false`. No full 82C288, analog solver, instruction CPU, editor integration, production defaults/pin changes, merge or deployment. Full CI/browser/hardware traces not run. Claim released; resumable instruction subset is the next execution gate.

286 bus contract and phase sequencer: source `610a1e3` on `feat/x86-backend-lab`; pinned Harris August 1996 PDF checksum, PLCC/status/lane metadata, reset qualification, active-low READY, waits, split words and write-data hold. 22 new tests; final targeted foundation/electrical memory/8086 machine run 63/63, zero skips. Owned ROM fetch through nets checked without executing instructions. Explicitly non-pipelined system-clock phases, not edge-accurate timing or an instruction CPU; no controller/editor/pin promotion. Full CI/hardware traces/browser not run. Claim released at this incremental handoff; next gates in `docs/HARRIS-80C286-BUS-CONTRACT.md`.

286 circuit foundation: initial partial-M1 milestone at `90467ee` on `feat/x86-backend-lab`. Default-off ideal digital nets and synthetic wired ROM/RAM master, 20 new tests passing; targeted run including electrical memory, 8086 extractor and machine passed 56/56, no skips. Demo verifies wired result with `cpuExecuted:false`; no claim of 286 CPU, pin timing or editor integration. No production exports/defaults or consuming pin changes. Full CI not run for this milestone. Claim released; M0 sign-off, remaining M1 and actual CPU implementation remain planned.

8086 PIT follow-up: engine half complete at `dedfbc8`, full CI `34249782632` green (units, vectors, full vectors, 80186 vectors, corpus). Added callback-time CPU/PIT clock and counter-method observability assertions. No engine runtime changes. Paired Lite branch retains correct candidates default-off and removes the stale-state scheduler implementation; measurements/retention policy live there. Claim released; feature branch only.

8086 device advancement: complete on `perf/i8086-device-advance`, source/test commit `4f72ff4`. Full CI `34246446550` green (units, vectors, full vectors, 80186 vectors, corpus). Added the instruction-boundary observability contract and differential/negative fixtures. Paired Lite experiments reject all four measured device candidates; no production source changes or general deferred scheduling. Feature-branch handoff only, not merged. Claim released.

8086 promotion and sandbox: complete; reconciled engine `4c6ab1a7289db121284a2c0e98435598bd3ef24c` retains tone and W65C51 master changes alongside verified prefix/REP/PIT/RAM optimizations. Full engine CI `34235227257` green; consuming Lite build/corpus/both browser suites `34237479071` green, including isolated GUI comparisons and diagnostic reference-word access. This ledger-only handoff accompanies fast-forward promotion to master; source pin remains the verified runtime commit. Claim released.

8086 fastpaths phase 2: complete on `fable/i8086-fastpaths`, engine `6b7761d210698c8f392e28ce85d02c5d94ee676f`. Dedicated REP MOVS/STOS, guarded RAM words (`fastWords: false` reference option), and unit-correct PIT deadlines integrated into Lite feature branch `perf/i8086-execution` at `911d09104`. Upstream CI `34219643631` passed units, all 646,000 8086 vectors, 80186/V20 and 525-program corpus. Lite experiment log records Chromium acceptance and rejected debugger/batching/decoded/Wasm prototypes; those prototypes are not production paths. No default-branch changes or deployment; claim released.

| lane | who | landed | sha |
| --- | --- | --- | --- |
| rp2040 adapter: `bootFromFlash(image)` entry point (`src/rp2040js-adapter.js` + test) | `8086 coverage testing materials` (lego-ac's N3b) | 2026-09-05 | On `master` at **`ff744c5`**. Encapsulates lite's hand-rolled Pico boot — set `rp2040.flash`, `PC = 0x10000000` — as one adapter call: places a flat flash image at `FLASH_BASE` and enters stage 2 there with `BOOT_SP`, so boot2 runs first and a real image relocates VTOR to `RAM_START` itself. The full VTOR-relocation is proven end to end by lite's `probe-pico-micropython` (re-run both directions in the bootrom review above); the unit test proves the adapter's half — a two-instruction stage-2 stub runs from `0x10000000` (`r0 = 0x20<<24`), which `loadProgram`'s SRAM entry cannot produce. `FLASH_BASE`/`BOOT_SP` exported. lego-ac pins past this in one bump (N3a). |
| rp2040 bootrom: flash ROM functions (`src/rp2040-bootrom.js` + 4 tests) | lego-ac (author); independently reviewed + merged by `8086 coverage testing materials` | 2026-09-05 | Merged to `master` at **`be02550`** (rebased clean onto `be0e881`, 15/15 on the new base). **Reviewed the fleet way — re-ran the oracle, both directions, rather than reading the 15/15.** The oracle is lite's `scripts/probe-pico-micropython.mjs --repl` (pinned MicroPython v1.22.2 UF2, booted in rp2040js against the integrated tree). With the PATCHED bootrom overlaid, MicroPython boots to REPL and `os.statvfs("/")` returns **`4096 352 ok`** — a file written and read back. With the ORIGINAL bootrom restored, same boot, filesystem **`OSError [Errno 19] ENODEV`**. Both boot `print(1+1)`→2; the sole difference is the flash filesystem, which is exactly what the six ROM functions enable. That end-to-end run also exercises the Thumb encodings behaviourally (MicroPython erases/programs flash through them), so a wrong encoding would have failed the write. Lite consumes by pin bump (its task N3a). |
| opcode-coverage — the grind's complement, across two cores | this session (`8086 coverage testing materials`) | 2026-09-05 | On `master`: **`1a74a6f`** WAIT (9B) + **`6711702`** POP CS (0F) — the two opcodes the SingleStepTests 8086 suite omits wholesale, each pinned with an evidence-tier-2c note (no oracle backs them; corpus-exercised is not ground). **`e5cb0eb`** a standing gate (`npm run cov:i8086`) emitting one number — opcodes covered by neither the corpus nor the grind — wired into CI's MAIN job by lego-a4 (`2fe136f`), not the grind job, so it runs where the vectors are absent. **`d1b325a`** STP (DB) on the W65C02 — its analog: STP and WAI are the only two whose WDC-suite vector files are EMPTY, and STP was asserted nowhere. Method (wrap `_exec`, diff fired-set against the suite's documented/empty omissions) also gifted lego-a4 the REP string-op cycle bug (`71cc1ca`) and fixed the ehBASIC ROM reading as a pass when absent (`23619a7`, now an `oracle-census` fixture row of lego-a4's, `e945dfb`). **w65c02 is opcode-complete bar STP/WAI (254/256 ground); a standing w65c02 number is licence-thinner than the 8086's — the most realistic 6502 workload (ehBASIC) is NC and cannot be a CI gate.** |
| E6.8.3 — port and interrupt breakpoints | lego-a4, with the support-chip lane | 2026-09-04 | `e0007e2` on `feat/i8086-186`. **Split lane, built to the machine side's shape rather than mine**: `machine.hooks.onPortAccess`/`.onInterrupt` are theirs (`2c83dcf`, `c837e4f`), the core's software-INT emit sites and the target are mine. `{kind:'port', port, dir?}` and `{kind:'int', vector?, source?}`; hooks attach only while watched and detach on the last clear, so an unwatched machine pays one null check per IN/OUT. **THE DOUBLE-FIRE TRAP, verified not assumed:** the core's public `interrupt(n)` — hardware delivery — routes through the same `_interrupt(n)` funnel the INT opcodes use, so emitting there reports every IRQ twice and "break on INT 21h" trips on the timer tick. The core emits from the OPCODE handlers and the fault sites only; a test asserts `cpu.interrupt(8)` emits nothing from the core. Faults are `source:'exception'`, not `'int'` — raised BY the CPU rather than asked for BY the program, the same argument that separates `int` from `irq`. 646,000/646,000 unchanged, 450/450 across the tier. **Record correction:** `e0007e2` is a MERGE commit. Its message describes E6.8.3 only, but the merge also carries the support-chip lane's E6.8.5a (`cga-card.js`, `test/cga-crtc.test.mjs`) and their `test/i8086-port-trap.test.mjs`. Those are their commits with their own messages and authorship in history; the merge message does not mention them and should have. |
| E6.8.2 — symbols in the debugger | lego-a4 | 2026-09-04 | `3b81970` (disassembler substrate) + `cd1d62d` (the join), on `feat/i8086-186`. **Taken with lego-47's agreement — it holds `src/i8086-debug.js` and handed it over.** The producer and consumer had both existed all along and nothing joined them. New: `labelsFromAssembly(result, {loadSeg})`, `setSymbols`/`symbolAt`, `capabilities().symbols`, and `setBreakpoint({kind:'code', symbol})`. **Three silent-failure modes, each with a test**: an `equ` admitted as an address (a constant renaming whatever lives there — the same bug the disassembler's own regex had); a linear map handed to a disassembler that speaks segment offsets (labels NOTHING on any machine not at segment zero, and renders plain hex rather than raising — mutation-checked, reverting the rebase fails exactly the one test written for it); and a breakpoint on an unknown name silently doing nothing, which lets a program run to completion and produce evidence it never reached the label. 8 new tests, 385/385 across the tier. |
| E6.8.1 — the 80186/80188 instruction variant | lego-a4 | 2026-09-04 | `1f6b3e2` (core) + `0d97728` (disassembler) on `feat/i8086-186`; core merged to `feat/i8086-tier` at `2795d25`. **Graded to the same standard as the 8086 half, not a weaker one:** core `132,532/132,532`, disassembler `172,430/172,430` on TEXT and LENGTH, both against SingleStepTests/v20 (MIT, sparse-checked out at 156 MB of 851). 8086 unchanged at `646,000/646,000` on both grinders; 307/307 tier tests; 18 new. **Where the V20 stops being a 186 the grinders EXCLUDE and REPORT rather than scoring the wrong chip** — 39,898 shift counts above 31 in the core grind (the V20 does not mask, MEASURED: 470/600 masked vs 579/600 unmasked on C0.4+C1.4) and 3,570 REPC/REPNC in both. Counts print even when green. **Three findings worth more than the opcodes.** (1) *OF is defined for every shift count on the later part, and it is the count-of-one rule applied to the LAST iteration, not a new rule* — SHR is the tell, because after two byte shifts nothing is left in the top bit. Bit-identical at count 1, which is why 646,000 holds. (2) *The suite's own disassembler is lossy* — it drops the three-operand IMUL's immediate and hides a segment override on OUTS where it applies; both are behind `v20Syntax: true` so the grinder gets the test convention and the product does not. (3) *The word shift form pads its count to two digits and the byte form does not* — no principle in it, 800 vectors disagreed in one leading zero. **Declared, not hidden:** 0x63-0x67 are undefined on a real 186 and are still rendered and executed as 8086 aliases; nothing grades that. NEXT: a `vectors186:` CI job — the grinds are real now, which is the ordering this repo requires, and the sparse recipe is the same shape the existing `vectors:` job uses. Not started; ask lego-47 first, ci.yml is shared. |
| §E6.8 — the finished-emulator gap survey (emu86, PCjs, XTCE-Blue) | lego-a4 | 2026-09-04 | `4560d78` on `feat/i8086-support-chips`, merged to `feat/i8086-tier` at `fca6b9a`. **Note for the record:** the section was written into a shared tree and swept into another agent's commit by a `git add -A` — see rule 3. No work was lost; the attribution in that commit message is not the whole story. Two premises corrected same-day by `lego-47`; both corrections are recorded in place in §E6.8 rather than edited out. |
| coverage-and-boards — the three self-booting 8086 example firmwares + board fixes | this session (sim2 / `8086 coverage testing materials`) | 2026-09-04 | On `feat/i8086-support-chips`: **`4133114`** TIMERDEMO8086 — the interrupt example (INT 8 tick painting a live counter; first end-to-end proof a running program takes & services a hardware interrupt here: 8254 OUT0 → 8259 IR0 → CPU INT 8 → ISR → B800 → EOI); **`cffca33`** CGADEMO8086 screen example + PCXT8086 CGA video-RAM fix (B8000-BFFFF, matching XTDISK); **`eb8109a`** PCXT8086 `dma:'dma1'` load-bearing-wire comment. On bw-circuit-ui `feat/i8086-ui`: **`afee1de`** Machine-Loader offers all three firmwares, loaded high via `romAt = 0x100000 − length`. E7 step 2 + the EXTRACTOR-IRQ-GAP correction landed in ROADMAP the same push as this row (rule 2). |
