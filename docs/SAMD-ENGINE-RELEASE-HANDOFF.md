# SAMD engine producer handoff — updated 2026-10-28

[PR711](https://github.com/CrispStrobe/bw-board/pull/711), branch
`lane/samd-engine-producer-20261026`, head `8ea3767903d5135f4bd1e74914e25663b530d502`,
is **open and unreleased**. It now pins the qualified Core commit
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
  qualification). It was still running at this checkpoint.

## Open tasks, in order

1. **Read the result of campaign 40699886470.** Do not dispatch a duplicate while
   it runs. If it failed, read only the failed job logs, keep them, and diagnose;
   do not rerun the whole campaign blindly. If it passed, continue.
2. **Check PR711's exact-head checks** at the final head
   (`gh pr view 711 --repo CrispStrobe/bw-board --json headRefOid,statusCheckRollup`).
   Every enabled check must be SUCCESS; only declared skips are allowed. A failed
   job caused by a network/installer timeout may be rerun once (`gh run rerun
   <run> --job <job>`), keeping the original log.
3. **Audit the campaign before any publication.** Download each artifact of the
   passing campaign once (admit run/job/artifact metadata first). Independently
   check: both builds byte-identical; `BUILD-INFO.json` binds Core `3b655aef…`
   and the producer head; config/profile assets present; legacy suite count not
   below the existing floor (118); the three SAMD game instances (raw frames and
   press/release). Record SHA-256 of engine `.wasm`, glue, profile, BUILD-INFO.
4. **Publish an immutable release from those exact bytes.** `publish=true`
   rebuilds and releases before external audit, so do not use it for this. Create
   a new release tag (refuse if it already exists) and upload the audited flat
   assets unchanged, with loader markers, profile and BUILD-INFO. Bind the release
   notes to the producer head, full Core SHA and campaign run. Never replace an
   asset or relabel old bytes.
5. **Merge PR711** normally with `--match-head-commit <final head>` after task 2;
   verify parents and that the landed tree equals the tested tree. Record the tag
   and asset SHA-256s in the
   [Lite handoff](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/SAMD-NATIVE-GAME-HANDOFF.md).
6. **Deferred: motion qualification.** When the operator asks for it, dispatch one
   campaign with `qualify_motion=true`. An `INCONCLUSIVE_RUNNER` result means the
   job landed on an EPYC 7763; rerun only that job (it is not a regression). Keep
   the 1× floor.
7. **Deferred: remove the V8 workaround** once the Node 22 line no longer
   crashes, or once the suite moves to Node 24. Re-verify radio-pair without the
   flag; record the result.

Node results do not qualify Chromium, an installed package, physical hardware or
real-time gameplay. Private paths and operational receipts never go into public
Markdown, release notes or workflow inputs.
