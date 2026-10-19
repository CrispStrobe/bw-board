# Private per-word dispatch: native parity results

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

All three bounded native parity cells pass for the fixed free-ROM diagnostic. This qualifies the candidate's semantics for this fixture. It supplies no performance result or backend adoption.

The [source experiment](I80386-OWNED-DISPATCH-SOURCE-WIP.md) is frozen at `e7a6a4ab7f2bed32a5f6d0c81e35c04e1d16d759` (106 inputs). Its separate diagnostic runner integration is frozen at `2c688e69cae516b9749d70a126a3b474707d5cb7` (112 inputs). The compiled identity remains `fe1eff2039520536350922a2164c8bbe29404c68` (103 unchanged inputs); the original CI addon SHA-256 is `8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841`. The publication head is a separate identity.

## Actual cells

| Cell | Native trace | Host journal | Result |
| --- | --- | --- | --- |
| smoke-off | Off | Off | Exact stored state parity; empty journal |
| fulltrace-on | On | On | All 1,649,271 canonical rows and entire host journal match baseline |
| trace-fast | On | Off | All 1,649,271 canonical rows match baseline while exercising the null-sink dispatch branch |

Each cell ran once, sequentially, with no timeout or failed guest. The native child bounds were 120 CPU/wall seconds, 512 MiB heap, 256 MiB per output file, zero core files, nice increment 10, and five blank preload/profile environment hooks. All 223 artifact pins and both clean source identities were authenticated before and after execution.

Each cell matches the qualified baseline's entire stored reset/final/six-cut native snapshots: all 166 CPU words, descriptors, counters, physical-transfer fields, full board state, RAM hashes, and witnesses. All three have 445 resumes, 100,696 native ticks, and 100,694 successful quanta. The full capture-ON journal has 209,871 rows and reproduces the ordered 201,390 logical clock words. The trace-fast journal is empty; locked input `hostJournal: false` selects the literal-null-sink branch, whose complete CPU chronology is independently checked against baseline.

The scheduler returns ordinary full snapshot arrays for all 445 resumes. The archive stores reset, final, and six cuts; it does not contain 445 individually saved snapshots. JavaScript reference parity covers eight recorded CPU fields plus the existing exact EDX/CR0 core-profile policy, complete recorded board state, and the validated eight-byte reset RAM witness normalization. It does not invent missing JavaScript CPU fields.

Independent actual audits passed 397 checks for OFF, 1,649,680 for ON, and 1,649,669 for trace-fast. The [three-cell summary](receipts/i80386-owned-dispatch-parity-20261002/native-owned-dispatch-parity-prepared-20261002/independent-three-cell-summary.json) binds the individual audits and captures.

## Scope and next step

This is the original fixed IN8 free fixture, with two PIT IN reads. It is separate from the PIC IMR fixture results. No new build, AT boot, broader guest/broader game test, or paired performance gate ran here. Raw captures keep their original unqualified report status; external parity records qualify only this specific diagnostic.

The six held runner/admission support files are archived as byte-identical text receipts. Their absolute compiled-worktree import belongs to this local diagnostic setup, and they are not installed as a portable production backend or routine CI runner. The three-file provider experiment is published separately in the normal source tree.

Next: prepare and review a fresh alternating paired CPU gate against unchanged fe1, with the existing warmups and seven measured pairs. Adoption requires at least 10% lower mean process CPU and all seven pairs favorable. Do not retry the prior rejected allocation/bulk gates or combine their nominal gains. There is no new speed, physical 386DX RTx, or cumulative 10× claim.

## Retained evidence

The [SHA-256 index](receipts/i80386-owned-dispatch-parity-20261002/sha256.json) covers the source/control/admission records, bindings and helpers, original captures, bounded exits, logs, and independent audits. [External origins](receipts/i80386-owned-dispatch-parity-20261002/external-origins.json) bind lossless local originals. [External retention](receipts/i80386-owned-dispatch-parity-20261002/external-retention.json) records SHA-256 and size for large raw trace and journal streams kept locally. No private OS media or native binary is bundled.
