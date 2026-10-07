# Cold direct-RAM sampling results and next task

Updated 2026-10-07. The corrected [run 37619955001](https://github.com/CrispStrobe/bw-board/actions/runs/37619955001)
passed nine semantic children and retained six profiles, with complete direct
provider attribution. JavaScript reconciliation is the next narrow optimization
candidate. These diagnostic samples establish no speed improvement; ordinary
JavaScript remains default. The first URL-attribution limit and the following
timestamp-parser failure are preserved below alongside the completed result.

## First diagnostic: source and evidence

- Diagnostic harness: `97aff55fe60c4ac5506048a5a0c8863898389eb6`,
  [draft PR425](https://github.com/CrispStrobe/bw-board/pull/425).
- Qualified engine: `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`,
  [direct-RAM correctness evidence](I80386-COLD-DIRECT-RAM-RESULTS.md).
- Official artifact: [11480796452](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11480796452),
  `cold-direct-ram-sampling-37616446785-1`; ZIP 2,136,213 bytes,
  SHA256 `6aed3a75f0238d268214001c73d457b0c7871ca9214ce25b1e610fa6fd3ae491`.
- Host: AMD EPYC 7763, four logical CPUs, Node 22.23.3. This differs from
  the EPYC 9V45 host used by the earlier paired timing experiment.
- [Machine-readable receipt](receipts/2026-10-07-cold-direct-ram-sampling.json).

One unprofiled warm-up and two sampled children ran for each of direct native,
companion native and ordinary JavaScript. Root and a separate reviewer audited
the original ZIP independently, without importing producer helpers or replaying
the guest. All 120 artifact members matched the inventory. Source/build/config
bindings, child receipt hashes and six raw profile graphs and timestamps passed.
Compiled addon bytes are omitted; recorded addon hashes are build bindings,
not an independent rehash of retained binaries.

Native children matched full reset/last/final 166-word state, board state,
ordered PIO and the whole RAM hash. JavaScript children matched the common
architectural fields, board, ordered PIO and RAM. Each native child retained
316,562 N/Q, 16,524 resumes and clean closure. These finite cold-boot semantics
do not qualify protected-mode IRQ delivery, a complete OS or a general native
CLI/GUI backend.

## Attribution limit

V8 retained the direct provider's data URL as exactly 1,024 characters. The
decoded prefix contains only 747 bytes and fails the full loaded-provider SHA256
check. The original summary therefore assigns those JavaScript frames to its
unresolved bucket. Preserve that original result; its large unresolved fraction
must not be described as native CPU cost.

| Direct child | Total samples | Truncated data-URL leaves | Blank-URL leaves | GC | Other leaves |
| --- | ---: | ---: | ---: | ---: | ---: |
| Round 1 | 2,100 | 964 | 811 | 19 | 306 |
| Round 2 | 2,100 | 987 | 811 | 21 | 281 |

These are raw leaf categories, not authenticated function cost shares. Blank
native/builtin frames remain unresolved even when their ancestors are JavaScript.
Function labels alone cannot identify a native hotspot: the profiles include
blank leaves named `directStatus`, while the source calls that diagnostic after
the profiled execution interval. Sample intervals include profiling overhead
and do not equal execution CPU. No adoption timing or physical 16 MHz RTx was
computed. Unprivileged `perf` was unavailable with `perf_event_paranoid=4`;
host policy was left unchanged.

## File-backed follow-up and preserved parser failure

The file-backed repair was subsequently tested at
`0e3ea417241ee61c1598aa8a7f14d173678a62fb` in
[run 37618929164](https://github.com/CrispStrobe/bw-board/actions/runs/37618929164).
Its direct sampled child passed semantics and retained the exact provider file
with a complete URL and matching loaded-source hash. The parent then failed
because its parser rejected one raw timestamp delta of **−53 microseconds**.
Four children had completed summaries; the additional direct child retained a
passing receipt, but the full nine-child diagnostic did not finish.

Preserve this separate [failure artifact 11480674918](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11480674918):
ZIP 1,291,397 bytes, SHA256
`90b3ae3e1cb6f4842a4a635af503317478476b584e12d90d20da8268f84ad074`.
The original 1,168-sample direct profile contains that negative delta at index
1,160; its signed delta sum is 1,254,132 microseconds within a 1,254,723
microsecond window. Independently checked cumulative timestamps stay within the
window. File attribution is observed; complete corrected profiling is pending.

The parser correction preserves raw order, signed values and hashes. It
validates bounded signed deltas and every cumulative timestamp. For a
nonmonotonic timeline, it reports sample counts and marks all delta-weighted
bucket values and fractions unavailable; gross bounds violations are rejected.
It never clamps, drops or reorders samples to manufacture timing shares.
Wrong-file/hash, symlink, truncated-URL and blank-native-leaf controls remain.

## Completed corrected diagnostic

[Run 37619955001](https://github.com/CrispStrobe/bw-board/actions/runs/37619955001)
passed all nine semantic children at harness
`9198a522965ae35db4aff36aad63655b8a59b6fb`. The six retained profiles have
monotonic timestamps in this run; both direct profiles authenticate the complete
provider file URL and SHA256. Root and a separate reviewer independently checked
the original artifact, source/build/config/reference bindings, full guest
projections, closure and profile counts. Host: EPYC 9V74, four logical CPUs,
Node 22.23.3. This is a diagnostic result, not a paired adoption measurement.

Official [artifact 11481841500](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11481841500):
ZIP 2,136,786 bytes, 122 members, SHA256
`e054c45a996e15ca4f1373adbdf89e047eb1ee588e5c90c294654a8d4121cbaa`.

| Direct child | Total samples | JS reconciliation | JS clock callbacks | Native/builtin unresolved |
| --- | ---: | ---: | ---: | ---: |
| Round 1 | 1,469 | 597 | 87 | 618 |
| Round 2 | 1,467 | 566 | 102 | 591 |

Reconciliation is a focused optimization candidate. These categories are
samples in authenticated call paths, not exact CPU cost shares. They do not
separate empty from nonempty batches or identify a native implementation
hotspot from its function label. The ordinary JavaScript path remains default.

## Next bounded task

Inspect `scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs`. It copies
`board.generations` with `new Map(...)` during every reconciliation, including
empty journals. The actual owner counts record 282,652 successful commits and
91,958 journal entries. Since each nonempty commit requires at least one entry,
at least 190,694 commits were empty. This is a count bound, not Map-copy cost.

Prototype an empty-batch path that avoids this copy while retaining
`directDrain`, exact `directCommit`/ACK, session/epoch/phase validation and
nonempty overlay validation before mutation. Keep failure/reentry and pending
write adversaries. Qualify the changed provider against full cold guest state,
board, RAM, PIO and closure; then use the separate paired adoption gate. No
speedup is established until that gate passes. The clock-authority model and
paged IRQ source drafts remain separate unfinished work.
