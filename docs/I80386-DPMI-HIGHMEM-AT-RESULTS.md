# Owned high-linear-memory and advancing-timer AT result

The first [AT attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37776895780),
attempt 1, passed the finite owned-client gate at
[`41db7ba4`](https://github.com/CrispStrobe/bw-board/tree/41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7/scripts/i80386-cwsdpmi-highmem-at).
[PR459](https://github.com/CrispStrobe/bw-board/pull/459) remains a draft.
Root and peer independently audited the original report-only packet with
standard-library parsing and Git checks, without producer-helper imports or
guest replay. The [selected receipt](receipts/2026-10-08-i80386-highmem-at.json)
binds the official source, run and original artifact.

## Observed result

A fresh hosted compile reproduced the [QEMU reference](I80386-DPMI-HIGHMEM-QEMU-RESULTS.md)
client, linker-map and initial-media hashes exactly. The AT used its configured
4 MiB profile, repository free AT BIOS and LGPL VGA BIOS. Its firmware differs
from the QEMU control. The source-bound main-entry observation occurred at
step 44,609,970; the scenario completed at step 48,609,971.

| Predicate | Original AT observation |
| --- | --- |
| DPMI allocation request | 4,096 bytes; successful status |
| Returned linear address | 4,849,664; strictly above 1 MiB, requested span does not wrap |
| Selector readback | Base 4,849,664; exact limit 4,095 through CPU `LSL` |
| Owned far-pointer pattern | 256 bytes; checksum 4,225,408 |
| Simulated BIOS timer | 880 to 881; delta 1 at poll 19 of 262,144 |
| Exit and shell return | Exact owned output, zero-exit file and separate return file; no failure marker |

The strict whole-`.text` identity check remains **FAIL**: the source-bound
comparator reported 13 changed bytes in eight spans, first offset 23,760.
The separate narrower check reported exact expected/observed hashes for all
ten admitted owned code regions: `main` and nine wrappers, including base
readback and the `LSL` limit wrapper. Before/after observer fingerprints match.
This preserves the strict failure; it does not establish whole-runtime identity.

Initial result files were absent. At the main cut, HTOUT was exactly empty
from shell redirection; the other three result files remained absent. Accepted
Set-1 input preceded main entry. Two client-file snapshots at steps
45,609,970/46,609,970 agreed. A fresh pre-VERIFY fence at 46,609,971 retained
the same output and no return file. The separately accepted VERIFY sequence
ended at 46,774,971; its full command echo and current C: prompt were observed
at 46,950,000, with a later current prompt at 48,600,000. Return-file snapshots
at 47,609,971/48,609,971 agreed, and terminal media hashes matched the final
owned-file observation. The approved client output stayed byte-identical
through the pre-VERIFY fence and return.

All 184 bound source roles and 53 reachable JavaScript modules were unchanged
before/after execution. The original ZIP contains 108 members, including
107 inventoried files and the inventory itself. No second guest attempt was
needed.

## Timing and evidence limits

The synchronous post-reset scenario took 25.243 seconds wall time and
28.448523 seconds of process CPU time on a GitHub runner reporting an AMD
EPYC 7763 and four logical CPUs, Node 22.23.3/V8 12.4.254.21-node.57.
The reported deltas were 314,912,445 machine cycles and 48,605,737 CPU cycles.
The interval includes observations and grading, and excludes acquisition,
compile, media construction and machine construction. This is not calibrated
16 MHz hardware RTx, a paired performance benchmark or an improvement claim.
The different QEMU/AT poll counts are not a speed comparison.

Executable, terminal HDD and raw RAM bytes are intentionally absent from the
artifact. Independent audits checked retained owned file text/hashes, raw map
metadata, source identity, ordered input and prompt milestones, and the
source-bound snapshot reports; they did not independently reread raw guest
code or terminal HDD bytes. The exact CWSDPMI license notice is retained.

This qualifies this finite client on the stated AT profile: high **linear**
allocation, selector readback, pattern access, advancing reported BIOS ticks,
zero exit and shell return. It does not establish physical placement above
1 MiB, calibrated timer accuracy, `INT 31h` frame/IRET ownership, all DPMI
functions, strict 386 hardware equivalence, broad application compatibility
or consumer package adoption.

Next, develop passive, source-bound interrupt-entry and return observations
for the relevant DPMI services, with explicit frame/privilege facts and bounded
nonmutating reads. Keep each newly qualified mechanism separate from this
application/output result. See the [gate contract](I80386-DPMI-HIGHMEM-TIMER-PLAN.md)
and [active lanes](X86-NEXT-LANES.md).
