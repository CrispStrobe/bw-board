# Owned DPMI allocation frame attribution

Status: implemented observer with a finite committed entry and refused return; no completed service-frame pair
is qualified yet. Start from the frozen [AT source
41db7ba4](https://github.com/CrispStrobe/bw-board/tree/41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7)
and preserve its [first finite application result](I80386-DPMI-HIGHMEM-AT-RESULTS.md).
Use a separate branch and script/workflow namespace. Do not modify or rerun the
original qualification to manufacture additional evidence.

## CPU-only source checkpoint

[Draft PR460](https://github.com/CrispStrobe/bw-board/pull/460) is stacked on the
frozen AT source. Its reviewed source is
[`2f979b37`](https://github.com/CrispStrobe/bw-board/commit/2f979b376fdf37cf7126345aa8c9bbd85a4aa3aa).
Its two-file delta adds the optional private CPU journal and 24 focused CPU
tests. Root and peer read-only source audits and independent syntax/whitespace
checks passed. CPU tests were not executed locally.

The first [PR CI run 37787580143](https://github.com/CrispStrobe/bw-board/actions/runs/37787580143),
attempt 1 at that exact source, failed in the 386 regression step before the
xv6 guest ran. Root and peer independently matched all 24 focused journal test
names to passing log rows. The complete step reported 1,863 tests: 1,836 pass,
16 fail and 11 skip. All 16 failures concern historical oracle source-identity
checks comparing the frozen CPU hash with the changed current CPU. Preserve
this failure and the old receipts; repair the historical tests' immutable-source
binding without substituting current hashes or treating old captures as current
CPU qualification.

The follow-up source checkpoint
[`13d82f31`](https://github.com/CrispStrobe/bw-board/commit/13d82f3116107a1c4d8dff421db747eaa1bfef23)
adds five CPU boundary controls: fault fallback, successful task delivery,
post-commit task failure, excluded 16-bit return and same-CPL 32-bit return.
All five passed the corrected hosted run described below. The CPU bytes remain identical to
`2f979b37`.

CI now partitions the selected tests without omissions: current tests run on
current source; the ten unchanged historical test files run in a detached
`41db7ba4` checkout with the original CPU. Admission checks bind their test,
lockfile, literal dependency and named fixture bytes, plus the current selected
test bytes and CPU. The literal dependency scan is not a claim of exhaustive
computed dependency discovery; the frozen checkout supplies all historical
inputs. New current fixtures are allowed while all 41 old named fixtures stay
byte-exact. Root and peer source review and 11 host-only planner/scheduling
controls passed. Those controls do not execute the emulated CPU.

The original failed runs remain evidence. The corrected
[push run 37792187626](https://github.com/CrispStrobe/bw-board/actions/runs/37792187626)
passed at exact `13d82f31`: current tests 1,604/1,593 pass/zero fail/11 skip,
frozen historical tests 288/288 pass/zero fail, then both xv6 memory profiles,
the filesystem exercise and process-exhaustion regression. Root and independent
peer matched all 29 journal controls to passing rows and audited the original
five-JSON guest artifact against Git. See the [bounded receipt and limits](receipts/2026-10-08-0501-journal-xv6/README.md).
This qualifies those regressions, not an allocation-frame guest or consumer
adoption. The full [push CI run 37792187810](https://github.com/CrispStrobe/bw-board/actions/runs/37792187810)
also passed: current cohort 8,448 tests, 8,146 pass, zero fail and 302 skip;
historical cohort 288/288 pass. All 12 enabled PR460 checks have now passed at
`13d82f31`; the two declared `vectors-full` jobs skipped. This does not merge
the draft source or qualify the later adapter.

## Unconnected controller-policy checkpoint

[Draft PR461](https://github.com/CrispStrobe/bw-board/pull/461), reviewed head
[`4457eac3`](https://github.com/CrispStrobe/bw-board/commit/4457eac39de441fdff93f0eeaf05a4e4a7826b64),
is stacked on `13d82f31`. Its four new files add private wrapper admission,
a CPU-free one-shot policy and normal-test-selection controls. The inherited
CPU, AT driver, inputs and workflows are unchanged by this slice.

Run its synthetic controls with:

```sh
node --test test/i80386-0501-frame-policy.test.mjs
```

Coder, root and independent peer each passed all 12 controls. These check
public-layout mutation on exact and mismatched text paths, reentry, partial or
malformed frame context, status/drain counter disagreement, CF/address
mismatch and preservation of invalid reset/step-cap reasons. Caller-supplied
snapshots and synthetic records do not authenticate a pause or actual CPU event.

The follow-up runnable adapter is recorded in the next section. Continue
from its remaining gates rather than repeating this policy slice or creating
another driver namespace. The final acceptance checks below still apply.

Neither this policy checkpoint nor its controls qualifies a guest frame,
physical mapping, performance or consumer adoption.

## Runnable adapter source checkpoint

[Draft PR462](https://github.com/CrispStrobe/bw-board/pull/462), final source head
[`8b82bde4`](https://github.com/CrispStrobe/bw-board/commit/8b82bde41f2fffff07279834a333a47bcd8f5a7f),
adds the pinned `adapter.mjs`, real driver wrapper and CPU-free orchestration
under `scripts/i80386-cwsdpmi-0501-frame-at/`. The inherited finite AT driver,
CPU, media and workflows stay frozen. Root and peer reviewed executable source
`cb6b6c46`; subsequent changes are README-only. All 19 CPU-free policy and
orchestration controls passed. The adapter itself has not executed.

The driver retains authenticated main-cut CS/code base, checks private wrapper
bytes and unchanged guest/reference state at its synchronous opportunity, arms
once, and polls after ordinary machine steps. It preserves the full CPU pair,
wrapper hashes and separate client/frame verdicts. Reentry, observer failure
and arm exceptions are terminal even if a caller catches the error.

The executable invocation and pure-control commands are documented in the
[new namespace README](https://github.com/CrispStrobe/bw-board/blob/8b82bde41f2fffff07279834a333a47bcd8f5a7f/scripts/i80386-cwsdpmi-0501-frame-at/README.md).
This is runnable source preparation, not an allocation-frame guest result.

## Hosted gate preparation checkpoint

[Draft PR463](https://github.com/CrispStrobe/bw-board/pull/463), reviewed head
[`c968428d`](https://github.com/CrispStrobe/bw-board/commit/c968428d4d478ae115b8e9cb1065f8a349b7ccbe),
is stacked on `8b82bde4`. Partial progress now retains the wrapper receipt at
arm and the full terminal CPU journal at complete/invalid. Later routine
updates preserve that milestone, and a failed progress write does not replace
the CPU's invalidation reason. Journal polling stops after the terminal record
is retained; ordinary machine execution continues. Every partial report remains top-level
`passed:false`; no raw RAM, executable or disk bytes are retained.

The new source manifest binds 194 Git-matching roles and 61 recursive ESM nodes,
including the actual driver and all invoked JavaScript controls. The CPU and
inherited compiler, input, media, ROM and notice pins are unchanged. The
dedicated workflow accepts the `x86-cwsdpmi-0501-frame-at` label on a
same-repository PR, checks out that exact head and allows attempt 1 only.
Source is checked before and after execution; report upload requires successful
bounded inventory. Root and independent peer reviewed the exact source; all
20 CPU-free policy/orchestration controls and source-admission controls passed.
No compiler, CPU or guest execution occurred during local preparation.
Subsequent hosted [push xv6 run 37798349010](https://github.com/CrispStrobe/bw-board/actions/runs/37798349010)
and [PR xv6 run 37798357864](https://github.com/CrispStrobe/bw-board/actions/runs/37798357864)
passed at exact `c968428d`. Root and independent peer audited the push run
original packet and log: all 49 focused controls and three finite guest
scenarios passed. See the [receipt and limits](receipts/2026-10-08-0501-frame-gate-xv6/README.md).
These xv6 regressions do not establish an allocation-frame guest result.

Continue with these remaining gates:

1. All twelve standard enabled checks passed at exact `c968428d` before the
   first dedicated diagnostic. Its first run then failed in observer reference
   collection, before journal arm. Preserve that original outcome.
2. Use the reviewed isolated correction in PR464 at `4c22a574`, described
   below. Do not repeat the already completed reference-helper implementation.
   Preserve its real-shape, accessor-refusal and replacement controls.
3. After final source review and every enabled corrected-head check passes,
   run one separately identified bounded attempt. Independently audit its
   original packet without producer helpers or replay. Require the selected
   committed pair and same-run finite completion; preserve failure otherwise.

Use the [current README](https://github.com/CrispStrobe/bw-board/blob/c968428d4d478ae115b8e9cb1065f8a349b7ccbe/scripts/i80386-cwsdpmi-0501-frame-at/README.md)
and [dedicated workflow](https://github.com/CrispStrobe/bw-board/blob/c968428d4d478ae115b8e9cb1065f8a349b7ccbe/.github/workflows/i80386-cwsdpmi-0501-frame-at.yml).
This checkpoint does not qualify a guest frame, performance or consumer adoption.

## First actual AT attempt

[Run 37814786319](https://github.com/CrispStrobe/bw-board/actions/runs/37814786319)
at exact `c968428d`, attempt 1, failed with
`cpu.segmentCaches is not iterable`. The owned main cut passed; the observer
then treated the real CPU's plain cache object as an iterable. Execution stopped
before the passive wrapper copy and journal arm. Root and independent peer
confirmed the original packet's identity, source/compiler/media/notice bindings
and pre-arm failure boundary. See the [preserved failure receipt](receipts/2026-10-08-0501-frame-first-at/README.md).

This is an observer defect. No committed frame or finite client completion was
qualified. [Draft PR464](https://github.com/CrispStrobe/bw-board/pull/464),
reviewed head [`4c22a574`](https://github.com/CrispStrobe/bw-board/commit/4c22a574ec50a515fe4954a3fda0ff6a947a5068),
corrects reference capture on an isolated branch stacked on `c968428d`.
The new CPU-free helper retains the cache parent and six own data slots,
translation entries and VGA/backing/debug identities without invoking
iterators or accessors. Root and peer compared these shapes against the
actual CPU, board and VGA sources. All 23 pure controls and exact source
admission passed: 195 Git-bound roles and 62 recursive ESM nodes. The CPU,
workflow and inherited compiler/media/ROM/notice pins are unchanged.

All 12 enabled checks on exact `4c22a574` passed, with only the two declared
`vectors-full` skips. The corrected source also passed the independently
audited [three-scenario xv6 regression](receipts/2026-10-08-0501-reference-fix-xv6/README.md).
After those gates, the dedicated label was applied once to PR464, creating
[new actual run 37818842928](https://github.com/CrispStrobe/bw-board/actions/runs/37818842928).
The corrected AT run failed with `unsupported-owned-delivery` after the wrapper
copy passed and the journal armed. Its [preserved failure receipt](receipts/2026-10-08-0501-reference-fix-at/README.md)
records the observed boundary. The compound guard does not retain which
predicate failed; the next task is a bounded diagnostic rejection receipt,
without relaxing unsupported cases. Neither attempt qualifies a committed
allocation-frame pair or finite client completion. Do not replay or rewrite
either original run, or infer allocation-frame success from CI or xv6.

## Reached diagnostic task: explain rejected delivery

Start from reviewed `4c22a574`; preserve both original failed attempts. Add a
bounded immutable diagnostic record for `unsupported-owned-delivery` containing
the actual software/vector/nesting flags, gate type and width, VM86/error-code
status, old and target CPL, handler CS/SS and their default sizes, and frame
kind/size. These are rejection facts, not a successful journal entry.

Stage the facts after ordinary delivery effects, then expose them only when
the enclosing CPU instruction completes normally. Fault, reentry, trace,
zero-result and step-cap paths must discard uncommitted facts. Preserve the
first failure, invalid journal state, guest effects and disabled-path behavior.
A recorder failure must never turn into a guest fault. Keep task/VM86/width
rejection criteria unchanged in this diagnostic slice.

Use an isolated source branch with an explicit changed-file allowlist and new
CPU hash; preserve historical manifests and source-bound test cohorts. Hosted
controls must exercise reachable width/handler-code/handler-stack rejections,
a 32-bit gate targeting a 16-bit-default handler, discarded staging and recorder
failure/reentry. Software/vector/nesting/VM86/error-code guards remain intact;
do not claim each disjunct was individually executed when decoded intent makes
it unreachable in this fixture. After review
and all enabled exact-head checks, run one separately identified actual probe
and audit its original packet. Use the recorded facts to scope any later
mixed-width frame/IRET implementation; do not guess it from final registers.

The diagnostic-only implementation is published in [draft PR465](https://github.com/CrispStrobe/bw-board/pull/465)
at reviewed head [`0714159c`](https://github.com/CrispStrobe/bw-board/commit/0714159c9875ac17bf5ef5a8e5418f5815fa1608),
stacked on `4c22a574`. Root and independent peer completed source review;
source controls, syntax and 196-role/62-node source admission passed. Eight
new focused controls are added for hosted execution. The independently audited
[three-scenario xv6 regression](receipts/2026-10-08-0501-delivery-diagnostic-xv6/README.md)
passed, including all 60 focused names; both Harris checks passed. All twelve
enabled exact-head checks subsequently passed, with only the two declared
`vectors-full` skips. After checking those gates and confirming no prior
actual for this source, the dedicated label was applied once to PR465, creating
[diagnostic run 37830225406](https://github.com/CrispStrobe/bw-board/actions/runs/37830225406).
The [audited diagnostic receipt](receipts/2026-10-08-0501-delivery-rejection-facts/README.md)
records gate type 14/width 32, handler code size 16, stack size 32, CPL 3 to
CPL 3 and a 12-byte frame. Only the handler code-size guard failed. The run
remains invalid with null entry/return and no finite completion. Do not relabel
or replay this source; the rejected facts cannot qualify a delivery/return pair.

## Next source task: observed handler profile

Start from reviewed `0714159c`. Add an explicit opt-in observer profile for
interrupt gate type 14/width 32, handler code size 16, stack size 32, same CPL 3
and a 12-byte frame. Preserve the existing default profile. Bind selection
through own data properties from orchestration to policy and CPU admission;
require the matching profile in the completed receipt. Retain the actual
decoded software-interrupt origin, committed entry and post-immediate return
EIP. A rejected or mismatched profile grants no frame credit.

Keep handler context continuity bounded to the selected profile. Require an
actual decoded IRET with effective width 32, the same validated linear frame,
consumed CS/EIP/flags, restored caller CS/SS/ESP/CPL and returned CF/address.
Keep saved flags, consumed flags and returned flags distinct. Do not infer
IRET width from handler code defaults. Handler excursions may leave this
narrow observer profile unqualified without implying a guest CPU defect.

Hosted controls must cover the prefixed 32-bit IRET positive case, default
profile rejection, gate 15/16-bit gates, 16-bit IRET, outer CPL, 16-bit stack,
frame/return mismatches, context excursions, task/VM86/nested delivery and
transaction/observer failures. Keep client/media/machine/workflow unchanged;
use fresh exact source-policy hashes and an isolated branch. Complete source
review and every enabled exact-head check before one new actual run. The
profile implementation is published in [draft PR466](https://github.com/CrispStrobe/bw-board/pull/466)
at source-review checkpoint
[`1ecb987b`](https://github.com/CrispStrobe/bw-board/commit/1ecb987b86217c7c549fffc1d3b7ff498898b9dd),
stacked on PR465's `0714159c`. It preserves the default observer and selects
`gate14-code16-stack32-same-cpl3.v1` explicitly through the controller.
The observer checks handler descriptor contents and live cache identity after
IRET frame/descriptor reads, before restoring the caller. These are instruction
and return-commit boundary checks, not a continuous physical-memory lease.
Focused authored regressions include in-place mutation and cache replacement during frame reads,
plus selected-profile gate16 and stack16 rejection.

Source controls, syntax checks, all 24 CPU-free policy/orchestration controls,
and exact-head source identity (196 roles, 62 recursive JavaScript nodes) pass.
The first hosted source `94ecaacb` failed one new test in both CI and the xv6
workflow: a 16-bit IRET on a 32-bit frame raised the original guest #GP, which
the test had not expected. The [preserved failure and correction receipt](receipts/2026-10-08-0501-mixed-profile-ci-correction/README.md)
records both runs. Reviewed `1ecb987b` corrects that expectation and source pins
only; CPU code is unchanged. Its [corrected-source xv6 run](receipts/2026-10-08-0501-mixed-profile-xv6/README.md)
passes all three finite guests and all 69 focused regressions. Other required
exact-head checks and a real CWSDPMI guest frame pair remain pending; no new
speed measurement is claimed.
Refresh open PRs and exact-head checks before duplicating work. Outer-CPL
16-bit return semantics and other combinations remain separate tasks.

## First deliverable

Observe exactly one owned protected-mode 32-bit `INT 31h`, function `0501h`,
requesting 4,096 bytes, and its matching protected-mode 32-bit `IRET`.
Bind the decoded instruction to the private, fresh-map-authenticated
`allocateMemory` wrapper extent after the authenticated ten-role main cut.
Record the actual decoded instruction start and post-immediate return EIP;
do not infer instruction length from a vector notification or end registers.
Require AX `0501h` and BX:CX `4096` at that instruction.

The committed delivery record must identify its software origin, gate width,
old/new CPL, handler CS:EIP and SS:ESP, saved return CS:EIP and flags, and the
validated linear stack/frame location. Compare that linear location at return;
this first slice does not establish unchanged physical backing or mapping
stability between delivery and IRET. The matching return record must contain the
validated consumed frame and actual restored CS:EIP, SS:ESP, CPL and flags.
Require return to the recorded post-immediate wrapper EIP with the original
CS and SS:ESP, clear returned CF, and returned BX:CX matching the same run's
strictly parsed linear-address output. Keep delivered saved flags and consumed
flags separate: a DPMI handler may change saved CF.

Do not require or claim a main CALL/RET chain, other allocation services, or
BIOS-simulation service `0300h` in this first slice. Disable collection after
the selected pair, continue ordinary execution, and require the finite client's
existing pattern, advancing-tick, zero-exit and fresh shell-return checks.
Nested task, VM86, 16-bit, unmatched or otherwise unsupported transitions while
the pair is open produce a preserved unqualified observation; they do not
justify broader claims or silently dropped records.

## Implementation ownership and authority

Inspect `src/experimental/i80386.js`: decoded `CD ib` in `_stepInstruction`,
validated frame locals in `_deliverProtected`, consumed frame and restored
state in `_iret`, and rollback/commit boundaries in `step`. Existing AT
interrupt hooks notify before hardware delivery; they cannot prove a committed
software frame. The unconnected interrupt-journal model is a design aid,
not an authenticated guest producer.

Implement a default-disabled CPU-owned journal containing copied primitives.
Use a private step-scoped transaction: stage from actual validated CPU locals,
publish only after the enclosing instruction commits, and discard on ordinary
rollback. A zero return from `step`, a fallback fault, an external interrupt
notification, or a direct helper call must not mint a successful software
entry ticket. Preserve the original CPU behavior for ordinary rollback and
task-committed exceptions; both leave journal attribution unqualified. No
observer-supplied callback or getter, guest-memory reread or observer reentry
may execute inside delivery, IRET or fault handling. Record construction uses
the reviewed ordinary CPU objects and validated locals.

The controller may select an admitted wrapper range; only the CPU's actual
decoded instruction and committed transaction authenticate the event. Keep
session/ticket ownership private, reject stale or cross-session records, and
recheck selected wrapper identity through the admitted passive reader before
arming. Public nested layout fields are mutable and do not supply private
wrapper authority; handle both clean and mismatched whole-text paths through
authenticated admission. Arm at an owned synchronous pause near that wrapper, rather than
collecting every timer poll from main entry. A board step may service an IRQ
before executing the CPU instruction: the pre-step PC is only an arming
opportunity, while the committed CPU record proves what executed. Declare finite queue, nesting and
event caps before the hosted attempt; retain the first failure on overflow.
After a guest effect has committed, journal failure must latch an invalid
observation and stop the controller outside the original CPU step. Never throw
back into guest rollback or retry a half-committed delivery.

An optional bounded handler-frame RAM crosscheck uses only installed ordinary
RAM at an owned synchronous pause, with unchanged CPU/board/RAM/page-table
fingerprints. It supplements CPU locals. Do not call CPU translation, bus or
MMIO reads, set paging A/D bits, or accept a caller pause boolean as authority.
Do not retain executable, disk-image or RAM contents in the report artifact.
Default-disabled branches may still cost time; zero overhead and speedup remain
unmeasured until a separate paired benchmark.

## Checks and completion gate

1. Publish a narrow source diff and exact source closure including the modified
   CPU, new controller and tests. Preserve inherited client, compiler, media,
   BIOS and notice pins. Review before authorizing the one actual diagnostic.
2. Exercise meaningful hosted CPU controls for prefix-derived return EIP,
   rejected gates, original delivery failure, ordinary rollback versus
   task-committed ambiguity, external/fallback delivery, altered saved CF,
   wrong CS:EIP/SS:ESP/CPL/width, unsupported nesting, stale tickets, reentry and
   capacity failure after a committed effect. Run affected existing paging,
   interrupt, privilege, task and VM86 regressions on the exact source.
3. Run pure controller controls for changed wrapper/map bytes, missing or
   reordered records, return/output disagreement and passive-reader rejection
   of MMIO or mutating observations. These controls are not a guest result.
4. Execute one bounded hosted AT diagnostic after source review. Preserve its
   original first outcome and official run/artifact metadata. Independently
   audit the original packet without producer-helper imports or guest replay.
   Require the selected committed pair and the same run's finite client exit
   and shell return. A client success without authenticated records fails this
   attribution gate.

Passing qualifies one owned `0501h` entry/return under the recorded profile.
It does not qualify every DPMI service, pre-main discovery, physical placement,
calibrated timer rate, general application compatibility or performance adoption.
Only then scope another service or a separate task/VM86/16-bit fixture from its
actual observed boundary.

## First mixed-profile actual: task-switch attempt boundary

Reviewed source `1ecb987b86217c7c549fffc1d3b7ff498898b9dd` passed all 12 enabled
checks and the first dedicated actual recorded the owned INT31/AX0501 entry.
It then refused `task-switch-during-owned-frame` at active step20, with no
return or finite client completion. The guard executes before task descriptor
validation, so the observed path is an attempt, not a committed switch.
The [original packet receipt](receipts/2026-10-09-x86-first-actual-diagnostics/README.md)
preserves source/run/artifact/log identities and independent audit scope.
Next scope is bounded primitive facts at the existing guard; do not relax task
exclusion or assume a kind/target/outcome from final registers. Earlier pending
qualification paragraphs above are historical checkpoints, not current status.

The diagnostic-only follow-up is published as [draft PR468](https://github.com/CrispStrobe/bw-board/pull/468),
reviewed head `f3b8b31d6e403020089f1dee31eaece45c06ac25`, stacked on frozen
PR466. Four paths change: CPU observer, existing journal tests and exact source
pins. It records one bounded attempted-task fact at the existing refusal guard:
kind/selector, current CS:EIP, CPL/NT, TR selector/type, active steps and profile.
Current EIP is not claimed as a decoded instruction start. It reads no task
descriptor and grants no task commit or frame return credit. Source review,
syntax and CPU-free source controls pass; hosted CPU/guest qualification is
pending. Require all 12 enabled checks successful and only the two declared
optional skips, then apply the dedicated label once on that unchanged head.
Audit original source/packet and attempted-task facts before changing ownership.

PR468's first hosted xv6 run now passes all three finite scenarios and 73
focused names; [original receipt](receipts/2026-10-09-0501-task-attempt-xv6/README.md)
binds the executed PR merge tree to reviewed `f3b8b31d`. Root and a separate Sol
reader audited original packet/log/Git roles. Other required checks and the
actual attempted-task ticket diagnostic remain pending at this checkpoint.

## Historical task-attempt checkpoint

PR468's reviewed `f3b8b31d` cleared all 12 enabled checks, then actual
[run37893093332](https://github.com/CrispStrobe/bw-board/actions/runs/37893093332)
recorded a JMP attempt to selector `0x70` from CPL3 with NT clear and current
TR `0x60`. The first task guard refusal and null return remain unchanged.
The [original receipt](receipts/2026-10-09-task-attempt-and-gc-support/README.md)
preserves exact source, packet and audit scope. Earlier pending-check notes are
historical. The next source slice is a bounded post-core return/fault outcome
receipt, not a task-aware frame profile or relaxed ownership rule.

The four-path outcome slice is published as [draft PR470](https://github.com/CrispStrobe/bw-board/pull/470),
reviewed head `15afcd6ba9dd1b494c343c6af6307bcf324b0ebd`, stacked on PR468.
It distinguishes normal core return, recognized faults with or without the
core's own `taskCommitted` marker, and unclassified throws while preserving
the original result, fault identity and guest effects. Absence of that marker
does not prove absence of earlier task-state writes. Accessor/reentrant
observations refuse; the first frame guard remains unchanged. Independent
review caught a false CPL field for VM86 at the earlier source-only head;
the correction derives effective CPL from owned mode fields and adds a VM86
control. No actual was run at that earlier head. Source and
syntax controls pass; hosted CPU/guest checks and an actual outcome packet
remain pending. After all 12 enabled checks pass with only the two declared
optional skips, apply the existing diagnostic label once at that exact head
and independently audit its original report. Do not infer task completion
from the preceding attempt ticket or relax frame ownership at this stage.

## Task-core outcome reached; original task resumption pending

The exact outcome head passed all 12 enabled checks and was labelled once.
Its [original actual outcome and finite xv6 receipt](receipts/2026-10-09-0501-task-outcome/README.md)
records a normal task-core return into CPL0, CS `0x18`, EIP `0x3ee9`,
TR `0x70`, with VM86 and NT clear. Root and a separate Sol reader checked the
original packet/source/input bindings. The first frame guard remains failed
and its return field stays null; the finite client did not complete in this
diagnostic. The preceding pending-check notes are historical.

Next follow the [bounded task-excursion contract](I80386-DPMI-TASK-EXCURSION-LANE.md)
to identify resumption of the exact original task/frame with a separate diagnostic. Do not infer an IRETD pair
from this core return or broaden the current ownership rule without evidence.
