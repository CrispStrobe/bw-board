# Owned DPMI allocation frame attribution

Status: proposed implementation contract; no CPU-produced service-frame result
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
These five controls await hosted execution. The CPU bytes remain identical to
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

The original failed runs remain evidence. A new hosted run must establish the
corrected runner's current and historical outcomes and reach the xv6 guest;
local controls do not establish those results. No controller integration, new
allocation-frame guest attempt, frame result or consumer adoption is qualified
by this checkpoint. Clean affected regressions, then the separate controller
and one reviewed hosted diagnostic remain unfinished.

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
arming. Arm at an owned synchronous pause near that wrapper, rather than
collecting every timer poll from main entry. Declare finite queue, nesting and
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
