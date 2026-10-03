# Cold-BIOS three-arm semantic qualification

Three fresh children now pass the fixed cold-reset → before F000:E16 qualification: plain functional JS with the fixed Bochs reset profile, native one-Q, and native batched. All exit zero without a timeout. Independent audit verifies their terminal CPU, full settled board, raw RAM hash, complete ordered PIO tape and unchanged source/artifact authentication. This qualifies the three execution arms for this checkpoint; it is not a paired performance result or full BIOS boot.

[PR #306](https://github.com/CrispStrobe/bw-board/pull/306) merged normally at `fa3aec603407b8cb7534a6a352607922d123108a` after all ten enabled exact-head push and PR checks passed, with two optional checks skipped. The separately authorized [manual run 37126251298](https://github.com/CrispStrobe/bw-board/actions/runs/37126251298), attempt 1, used frozen qualifier `fc0c71fb01daf11ad740632c1dff299be4310f29`. Exactly one manual run exists at that source. The [first inspect-schema failure](I80386-COLD-THREE-ARM-FIRST-FAILURE.md) and [second live-slice type failure](I80386-COLD-THREE-ARM-CORRECTED-FAILURE.md) remain immutable evidence; neither is relabeled as a passing run.

| Arm | Actual completion | Native resumes | Largest charged Q | Ordered PIO events |
| --- | --- | ---: | ---: | ---: |
| Plain JS | 316,562 JS Q | Not applicable | Not applicable | 16,475 |
| Native one-Q | 316,562 N and Q | 316,562 | 1 | 16,475 |
| Native batched | 316,562 N and Q | 16,524 | 300 | 16,475 |

The native budgets are independently bounded: one-Q uses N/Q limits of one; batched admits at most 600 N and `min(300, remaining Q)` per resume. Both retain real PIO, deadline and external-line return phases. No zero-Q return occurred in this run. Native one-Q returned 300,041 budget cuts, 16,475 PIO cuts and 46 event cuts; batched returned three budget cuts, 16,475 PIO cuts and 46 event cuts. Each observed one IRQ-line snapshot; no IRQ delivery, fault, fallback or halt-idle work was admitted. The asserted PIC state remains in the actual board evidence rather than being synthetically masked.

Native reset and final inspect results retain all 166 raw CPU words. The actual last resume additionally retains active state zero, reason, charged N/Q and the 160-byte slice result; its raw 166 words equal final inspect. Native terminal words match across the two modes and the bound eighth diagnostic. The JS comparison covers its documented architectural counterparts and pre-settle E16 CPU; it does not represent all native hidden fields. Each arm compares the full settled board and entire ordered PIO tape with the bound reference. The whole raw RAM hash is `af0c07fc87959f6481ab7611967ac40a2c8d3d5fa14beac0979cc99e95913f02`, with no witness-byte normalization.

The compiled source remains `7632e6a0995ceaab88bc8cede91506a5330d2e1c` (125 inputs), addon `40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0`, diagnostic driver `11c0bdcade020117fc682e97db284c6ff8797842` (54 inputs), plain worker `0f1ec8cc73b7dd4f39250be2fe8be5cb39352f83` (49 inputs), and native worker `b01c922c2d634aba9367f6e2a70d109370e4adee` (56 inputs). The qualifier's 32 tooling inputs and every role's current/Git map remain unchanged through finalization. The addon was restored from its original authenticated artifact; this qualification performed no C rebuild. The reference retains the source-proven Bochs reset-model profile and narrowly owned undefined-OF comparison policy described by the [E16 diagnostic](I80386-NATIVE-COLD-BIOS-E16-RESULTS.md). Neither is a hardware correction or a blanket CPU/RAM normalization.

Every native resume still materializes all mandatory ABI words and metadata inside its execution timer. The workers discard intermediate words; they retain reset, final and actual last-return evidence. Complete backing RAM bytes and intermediate CPU/board states are not archived. Consequently, this result establishes terminal/complete-PIO semantic qualification and the source-attested loop guards, not independently reconstructible per-instruction or per-element RAM parity. The earlier one-Q diagnostic remains the separate correctness evidence for its compared intermediate boundaries.

Each child used Node 22.23.3, heap 128 MiB, CPU 60 seconds, wall 120 seconds, file 16 MiB, core zero, nice increment 10 and six blank hook variables. Execution-phase CPU/wall self-reports exclude authentication, construction and final evidence while retaining real scheduling/PIO/device work and mandatory native snapshots. Parent wait4 CPU and whole-child wall are separate measurements. Cgroup counters describe the aggregate host.

| Arm | Execution CPU seconds | Execution wall seconds | Whole-child CPU seconds | Whole-child wall seconds |
| --- | ---: | ---: | ---: | ---: |
| Plain JS | 0.309121 | 0.144554 | 1.120334 | 0.855709 |
| Native one-Q | 8.112841 | 7.732816 | 10.906786 | 10.242167 |
| Native batched | 1.438218 | 1.187138 | 4.209194 | 3.690108 |

These single-child values are informational. Batching reduces the observed native costs while plain JS is still faster in this capture; no repeated paired result is established. The three serial qualification children have no warmup/alternating measured pairs and cannot pass a speed gate. Six configured board clocks per Q do not calibrate physical 386 RTx.

Independent audit completed 33,583 checks over all 192 artifact members, actual last-return/inspect schemas, terminal evidence, full tapes and final authentication. The [governing audit](receipts/i80386-cold-three-arm-results-20261003/independent-arm-qualification-audit.json) records all three arms as qualified. [The compact lossless receipts and byte-exact origins](receipts/i80386-cold-three-arm-results-20261003/index.json) retain the three raw child results, exits, streams, source maps, host context and official metadata. The single external artifact `11274862662` is 20,168,409 bytes, SHA-256 `0ded1f2c22d98e410b96ce6169110e78088df784eb2f7d472c0894a66867f2ca`, at `/tmp/native-cold-three-arm-third-qualification-publication-20261003/official-artifact.zip`, bound to its [official download](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11274862662/zip). No duplicate ZIP is committed.

The next performance comparison requires its own reviewed paired protocol and fresh children. Native batching versus native one-Q and native versus plain JS answer different questions. This checkpoint does not establish physical 386 speed, broader AT boot, Windows/Doom 10× or default adoption.
