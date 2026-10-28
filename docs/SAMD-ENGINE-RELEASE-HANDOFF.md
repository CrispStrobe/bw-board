# SAMD engine producer handoff — updated 2026-10-28

[PR711](https://github.com/CrispStrobe/bw-board/pull/711), branch
`lane/samd-engine-producer-20261026`, head `8ea3767903d5135f4bd1e74914e25663b530d502`,
is **qualified, merged and released**. The normal merge is
`1f92a1aa85e808827a4c28b219bf11a572f07882`; parents and predicted tree were
verified. The composed main changes were four Markdown files only; executable
bytes matched the qualified head. It now pins the qualified Core commit
`3b655aef4085082152129c84849d4e2ad5004a7f` (see the
[Core handoff](https://github.com/CrispStrobe/labwired-core/blob/main/docs/engineering/samd-software-profile-handoff.md)).
Continue the existing SAMD claim in `LANES.md`; do not open a second producer PR.
The PR carries the `ci:full` label on purpose (one full run before release).

## What changed on the branch

- `scripts/build-labwired-wasm.mjs` `PIN` → `3b655aef…`; `src/labwired-catalog.js`
  regenerated from that commit (18 chips, 8 boards) with `scripts/gen-labwired-catalog.mjs`.
- `test/labwired-motion-workflow.test.mjs`: the publication truth table now covers
  the `samd-game` prerequisite (1250 combinations, hyphenated job id evaluated with
  bracket access). Removing the `samd-game` clause from the workflow fails it.
- `.github/workflows/labwired-wasm.yml`:
  - all jobs use Node `22.23.4` (was floating `22`);
  - the suite step runs `node --no-turbo-inline-js-wasm-calls --test …` because
    Node 22's V8 crashes (Deoptimizer fatal, "unreachable code", not an assertion)
    in `test/labwired-radio-pair.test.mjs` with the current engine when it
    inlines JS→WASM calls. Reproduced locally: passes with that flag, on Node 24,
    and with the previous engine. This is a workaround for a V8 bug, recorded on
    purpose; it is not a fix in the engine;
  - the motion job prints runner provenance and fails with `INCONCLUSIVE_RUNNER`
    on AMD EPYC 7763 hosts before measuring. On those hosts both the previous and
    current engine run below 1× wall clock; a same-runner A/B on a faster host
    ([run](https://github.com/CrispStrobe/bw-board/actions/runs/40637093243))
    measured previous 1.363× vs current 1.340× median. The 1× floor is unchanged.

## Campaign history (retain all failures)

- [40622298917](https://github.com/CrispStrobe/bw-board/actions/runs/40622298917)
  (two attempts) and [40649541286](https://github.com/CrispStrobe/bw-board/actions/runs/40649541286):
  builds, determinism and SAMD game passed; motion 0.71–0.74× on EPYC 7763; suite
  crashed in V8 as above. Not engine regressions.
- [40625353959](https://github.com/CrispStrobe/bw-board/actions/runs/40625353959):
  diagnostic only, previous pin `de14721`, `rev=diag-baseline`; passed, motion
  1.42–1.49× on an EPYC 9V45 host. Never use it as a release.
- **[40699886470](https://github.com/CrispStrobe/bw-board/actions/runs/40699886470)**:
  the current campaign at head `8ea3767`, `ref=3b655aef…`, `publish=false`,
  `retained_build=false`, `qualify_motion=false` (the operator deferred motion
  qualification). It completed successfully: both builds, determinism, the125-test suite and three actual Node game instances passed; motion/publication were declared skips.

## Completed release checkpoint — 2026-10-28

[Immutable release `labwired-wasm-3b655aef-locked`](https://github.com/CrispStrobe/bw-board/releases/tag/labwired-wasm-3b655aef-locked)
contains the exact retained campaign assets, without rebuilding. All nine
uploaded asset SHA-256s were checked against the admitted bytes before publishing.
Core/producer licences and the original profile notices are retained. The API
confirms `immutable: true`. The earlier unlocked tag `labwired-wasm-3b655aef`
is preserved unchanged; consumers use the locked tag above.

Independent offline review verified both build rosters and bytes (only build
timestamps differ), all source/profile bindings,565 guest-file bindings,51 raw
RGB frames across three instances, actual press displacement/release stop, and
125 suite tests with zero failures/skips. Five altered-input controls were
rejected. This qualifies those observed boundaries only.

| Consumer asset | SHA-256 |
|---|---|
| web glue | `a29729658f267617e7d2539d756bd4dbe0662b25768348ecaeab723a9b032e1f` |
| web/Node WASM | `1ad2947b99df8a13fce29c9240a79c61fb66e4d57ede26ca50880f141f3e3978` |
| SAMD profile | `0fe1e72ae684153696efbca5874d2633007b92a9c9144f38cd62fdd28d030750` |
| Node glue | `747cb78d8118854e87ff728c10c24710d7302c55871d920c2784537afd1f965d` |

## Remaining tasks, in order

1. Complete [Lite adoption](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/SAMD-NATIVE-GAME-HANDOFF.md)
   using this tag and the exact hashes above. Proposed isolated branch
   qualification is coordinated with the native-package owner; main pin
   publication still requires that coordination. Fresh actual Chromium and
   installed Tauri/WebKit acceptance remain mandatory. Do not rebuild or replace
   this release to inspect it.
2. **Deferred motion qualification:** when requested, dispatch one campaign with
   `qualify_motion=true`. Retain the1× floor; an `INCONCLUSIVE_RUNNER` result
   preserves the host limitation rather than qualifying performance.
3. **Deferred V8 workaround removal:** once Node22 no longer crashes, or the
   suite moves to Node24, re-verify radio-pair without the narrow inlining flag.
   Keep the original crash and fixed-source receipts.

Node results do not qualify Chromium, an installed package, physical hardware
or real-time gameplay. Private paths and operational receipts never go into
public Markdown, release notes or workflow inputs.
