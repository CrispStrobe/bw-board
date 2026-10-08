# Owned DPMI allocation frame attribution

Status: proposed implementation contract; no CPU-produced service-frame result
is qualified yet. Start from the frozen [AT source
41db7ba4](https://github.com/CrispStrobe/bw-board/tree/41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7)
and preserve its [first finite application result](I80386-DPMI-HIGHMEM-AT-RESULTS.md).
Use a separate branch and script/workflow namespace. Do not modify or rerun the
original qualification to manufacture additional evidence.

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
validated stack/frame location. The matching return record must contain the
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
entry ticket. Treat task-committed exceptions distinctly. No foreign callback,
getter, guest-memory reread or observer reentry may execute inside delivery,
IRET or fault handling.

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
