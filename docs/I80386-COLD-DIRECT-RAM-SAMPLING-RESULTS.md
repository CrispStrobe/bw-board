# Cold direct-RAM sampling: first actual diagnostic

Updated 2026-10-07. All nine children passed their semantic gates in
[run 37616446785](https://github.com/CrispStrobe/bw-board/actions/runs/37616446785).
The six retained V8 profiles expose an attribution limit that must be fixed
before selecting an optimization from their grouped results. This diagnostic
does not establish a speed improvement or change the default JavaScript path.

## Source and evidence

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

## Next bounded task

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

The next change must preserve raw order, signed values and hashes. Validate
bounded signed deltas and every cumulative timestamp. For a nonmonotonic
timeline, report sample counts and mark all delta-weighted bucket values and
fractions unavailable; reject gross bounds violations. Never clamp, drop or
reorder samples to manufacture timing shares. Retain wrong-file/hash, symlink,
truncated-URL and blank-native-leaf controls.

After frozen source review, run one new hosted diagnostic for this changed
instrumentation and independently audit its original artifact. Then select a
narrow optimization from authenticated samples or explicit counters. Empty
versus nonempty reconciliation and native callback costs remain unmeasured.
Any optimization needs affected guest parity followed by the existing separate
paired adoption gate. The clock-authority model and paged IRQ source drafts
remain separate unfinished work.
