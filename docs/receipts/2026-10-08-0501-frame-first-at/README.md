# First AX=0501 AT frame attempt: pre-arm observer failure

[Run 37814786319](https://github.com/CrispStrobe/bw-board/actions/runs/37814786319),
attempt 1 at [`c968428d`](https://github.com/CrispStrobe/bw-board/commit/c968428d4d478ae115b8e9cb1065f8a349b7ccbe),
failed with `cpu.segmentCaches is not iterable`. All twelve standard enabled
checks had passed before the dedicated label was applied once. Source admission
and pure controls passed in this attempt; the AT step failed, then source
recheck, bounded inventory and report upload passed.

The owned main cut passed at step 44,609,970. Execution stopped at step
44,609,991 while collecting wrapper-observer references. The CPU stores its
six segment-cache slots in a plain object; the observer incorrectly tried to
spread that object as an iterable. The passive wrapper copy and journal arm
were not reached. The final report and progress agree: wrapper receipt absent,
journal still `waiting`, no entry/IRET observation and finite client false.
The empty redirected output and missing completion files do not qualify the
client. The prior strict whole-text failure is preserved separately from the
ten passing owned code regions.

Root and independent peer audited the sole original packet read-only against
immutable Git, official metadata, inventory and compiler/media/notice bindings.
The [derived summary](summary.json) records official origins, original hashes
and the failure boundary. No producer helper or guest replay was used.
This is an observer implementation defect, not an observed protected-mode CPU
fault or a guest compatibility result.

The isolated correction is [draft PR464](https://github.com/CrispStrobe/bw-board/pull/464)
at reviewed head [`4c22a574`](https://github.com/CrispStrobe/bw-board/commit/4c22a574ec50a515fe4954a3fda0ff6a947a5068).
Its 23 pure controls and exact source admission passed; the corrected guest
path is unrun. Continue with all enabled checks on that exact head.
Only then run a new, separately identified attempt on that corrected source;
preserve this original failure without rerunning it. See the
[frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).
