# Complete x86 lab integration — 2026-09-12

User authorized integrating the complete lab branch into upstream, not changing
Brickwright application pins or deploying the application.

Inputs are pinned: lab `bfa29bb5a8e2c2f66a61ac9703766256691fc8e8`, upstream
`fa20bb8c7051c665ab0d0c92c670b7c51f4edeb6`, common ancestor
`a7f4cd356952cdb3765b9febf56979e6ee48e9a2`. The histories contain respectively
100 and 227 commits absent from the other side. Merge rather than rebase keeps
published history and historical benchmark source identities intact.

Only LANES.md conflicted; both sets of claims were retained. No upstream
experimental-kernel source changes overlapped this work. Upstream contributes
display invalidation/caching, debugger run-loop improvements, replay/checkpoint
contracts and fixes, separate fetch observation, and injected optional cycle
timing. The timing API now requires the estimator argument; complete machine
checkpoints require version 2 rather than accepting old v1 state.

Integration fixes:

- Complete the browser harness for the incremental native source, including
  explicit memory, phase and bounded-schedule comparisons.
- Register all nine optional native test files in the upstream fixture census.
  This is owned differential testing, not an independent CPU oracle.
- Include file digests for environment-selected census inputs, matching the
  existing default-path behavior; add an environment-path regression test.

Validation at candidate preparation:

- Fresh clang build of all seven owned C sources passed with warnings as errors.
  Module SHA-256: `b77b2853641e886be5006d4b75d6c92c959ece4cb6a01b81609b35f20e8f31d0`.
- Chromium 150 accepted all native component oracles, including incremental
  memory (1,026 comparisons), phase (1,532 comparisons) and schedule (258
  periods), plus one round of reference/packed/layout memory workloads.
  Full source-hashed receipt: HARRIS-UPSTREAM-INTEGRATION-BROWSER.json.
- Census tests after fixes: 14 passed, no failures or skips.
- Full repository suite and hosted candidate CI are pending at this checkpoint.
  Initial full run caught the missing census registration; do not read that
  earlier run as an all-green result.

Experimental paths remain opt-in/default-off. The native prototype still has
no CPU or complete board runner. This integration does not establish 4.77 MHz
wired capacity, rerun the million-vector corpus, or repeat the long DOS boot.
Earlier pinned DOS and vector receipts remain historical evidence, not new
measurements of this candidate. No proprietary guest media is added.
