# Owned 0501 task-core outcome: original hosted checkpoint

Reviewed source [`15afcd6b`](https://github.com/CrispStrobe/bw-board/commit/15afcd6ba9dd1b494c343c6af6307bcf324b0ebd)
in [draft PR470](https://github.com/CrispStrobe/bw-board/pull/470) passed all
12 enabled checks, with only the two declared optional vectors-full skips.
The source remains a draft; this receipt does not adopt it or move a consumer pin.
[Machine-readable summary](summary.json) retains exact original identities.

## Finite regression gate

The original [xv6 run 37895727469](https://github.com/CrispStrobe/bw-board/actions/runs/37895727469)
passed three scenarios: 4m filesystem roundtrip, 14m boot and 4m forktest.
Executed PR merge `03dabf73ca40f8b45ef5ce9d175185ebe22ebca3` has the same tree
as the reviewed source. Root and a separate Sol reader checked the original
ZIP/log, listed source hashes and focused test names. All 81 focused names
passed, including VM86 outcome and accessor-refusal controls. The current
cohort reports 1,656 tests, 1,645 passing, zero failing and 11 skips; the
historical cohort reports 288/288 passing. This uses the existing xv6 PSE/APIC
compatibility profile and does not qualify strict physical 386DX behavior.

## Actual owned-frame diagnostic

After the exact-head checks passed, the dedicated label was applied once.
Original [run 37897547815](https://github.com/CrispStrobe/bw-board/actions/runs/37897547815)
completed **FAILURE** with `task-switch-during-owned-frame`. Its 112-member
report-only packet binds 196 source roles and 62 JavaScript graph nodes.
Entry, attempted-task ticket, exact 80-byte wrapper comparison and input
hashes match the [preceding original attempt](../2026-10-09-task-attempt-and-gc-support/README.md).
The entry is AX=0501, BX:CX=4096, gate14, width32, code16/stack32, CPL3→3
with a 12-byte frame. At active step20 the core attempts JMP selector `0x70`
from CS `0x2b`, EIP `0x3e38`, current TR `0x60`, NT clear.

The new outcome records **`core-return`** into CS `0x18`, EIP `0x3ee9`,
CPL0, VM86 clear, NT clear, TR `0x70`/type11. This is an observed normal
return from the existing task core into ring0, rather than a recognized task
fault. It is not an independent reconstruction of TSS writes or a completed
service return. The original frame guard remains failed, `returned` is null,
and no finite-client output/completion is obtained in this diagnostic.
Do not turn an intentional ownership refusal into either whole-machine
compatibility success or a demonstrated guest CPU fault.

Independent source review rejected the earlier outcome field's use of CS RPL
as CPL in VM86. The correction derives effective CPL from own mode fields
and adds a VM86 control before this actual run. No earlier outcome head was
rerun or relabelled. Root and a separate Sol reader audited retained originals
without importing source helpers or replaying a guest.

## Next bounded slice

Implement the [separately named task-excursion/resumption diagnostic](../../I80386-DPMI-TASK-EXCURSION-LANE.md). Retain the
original INT31 frame identity, bound task transitions and active steps, admit
only reviewed task-core outcomes, and identify resumption of the exact original
task/frame before attributing IRETD. Arbitrary task identity, nested ownership,
VM86 transitions, frame replacement, faults and ambiguous return must refuse
unless explicitly covered by a new reviewed profile. Prepare source controls
and independent expected observations before changing the current guard.
This result supplies no allocation hotspot, performance improvement or RTx.
