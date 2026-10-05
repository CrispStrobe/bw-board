# Discovery census: hot negative hits, not measured generation churn

This is **measurement-only**, not a speedup or ordinary RTx qualification. Production remains `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`; engine diagnostics `1b044ea97d2a72c43f1b15a147d64a479620f0ee` and capture tools `82e5661fffbfcc8c12ecc8845475d4214c1f10e4` remain unmerged. Native policy, deployed/app pins, all seven physical captures/acknowledgements and their expiry are unchanged. Hardware recapture remains owed; all-target ≥1× / CP13 stays open.

## Actual measured frequency

[Shared-guest run 37203818623](https://github.com/CrispStrobe/labwired-core/actions/runs/37203818623) passes every enabled job. One unchanged source-built motion ELF is supplied byte-for-byte to all three captures. All **15 guest observation windows** agree; both independently built diagnostic engines produce **identical five-window counter sets**. Both NODEJS and web diagnostic build bytes agree on the hosted runner. Each window is 64M guest cycles after the original 8M-cycle warmup, original poses, budgets and guest assertions. Only the generated diagnostic timing-floor assertion is removed; ordinary harness files remain untouched. No timing here replaces the frozen ordinary ABBA/BAAB harness.

| Counter, five warmed motion windows | Exact count |
| --- | ---: |
| Fast-block calls | 61,614,846 |
| Negative memo lookups | 61,542,607 |
| Exact PC/current-generation hits | 61,423,781 |
| Same-generation different-PC collisions | 94,901 |
| Empty-slot lookups | 23,925 |
| Discovery compiler attempts | 95,669 |
| Successful discovery / positive reuse | 23,920 / 72,239 |
| Decode insertion / clear / generation wrap | 0 / 0 / 0 |

The existing 64-slot memo already hits **99.80692% of negative lookups**; same-generation collisions are **0.15420%**. Both stale-generation classes are zero, every window ends at generation 175, and no overflow occurs. These are **occurrence ratios, not wall-time shares or removable cost**. Positive reuse/discovery and executed-operation counts are different units; do not treat calls as retired instructions.

This does not support hot generation churn in this selected warmed motion workload, and it does not justify blindly repeating larger capacities. The previously rejected 1,024-slot experiment remains rejected. A defensible next hypothesis is a cheaper frequent exact-hit/early-return path, preserving positive-block precedence, exact PC/generation keys and stale-block clearing. Its cost and any speedup remain unmeasured. First extend the census to F0 RAM/GPIO; this motion result is not evidence about those targets or every chip.

## Correctness, source and provenance

[Original build run 37201401969](https://github.com/CrispStrobe/labwired-core/actions/runs/37201401969) passes native correctness: six new diagnostic tests, default focused 12+12, default library 4,234, diagnostic library 4,240 (three existing ignored in each full library run), feature-off-scheduler diagnostic focused 15, and GPIO integrations 8+4+2+2. All three original WASM build stages and all **108 integrations per engine**, including seven actual same-PC RAM/MMIO proofs, pass. Its overall workflow still **fails** at the pre-window capture tool, described below. Built engines are reused only on GitHub, without another native test/build cycle.

Instrumentation is a fixed-size per-CPU twenty-counter structure behind the explicit, default-off `t16-discovery-census` feature. Begin/end affect recording only, not decode caches, architecture or snapshots. Counts export as decimal strings with overflow detection. Enabled-only CPU capability methods/Box forwarding avoid new downcasts; the ratchet is unchanged. Diagnostic vtables gain capability methods only when explicitly enabled. Source contracts and reversible zero-context patches reconstruct every original CPU/test/WASM/manifest/trait body byte-for-byte. This is a source-policy proof, not binary-identity proof.

Control module SHA-256 is `c8256e56cc5817fc0185489d2a0d2a81aa128fe4ab91d71c3d683557a2f8d9b3`, diagnostic module `1d050dd19daed3864caf9eb7340f9bb463a4eff9a23f41f48137ad306416d6d4`. The feature-off control **is not byte-identical to the prior production module/glue**; causes are not isolated. Do not assert unchanged production binary, native ABI or compare these instrumented/control timings as ordinary performance. The shared guest ELF SHA-256 is `495df37ce52a61bc27488ce0152a325b49dea5a06e9eda0b625a95dff37f7934`; its complete bytes are retained in the bound original manifest, with source/linker hashes, compiler and exact original flags.

## Failures retained, not waived

1. [37200722140](https://github.com/CrispStrobe/labwired-core/actions/runs/37200722140) genuinely fails the unchanged downcast ratchet: two new WASM accessor downcasts exceed 274. A later source commit replaces them with feature-gated capabilities; old failure stays a failure.
2. [37201401969](https://github.com/CrispStrobe/labwired-core/actions/runs/37201401969) genuinely fails the pre-window capture transform: a statement occurs twice. No census window ran. Exact frozen source hashing and a unique timing-window context fix the separate tool; build/integration successes do not reclassify the failed workflow.
3. [37203284967](https://github.com/CrispStrobe/labwired-core/actions/runs/37203284967) captures all 15 windows but fails strict guest ELF hash equality. Numeric observations and diagnostic counters agree, yet original ELF byte equivalence is **not established**, and the cause was not proved from the unretained ELFs. Those original windows stay archived/unqualified. The corrective shared-ELF run enforces identical input bytes; it is not a rerun to obtain favorable timing.

A separate read-only observer stops because `gh run view --job --log` withholds logs until the parent workflow finishes. That error and its old state are retained; a distinct resumed observer retrieves completed-job logs via the job API. No engine workflow is rerun for this monitoring correction.

## Portable evidence

[manifest.json](manifest.json) binds **70 original/lossless members**: every failed/successful job log, original observer states/correction, contracts, original/source/tool files and reconstruction patches. Wrappers preserve trailing whitespace, CRs and missing final newlines exactly. [analysis.json](analysis.json) derives the frequency summary from all five accepted diagnostic windows. Local portable checks reparse original logs/manifests and reproduce counts/source reconstruction; full binary comparisons and engine execution remain hosted.

Run `node --test test/wasm-discovery-census-evidence.test.mjs` for six checks. Four pure transform tests separately pass without loading any engine. Large originals/archive staging live on CIFS `/mnt/storage`; sparse working Git on `/mnt/volume1`. No local builds, emulation, benchmark execution or engine downloads; legacy `/tmp` is only a compatibility symlink. No physical acknowledgement update or source promotion is implied.
