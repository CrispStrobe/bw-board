# WASM bounded cached runs: measured, app artifact unpromoted

[Core PR 146](https://github.com/CrispStrobe/labwired-core/pull/146) extends the
landed scalar executor to at most 16 retirements, also bounded by the machine's
scheduler budget. Every live PC/tag/width is rechecked; unsupported, cold,
collided, T32, MMIO and unmapped entries stop before retirement. Native dispatch
and existing debugger/observer/IRQ/IT/cycle-accounting guards are unchanged.
Honored breakpoints force instruction-sized machine windows and cannot enter
this path, whose caller requires at least eight remaining instructions.

## Ordinary exact-artifact A/B/B/A

The baseline build is `faa39978923f96abe65706407f04d4af63e33857`, whose tree
matches landed scalar main `c05e8de37f8837148c3066c5e5f1d715a6dbd0f8`.
The first two comparisons measured candidate build
`8562db36f1598dff93653b96d627de4e0d12eb0c`; the third measured the fixed
source `2f5d9355fc5764fde460252ae04bf13d62902bf6`.
Each engine uses its own unmodified original glue, under the harness's explicit
paired-glue policy; the two glue hashes differ. The harness, guest/compiler
invocation and every-window floor are unchanged.

| Hosted run | CPU | Scalar median / min | Bounded-run median / min | Median change |
| --- | --- | --- | --- | --- |
| [36885715368](https://github.com/CrispStrobe/bw-board/actions/runs/36885715368) | EPYC 9V45 | 1.340460 / 1.307328 | 1.450850 / 1.428779 | +8.24% |
| [36886507617](https://github.com/CrispStrobe/bw-board/actions/runs/36886507617) | EPYC 7763 | 0.762856 / 0.736076 | 0.817407 / 0.794122 | +7.15% |
| [36891599325](https://github.com/CrispStrobe/bw-board/actions/runs/36891599325) | EPYC 9V45 | 1.439504 / 1.364306 | 1.578422 / 1.546370 | +9.65% |

Within each comparison both engines ran on one runner, with all cycle-indexed
guest observations equal across all four runs. All twenty first-run windows
passed 1×; all twenty repeat windows failed; all twenty fixed-artifact comparison
windows passed. Do not compare absolute rates across
hosts, infer every-window gains from medians, or override fresh qualification.
ELF file hashes remain provenance, not equality: GCC embeds random temporary
object names in non-loaded symbol metadata.

[Primary raw outputs/samples](primary-abba.json), [runner](primary-runner.txt),
[baseline provenance](baseline-build-info.json), [candidate provenance](candidate-build-info.json),
[repeat raw outputs/samples](repeat-abba.json) and [repeat runner](repeat-runner.txt)
are retained unchanged. [Selected profile fields/hashes](profile-extract.json)
are an extract, not the complete raw traces/CPU profiles; those remain in the
primary run's uploaded artifact and local evidence. Profiles follow ordinary
A/B and include initialization/warmup. Their timing and self shares are not
ordinary qualification or automatically removable overhead.

[Fixed-artifact raw A/B](fixed-abba.json), [runner](fixed-runner.txt) and
[build provenance](fixed-build-info.json) preserve the third comparison.

## Additional ordinary VPS comparisons

Node v20.20.2, Intel Xeon Skylake (IBRS, no TSX), four visible vCPUs;
shared-host CPU availability is uncontrolled. These are not hosted Node 22
qualification or browser/UI tests. Both use the exact fixed candidate module.
The retained VPS baseline artifact was built from `273e683e`; its actual WASM
SHA256 `9f0720afcbae2074e7a372bf332bdacd00d258fffa4bfb8b72caaace346d0258`
matches the landed scalar baseline used above. Original paired glue is preserved.

| VPS comparison | Scalar median / min | Bounded-run median / min | Median change |
| --- | --- | --- | --- |
| First | 0.418424 / 0.358754 | 0.456904 / 0.424472 | +9.20% |
| Repeat | 0.421845 / 0.393812 | 0.464289 / 0.427517 | +10.06% |

All cycle-indexed guest observations matched within each A/B/B/A; all forty
windows failed 1×. [First raw receipt](vps-abba.json),
[repeat raw receipt](vps-repeat-abba.json), [baseline build provenance](vps-baseline-build-info.json)
and [runner/tool fingerprints](vps-runner.txt) preserve their distinct provenance.
Do not compare absolute RTx across hosts or Node/compiler versions.

## Fresh qualification and correctness

[Candidate build 36883581882](https://github.com/CrispStrobe/bw-board/actions/runs/36883581882)
passed both builds and determinism. Selected motion functionality passed, but
every fresh timed window failed 1×: **0.979751× median / 0.951531× minimum**.
[Raw output](qualification-stdout.txt), [runner](qualification-runner.txt) and
[build provenance](qualification-build-info.json) are retained. All 101 actual
WASM integration tests passed with zero skips; publication was skipped because
the unchanged performance floor failed. The
[fixed-source build 36888339538](https://github.com/CrispStrobe/bw-board/actions/runs/36888339538)
also passed independent builds, determinism and all 101 actual WASM integration
tests with zero skips. Its fresh qualification failed every 1× window:
**0.834235× median / 0.808772× minimum**.
[Fixed qualification output](fixed-qualification-stdout.txt),
[runner](fixed-qualification-runner.txt) and
[provenance](fixed-qualification-build-info.json) retain that failure. Publication
remained skipped; the passing same-runner comparison does not override it.

The strengthened test head `2dcf61b5` passed 12 targeted local event-scheduler
tests, zero failed/ignored, including all 65,536 halfwords under three flag
states and exact mixed-run retirement counts, branches, live RAM and barriers.
The full local suite found 4,233 passed / one failed / three ignored: a mid-file
test-only wrapper made the existing source scanner skip later production code.
Head `2f5d9355` removes that wrapper and invokes the same run primitive directly
with budget one. The source audit then passed against the fixed file, without
changing the audit/allowlist. The rebuilt full suite at `2f5d9355` then passed
**4,234 tests / zero failures / three existing ignored tests**, including the
unchanged audit. The first fresh fixed-head build has identical executable WASM
sections and original candidate glue, but is **not byte-identical**: 26 data
bytes differ, consistent with shifted logging/source locations after removing
the wrapper. The two independent fixed-head builds are byte-identical to one
another, with WASM SHA256 `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`.
Independent determinism, integration and ordinary A/B of the exact fixed artifact
have now passed; its fresh realtime qualification failed as recorded above.
Do not silently
transfer the old artifact's qualification to the new module hash. The
[section hashes and every differing byte](fixed-module-comparison.json) retain
that comparison against build leg A of run 36888339538.

The user explicitly approved re-stamping the same seven content-bound hardware
drift acknowledgements after verification. Existing 2026-10-01 dates,
2026-10-31 expiry and all physical capture evidence remain unchanged; live
re-capture remains owed. The update changes only those seven digest fields and
review comments, not unrelated stale acknowledgements. The
[core PR](https://github.com/CrispStrobe/labwired-core/pull/146) records the
authoritative current head, final CI verdicts and merge status. Core landing
requires all 19 enabled final-head checks to pass, not just the required subset.
No app pin promotion or completion of CP13 is claimed.

## CI queue incident and landing safeguard

After the approved acknowledgement update, the final-head local suite again
passed 4,234 tests / zero failures / three existing ignored tests, and the
drift/staleness check passed. The
[GitHub Actions incident](https://www.githubstatus.com/incidents/2dpbcq5j165n)
coincided with prolonged unassigned runner queues. Final review head
`d10aa88255fd1e093cc1f424c26260341c9322fa` pins PR/control CI lanes to
`ubuntu-24.04`, the same OS verified in completed job 110487130156; this is a
queue-workaround attempt, not a proven fix. Nightly/full/image lanes, test
commands, floors, features and cache policy are unchanged. Its strict workflow
regression suite passed 42 local tests and actionlint passed. Runtime source
and the seven acknowledged model digests did not change.

The guarded landing command waits for every enabled check, refuses changed
head/base references and stops on failures or timeout. Its local guard tests
are not GitHub CI evidence. It publishes no WASM release or app pins. Use the
core PR's actual verdict/merge record, not this queued-run description, to
determine whether landing has completed.
