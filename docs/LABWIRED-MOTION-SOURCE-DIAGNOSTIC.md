# Retained selected-motion diagnostic

This tooling prepares a diagnostic of the failed selected-motion qualification
at producer `0f78a4a873f3126c24717903ab09de1a34031c2c`, Core
`fa992f357df88dbd50057a31f13dbcc0835a95cd`, run `43191264877`.
Its functional checks passed, but all five windows failed the unchanged 1x floor.
No profile in that qualification establishes the bottleneck. Historical profiles
from another artifact cannot identify the cost of this one.

The route is manual and diagnostic only. Adding or testing it selects no run,
artifact acquisition, engine rebuild, qualification retry, release or pin change.
The original failure remains authoritative. Source or workflow qualification
still needs the repository's normal checks before merge.

## Retained-byte transfer prerequisite

The original motion job consumed **build A**, artifact `13932494417`, not build B.
Do not re-download that original. Locate the retained bytes and independently verify their acquisition/reference
provenance and exact content. Byte-identical engine files already
retained from a different release consumer may be used with their actual
provenance; they must not be relabelled as the later qualification archive. The
packet records byte equivalence to the independently named public release assets.
If no verified retained engine exists,
stop and resolve acquisition custody separately; do not substitute another release
or silently fetch the original through this workflow.

A separately recorded transfer run in this repository must publish exactly one
packet named `motion-source-retained-engine`. The workflow never creates this
transfer or selects its acquisition automatically. Its flat archive contains only:

- `engine-manifest.json`, a normalized retained-byte manifest (not producer BUILD-INFO);
- `nodejs/labwired_wasm.js`, `nodejs/labwired_wasm_bg.wasm`, `nodejs/package.json`;
- `CORE-LICENSE.txt` and `PRODUCER-LICENSE.txt`; retained Git-object copies are
  acceptable only when their bytes match the published source-notice digests;
- `transfer.json`, created only after the retained bytes and reference metadata are verified:

```json
{
  "referenceRun": 43191264877,
  "referenceArtifact": 13932494417,
  "referenceArchive": "sha256:eb032f56f4c3bc5ffcf7105767f342994c2a15c60d1a7488d4e273928fe72429",
  "retainedSource": {
    "kind": "byte-equivalent-release-assets",
    "tag": "labwired-wasm-fa992f35",
    "assets": {
      "nodejs-labwired_wasm.js": 727497991,
      "nodejs-labwired_wasm_bg.wasm": 727497995,
      "CORE-LICENSE.txt": 727497993,
      "PRODUCER-LICENSE.txt": 727497992
    }
  },
  "verifiedRetainedBytes": true
}
```

The normalized `engine-manifest.json` has `schema` equal to
`labwired.retained-byte-manifest.v1`, `ref` equal to the held Core commit, and
`targets.nodejs` entries for `labwired_wasm.js` and `labwired_wasm_bg.wasm`, each
containing the exact `bytes` and `sha256` from the independent retained-byte
verification. It makes no original-build timestamp or archive-ownership claim.
Keep the paired glue and notices. The admission script holds the exact
module, glue and source-notice byte sizes and SHA256s; a substituted build, edited
glue or missing notice refuses before loading the engine. The packet is bounded
to 64 MiB compressed and extracted, disallows extra/duplicate entries and symlinks,
and verifies the declared transfer archive digest before extraction.

The exported pure `validateRetainedMotionBytes` reader can verify a locally
retained packet on another Node version without executing glue. Its result is
explicitly byte-only; `validateMotionEngine` and the hosted CLI still require
Node 22.23.4 before runtime admission. Byte verification does not admit a runtime.

## One coordinated diagnostic

After normal tooling qualification and retained-input provenance checks, select `labwired-motion-source-profile.yml` at its reviewed source head. Supply
`transfer_run`, its exact `transfer_head`, `transfer_artifact`, the independently
verified `sha256:` transfer archive digest, and `custody_ack: true`. Defaults do not
assert the technical provenance checks; the acknowledgement records those checks,
not a request for additional operator authorization. The transfer must be a completed successful first-attempt
manual run in this repository; the original producer metadata must still bind the
failed first-attempt qualification and successful build A. Independently fetched
release metadata must also identify the published stable release and exact four
reference assets with their held sizes and digests; this reads metadata only. Original run/artifact
IDs are explicitly refused as transfer IDs. Metadata is read before any archive
GET; there is one transfer acquisition, never an original artifact GET.

The workflow pins Node 22.23.4, checks out the entire exact producer source in a
separate detached worktree and validates held harness/guest/adapter/bridge/profile
sources. The actual profiles execute from that held worktree, preserving transitive
source dependencies as well as the listed hashes. It runs parser and admission
controls, installs the guest compiler and records
the runner/source hashes. It then runs the unchanged motion workload in distinct
`trace-default` and `sampled-default` processes. Profile timing does not replace
ordinary timing. No forced-tier or A/B experiment is selected. The held GNU compiler/linker versions and source hashes are checked before
execution. Two independently compiled guests produced different full ELF hashes
because GCC embeds a random temporary object filename in the non-loadable symbol
string table. Independent Python and JavaScript readers verified the same ARM
entry/flags, load addresses, sizes, permissions, alignment and exact loaded bytes.
The diagnostic therefore requires their canonical load-image digest
`d0088c4b4f5be1d96e75c15c347c47d129369b5b1e49ce7c69388dd21b122cca`.
Any changed loaded byte or load header refuses. Each process's reported full ELF
hash must still match its actual retained compiled ELF. The historical original
full hash remains recorded separately; its ELF was not retained here, so no direct
comparison to its original load image is claimed.

The upload uses `always()` and retains metadata admission, transfer archive,
engine admission, runner/tooling details and whatever raw profile outputs exist.
Inspect failures as failures; do not rerun merely to obtain a preferred result.
A failure before either mode may leave no profile, which is not acceptance.

## Readback and next decision

Confirm metadata, source, transfer, module/glue, Node, held GNU versions and
actual guest full-hash/load-image joins.
Read both raw stdout/stderr streams and receipts and preserve the raw CPU profile.
Unsampled trace establishes compiler-tier behavior independently of sampling.
Sampled whole-process self shares include initialization, compilation, warmup and
measurement; they are attribution clues, not removable-cost percentages.

Only then choose a narrow semantics-preserving optimization candidate. Require
relevant correctness controls, actual-WASM differential behavior and ordinary
same-runner A/B/B/A before any fresh exact-source qualification. Preserve the 1x
floor and all functional observations. This diagnostic establishes no browser,
physical-accuracy or release result.

## Narrow source-policy admission

The registered first-introduction exception in `ci-tier-gate.yml` admits only
this diagnostic's exact eight-path/status set. It checks owned open PR identity,
unchanged head/base before and after complete API file enumeration, nonempty
counts, exact paths and initial addition/claim statuses. Mixed production, pin,
old qualification-workflow, unknown, renamed, removed, duplicate, incomplete or
API-error inputs refuse. Subsequent edits are not automatically admitted by this
first-introduction exception. Docs-only and existing full-label behavior for
unrelated changes remain, and no other job selector or qualification gate changes.

After scope admission the gate actually executes all four scope/diagnostic/
profile/parser control files; a nonzero test result fails the gate. Every other enabled fast check
still independently has to pass before merge. This is a bounded tooling policy,
not workload qualification or permission to add a full-tier label or dispatch.

## Lightweight controls

```sh
node --test test/motion-diagnostic-scope.test.mjs test/labwired-motion-source-diagnostic.test.mjs test/wasm-motion-profile.test.mjs test/motion-ab-receipt.test.mjs
actionlint .github/workflows/labwired-motion-source-profile.yml .github/workflows/ci-tier-gate.yml
```

These execute no engine or guest and download nothing. The scope suite tests the
actual gate shell through a fixture launcher that prevents only its own recursive
re-entry; the production gate runs all four complete suites without skips. They cover metadata
admission/refusal, held source identity and workflow wiring; real engine admission
and this manual workflow itself is not a workload qualification.


## Bounded diagnostic result (2026-11-12)

A separate source-bound Kaggle diagnostic ran with the retained equivalent
engine pair, held source, Node version and a source-built guest. Its independent
reader checked input identities, loadable-image digest, functional observations
and all retained outputs. The newly built ELF is not claimed byte-identical to
the unavailable historical original; the host also differs from the original
qualification runner.

All four diagnostic modes preserved the functional checks and stayed below the
unchanged 1x floor. The ordinary windows were 0.701–0.744x before sampling and
0.670–0.714x afterwards. In the whole-process sampled profile,
`CortexM::step_batch` accounted for 32.56% self samples, bus `read_u32` 10.12%,
`run_t16_fast_block` 7.14%, and `run_t16_cached_run` 5.97%. These shares include
more than the timed windows and do not establish removable costs.

Next, examine the actual CPU/bus execution path and its live IRQ and MMIO
semantics. Only adopt an optimization with source-level correctness controls
and actual-WASM differential evidence; then use a new bounded same-runner
A/B/B/A measurement before considering fresh qualification. Keep the original
failure and 1x floor; this diagnostic does not establish an improvement or pass.

## Countdown workload hypothesis

The retained four diagnostic modes each recorded 1,911 completed scans between
successive steady 64-million-cycle samples. The authored scan source contains
five rows, each with a 2,048-iteration `SUBS`/`BNE` delay. Multiplying completed
scans by that source shape estimates 39,137,280 delay instructions per steady
window, about 61.2% of the numerical cycle budget. Scan boundaries can straddle
windows; this is not a measured retired-instruction count, execution-time share
or proof that the countdown fast path fired.

The retained Core revision already contains a cached Thumb countdown path. Its
entry depends on the normal decode-cache, batch-budget, observer, interrupt,
debug, IT-state and scheduler-deadline guards. The retained diagnostic did not
record its hit count or peripheral tick interval. A complementary opt-in
counter and paired control should measure those facts on the same bound source
and inputs, without removing or bypassing any guard. Preserve the original
failed windows and 1x floor; independently verify outputs and avoid interpreting
whole-process profile samples as per-instruction savings.

## Retained profile timeline and countdown boundaries

A second offline reading divided the existing 7,619-sample, 8.52-second
whole-process profile into four equal cumulative sampled-time quarters. The
named Cortex-M `step_batch` leaf accounted for 26.7%, 33.6%, 34.0% and 35.9%
respectively; the fast-block and cached-run leaves were still represented in
the last quarter (8.5% and 6.7%). The named bus accessor is 7.6%, 11.9%,
10.9% and 10.1%. These are weighted sampled leaf-frame shares, not exact
exclusive times or per-window measurements. The four portions are not aligned
with guest measurement windows. No named countdown leaf was sampled; inlining
and sampling prevent concluding that countdown did not execute. This single
instrumented profile neither establishes a cause nor measures an improvement.

The held Core source gives the counter experiment a more precise scope. The
64,000-cycle adapter request is not the countdown's effective instruction
budget: normal machine planning can clamp at a peripheral tick boundary or a
scheduled event, and a pending wake can narrow the CPU's remaining budget
again. The recommended tick interval is conditionally 1,024 or 1; the actual
selected interval and distribution of effective budgets remain unmeasured.
Cached countdown admission needs at least eight remaining instructions and the
`SUBS` entry. Odd retirement can leave the program counter at `BNE`, so both
entry alignment and remaining-budget parity deserve observation.

Existing countdown controls compare arithmetic, interrupts, cache invalidation,
observers and machine tick intervals, but their scheduler-budget test does not
itself schedule an event. Before changing this path, add differential controls
for both entry PCs and remaining budgets 7, 8, 9, 15, 16 and 17, with separately
exercised scheduler-heap and newly armed pending-event boundaries around offsets
0, 1, 7, 8 and 9. Compare CPU state, retirement, clock and event/IRQ delivery
with the ordinary interpreter. These are proposed controls, not results. Retain
all guards; neither the profile nor the source estimate justifies changing the
1x floor or claiming an optimization.
