# Cold direct-RAM empty-journal correctness result

Updated 2026-10-07. [Actual run 37623392361](https://github.com/CrispStrobe/bw-board/actions/runs/37623392361)
passes the changed-provider cold workload at harness source
`74ed000b13800725c9f33baa1213ebaf84d3ded6` in
[PR427](https://github.com/CrispStrobe/bw-board/pull/427).
The unchanged qualified addon source is
`acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`.
**Correctness passed.** The separate [paired timing result](I80386-COLD-DIRECT-RAM-EMPTY-PAIRED-RESULTS.md) passes semantics but fails native adoption. Ordinary JS remains default.

## Change and observed result

An authenticated one-expression provider derivative retains the existing
`board.generations` Map when a copied journal is empty. Nonempty journals still
clone the Map and validate their complete staged overlay before mutation.
`directDrain`, exact `directCommit`/ACK, session/epoch/phase checks and native
clock/observer callbacks remain. The qualified provider and default are unchanged.

The fresh rebuilt ABI5 addon completes the same 316,562 N/Q, 16,524 resumes and
16,475 ordered PIO events. Root and a separate reviewer independently audit
all reset/last/final 166-word native state, full board, progress and accounting,
and every direct-report field except separately authenticated fresh build/config
admission metadata against the immutable original. Callback and companion
projections also agree. Audits replay all 91,958 journal effects from the complete
initial 16 MiB RAM, checking sequence, before/after bytes, generations, insertion
order, effect clocks and session/epoch. The final RAM SHA256 is
`af0c07fc87959f6481ab7611967ac40a2c8d3d5fa14beac0979cc99e95913f02`.
CPU, owner, provider and board close with no pending effect.

## Evidence and boundary

[Artifact 11483318041](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11483318041)
has 44 members, ZIP 4,314,643 bytes, SHA256
`260ed36433b3c5e02461cae3b1d6fcd05fd49e9b191bdf8093014a3a9b304b0f`.
The source manifest binds ten harness and 77 qualified runtime/media roles;
build admission binds the unchanged qualified addon sources. The original
three-arm reference reports are byte-identical to the retained original packet.
The addon binary is omitted; its hash is a fresh build binding rather than an
independent rehash from this ZIP. See the [summary receipt](receipts/2026-10-07-cold-direct-ram-empty.json).

The [sampling result](I80386-COLD-DIRECT-RAM-SAMPLING-RESULTS.md) motivated this
experiment but did not establish the cost of empty Map copies. The new
[source-bound paired run](I80386-COLD-DIRECT-RAM-EMPTY-PAIRED-RESULTS.md)
measures a 2.9052% mean execution-CPU reduction against the unchanged direct
provider, while the candidate still takes 5.4971× ordinary JS execution CPU.
The adoption gate fails. Retain this qualified oracle and stop the cold native
performance lane; prioritize measured functional-JS application costs. No 10x,
OS or physical timing claim follows from this finite correctness result.
