# Existing protected 80286 image qualification

This qualification runs seven byte-for-byte upstream boot sectors from JA1UMI's
MIT-licensed `80286_programming` repository at revision
`3ee4c6f1178e71db8926caf999416af7f4e340b3`. The manifest requires the complete
expected eight-image set and verifies every 512-byte image and the license by
SHA-256 before execution. Each engine receives zeroed 16 MiB RAM, the unchanged
sector at physical `0x7c00`, and the declared BIOS handoff state at `0000:7c00`.
There is no BIOS, disk controller, guest patch, rebuilt binary, or host-generated
video output.

`hellop`, `callgate`, `cgatep`, `ptr_validn`, and `stakp` must reach their own
`EB FE` terminal loop with the complete expected guest-written text. The runner
does not use repeated-IP detection, so restartable string iterations cannot be
mistaken for completion. `tasksw` and `taskgate` must complete this visible task
register sequence:

```
0030 -> 0038 -> 0040 -> 0038 -> 0048 -> 0038 -> 0040 -> 0038
```

The task check covers two different tasks, both returns to the dispatcher, and a
second execution of task 1. It also requires the red row-0 and green row-1 video
cells produced by the two task bodies. Port `0x3da` receives a deterministic
alternating clear/set vertical-retrace bit; this is functional input and carries
no VGA timing claim. Differential comparison uses the complete text VRAM image,
the complete mutated boot-sector region (including descriptor and TSS state),
registers, visible selectors, CPL, TR, LDTR, and the low architectural MSW bits.
FLAGS comparison includes defined 286 status/control state (`0x7fd7`) and excludes
reserved bits 3, 5, and 15. Instruction counts are recorded but not compared,
because the engines intentionally use different REP stepping granularity.

`scripts/compare-pcjs-protected286-external-images.mjs` requires the exact clean
PCjs revision `c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70`. Its JSON receipt records both
input and oracle revisions, manually enumerated execution-source hashes, each
engine's result, and exact field differences. `EXTERNAL286_ORACLE_MUTATION` accepts
`video`, `taskreturn`, `fixturehash`, `sector`, or `taskstate`; every mutation
changes a named graded result and must make the command fail. The finite-image
sector comparison admits no byte differences. The task-image comparison admits
only the seven exact PCjs differences listed in the receipt; changing saved SP,
FLAGS, or any other byte fails qualification.

`int4_tgate.img` remains a separately reported diagnostic input. The pinned PCjs
reference reset with numeric `-1` during a historical audit at the exact pinned
oracle and input revisions. The positive receipt records that provenance but
does not rerun or swallow the exception, and it does not count the image among
the seven PCjs-compared programs.

The pinned comparison therefore reports seven PCjs comparisons and eight local
program results. Its successful status is
`pass-with-known-oracle-differences`, never a claim of byte-for-byte agreement.
The three allowlisted categories are exact: outer-RETF DS/ES invalidation;
dispatcher IOPL restoration; and seven task-sector bytes per task example for
IOPL, outgoing NT, and the saved task stacks. Every other finite-sector byte and
every task-sector byte outside those explicit offsets must agree. The owned
results follow the Intel _80286 and 80287 Programmer's Reference Manual_ outer
return rules and Appendix B task-switch pseudocode (including Table 8-2): an
outer return invalidates unusable data caches, the incoming TSS supplies FLAGS,
task return clears outgoing NT, and an inter-task CALL/IRET does not construct a
stack frame in either task. See Intel publication 210498-005 (1987), archived at
https://bitsavers.org/components/intel/80286/210498-005_80286_and_80287_Programmers_Reference_Manual_1987.pdf.
