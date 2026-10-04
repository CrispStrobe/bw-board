# Cold native execution-window diagnostic, 2026-10-04

[Run 37199774878](https://github.com/CrispStrobe/bw-board/actions/runs/37199774878) ended with **hosted FAIL**: post-child validation raised `KeyError: binding` because its derived worker descriptor omitted the binding pathname. The unchanged worker itself exited successfully and retained guest parity and a complete Inspector profile. Independent audit verified that evidence; repairing the descriptor offline did not replay the guest or overwrite the original receipt.

The audit checked all 68 official artifact members and 377 frozen Git role paths, reset/final/last-return 166-word state, N/Q 316562, terminal board and RAM hash, and 16,475 ordered PIO events. Whole RAM bytes were not retained. Artifact 11302433146 is 18,704,852 bytes, SHA-256 `4a82d0b9190480a929d514dca805805fdeaa062a45d5c4e8bb8bb5b4629125d3`. Root independently validated the full 16,475-event terminal tape using the held policy and an in-memory metadata correction (`root-offline-terminal-audit.json`, SHA-256 `a8ffe06abfc3ef264cee649f86b31ddb88ac2d078404e39ecea3ae5515a93de5`). The sole local packet is `/tmp/native-cold-memory-fusion-execution-profile-first-diagnostic-publication-20261004`; its governing `independent-audit.json` SHA-256 is `238960a167df142cf66ff5c5b2a32a63d96c5987bf06e63012c315f664c011db`.

[Compact indexed evidence](receipts/i80386-cold-execution-profile-20261004/index.json) retains the governing audit, root terminal audit, raw leaf bins and official artifact metadata.

The main-isolate profile contains 145 nodes and 1,793 samples, with a 1,972,190 µs span and 1,971,273 µs of sample deltas. Six retained markers bracket Inspector start, the unchanged execution timer, and Inspector stop. V8 and process marker clock domains remain separate. No sampler error was retained.

| Exclusive leaf label | Samples |
| --- | ---: |
| run | 604 |
| opaque `close` (no URL, line −1) | 522 |
| copyLedger, three call-tree nodes at one source location | 158 |
| clockTransfer, two call-tree contexts | 97 |
| fusedMemory | 49 |
| garbage collector | 30 |

The opaque `close` label is not evidence of API cleanup: sampling stops before the worker closes the API. Its parent/callsite evidence points to the worker resume line, while the NAPI initializer shares one invoke callback across five exported functions. That plausibly explains an ambiguous native label, but resolves no C++ function cost. These are main-isolate caller samples; native C++ cost remains unresolved. Counts are neither execution CPU percentages nor removable-cost estimates.

The host was AMD EPYC 7763 with four logical CPUs. Observer-active execution self-report was CPU 2.344743 s and wall 1.947205319 s; whole-child wait4 CPU was 7.815283 s and parent wall 6.982537718 s. Those windows include different work and do not qualify speed. The established unprofiled paired result keeps plain JS as baseline; this diagnostic changes no adoption decision and provides no physical 16 MHz calibration.

A source-visible next hypothesis is reducing redundant expected-ledger copies while retaining complete validation and the independently owned accepted reply. See [the bounded proposal](I80386-COLD-LEDGER-SCALAR-PROPOSAL.md). No optimization or new guest execution is established here.
