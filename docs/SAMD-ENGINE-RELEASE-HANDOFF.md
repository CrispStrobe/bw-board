# SAMD engine producer handoff — 2026-10-27

[PR711](https://github.com/CrispStrobe/bw-board/pull/711), producer candidate
`6ce48e90526c3aeef6d4a5eb46836a7015ebf8f3`, is prepared but unqualified and
unreleased. Continue the existing SAMD claim in `LANES.md`, preserving other
lanes. No new Core pin, engine campaign or immutable release is complete.

Portable profile/config packaging, two-leg determinism and a source-built Node
game gate are prepared; six focused metadata/refusal controls passed.
[Old source CI](https://github.com/CrispStrobe/bw-board/actions/runs/40398169420)
failed fetching the pinned ngspice47 archive at 60 seconds, before build/oracle
execution. Preserve that original. It establishes no solver/SAMD regression;
do not rerun the obsolete head simply to get green.

## Ordered completion

1. Complete the [Core handoff](https://github.com/CrispStrobe/labwired-core/blob/main/docs/engineering/samd-software-profile-handoff.md).
   Update `scripts/build-labwired-wasm.mjs`'s `PIN` to the full qualified landed
   Core commit. Do not pin an unmerged candidate or silently move other pins.
2. Integrate current master normally, run focused profile checks and require
   every enabled exact-head producer check. Final-pin CI is the next meaningful
   installer/oracle attempt. Diagnose repeated setup failure separately; retain
   all numerical bounds and original failures.
3. Freeze the producer head. Dispatch `.github/workflows/labwired-wasm.yml` once
   from that producer branch with `ref=<full-qualified-Core-SHA>`,
   `publish=false`, `retained_build=false`, `qualify_motion=true`. Verify the
   resolved run head. Both independent builds, determinism, the complete legacy
   suite, five motion windows and three actual Node game instances must pass.
   `retained_build=true` is the historical A10 pair, not a generic new-pair path.
4. Admit complete official run/job/artifact metadata before acquiring originals
   once. Independently join both engine/config builds, BUILD-INFO source/target
   bindings, guest/compiler/notices, raw frames and actual press/release. Keep
   the legacy count floor, thresholds and assertions unchanged.
5. Audit **before publication**. `publish=true` automatically releases after its
   own gates and lacks this external admission step. Publish the exact retained
   assets without rebuilding: use a separately reviewed guarded retained-pair
   path, or stage those same flat assets and create a normal immutable release.
   Refuse an existing tag; bind the release to the qualified producer, full Core
   source and original campaign, with reviewed hashes. Include loader markers,
   profile and BUILD-INFO alongside engine/glue. Never replace an asset or
   relabel old bytes as new.
6. Merge only the qualified producer head, proving parents/tree. Record the
   immutable tag and actual asset SHA256s for the
   [Lite handoff](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/SAMD-NATIVE-GAME-HANDOFF.md).

Node results do not qualify Chromium, an installed package, physical hardware
or real-time gameplay. Consumer actual-guest acceptance remains mandatory.
Local paths and operational receipts belong in the ignored local handoff,
not public Markdown, release notes or workflow inputs.
