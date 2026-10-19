# Production WASM CPU hotpath inspection — static evidence only

This inspects the original production core `43b2d62f5a0fa24ae0b38a645069f5aaa78af685` from independent build 36915940413. No source optimization, engine execution, tier forcing, extra optimizer or timing measurement occurs. Original module/glue hashes and byte lengths are verified before hosted disassembly. Engines and full-module WAT stay on the runner.

## Findings and limits

The original `step_batch` body has 36,294 WAT lines: 7,673,574 formatted bytes, but 495,684 bytes after removing whitespace for analysis. `run_t16_cached_run` has 14,516 lines: 7,252,781 formatted bytes, but 169,856 non-whitespace bytes. **Formatted text size is not binary size or runtime cost.** Original whitespace is retained losslessly in the evidence.

Cached-run contains 109 static branch tables: 107 with 18 targets, one with 16 and one with 84. Eighteen targets fit the source's generic 17-register match plus default; this is an inference, not proof that every such table is a register access. Static counts do not establish hit frequencies, compiler-tier behavior, removable cost or performance causality.

Combined with the earlier warmed-window profiles (batch 22.30–31.75% self time; cached-run 16.39–21.55%), this suggests a future isolated experiment sharing register helpers rather than repeatedly expanding them. It is not a measured speedup or permission to alter register semantics. Native dispatch, observer/debug/IRQ/IT/timing barriers, live memory checks, production engine/app pins and physical acknowledgements remain unchanged. All-target ≥1× / CP13 remains open; hardware re-capture remains owed.

## Original failures and final capture

Initial run [37140820456](https://github.com/CrispStrobe/bw-board/actions/runs/37140820456) exceeded the unchanged 2 MB selected-JSON bound. Removing the full interpreter in [37141895222](https://github.com/CrispStrobe/bw-board/actions/runs/37141895222) still exceeded it. Explicit metadata plus lossless bounded text chunks in [37142255303](https://github.com/CrispStrobe/bw-board/actions/runs/37142255303) exposed a further total-text limit: including the optional fast-block body would retain over 16 MiB. All three original failed runs, logs, provenance and diagnostic sizing are preserved; none was converted to a pass.

Final run [37142446921](https://github.com/CrispStrobe/bw-board/actions/runs/37142446921), exact tool `ad05b8ec01309dba79e7cf9435c6b0b5424d50fc`, succeeded with exactly the two measured roots. Their 14,926,355 original bytes fit the 16 MiB total bound; each body chunk is at most 512 KiB, metadata stays below 2 MB, and the compressed receipt stays below 4 MiB. Required roots, types, original source/module/glue identity, every chunk/body hash and length, and reselected call/memory/type metadata are independently verified. The default full-body JSON selector still rejects oversized selections.

[Tool PR #320](https://github.com/CrispStrobe/bw-board/pull/320) merged as `f0bff66711d5bdef392b783351a6386482581b72` after all eleven enabled checks passed, plus two intentional `vectors-full` skips. This lands diagnostic tooling, not an engine optimization.

## Reproduction

The [manifest](manifest.json) binds all 76 original/losslessly wrapped members by SHA-256 and size, including failed/successful captures, original body chunks, analysis, tool sources, capture controllers and exact merge proof. Wrappers preserve original chunk boundaries, carriage returns and missing trailing newlines. A recorded non-operative branch-label typo in the earlier read-only capture controller does not change actual pinned run/tool/source/artifact identities.

Run `node --test test/wasm-cpu-hotpath-evidence.test.mjs test/wasm-cpu-inspection.test.mjs` from the repository root. These portable checks validate original bytes, reassemble/reparse the selected text, reproduce static counts and enforce original failure/merge evidence. Synthetic guard fixtures are not engine or timing evidence. Do not restart completed controllers or reinterpret these receipts as qualification.
