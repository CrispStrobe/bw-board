# Cold BIOS E16 paired CPU results

Keep the plain-JS baseline. Native batching passed against native one-Q, but failed against plain JS: it used 4.116236× the execution CPU and lost all seven measured pairs. This is a fixed free-BIOS checkpoint result, not a Windows/full-boot speed result or default adoption.

Both separately dispatched gates used frozen parent `d9fbe713`, native worker `b01c922c` (56 inputs), plain-JS worker `0f1ec8cc` (49 inputs), qualifier `fc0c71fb`, and unchanged compiled `7632e6a0`/DSO `40179a4f`. Each ran two discarded warmup pairs followed by seven alternating measured pairs: 18 fresh children, with the predeclared requirement of at least 10% mean execution-process CPU reduction and all seven candidate pairs favorable.

| Separate comparison | Host, four logical CPUs | Baseline mean execution CPU | Batched mean execution CPU | Whole-child CPU means | Gate |
| --- | --- | ---: | ---: | --- | --- |
| Native one-Q vs batched | AMD EPYC 7763 | 10.444491 s | 1.866638 s | 14.307042 / 5.717406 s | PASS: 82.128011% reduction, 7/7 favorable |
| Plain JS vs batched | AMD EPYC 9V45 | 0.242681 s | 0.998932 s | 0.944383 / 3.785946 s | FAIL_KEEP_BASELINE: 0/7 favorable |

Execution CPU is the worker's declared execution window; whole-child CPU is separate wait4 accounting including setup and final proof. The hosts differ, so absolute results and gains must not be combined across runs. Both recorded Linux/glibc 2.39, Node 22.23.3 and the actual process cgroup's `cpu.max=max 100000` with CPUs 0–3. Hierarchy-root context is separately labelled. Configured six-MHz functional clock ratios are not a physical 16-MHz 386 calibration.

The seven retained execution-CPU pairs, in measured order, are:

| Pair | Native one-Q | Batched on native comparison host | Plain JS | Batched on JS comparison host |
| --- | ---: | ---: | ---: | ---: |
| 0 | 10.844444 | 2.080765 | 0.237532 | 0.993976 |
| 1 | 10.248252 | 1.807411 | 0.231756 | 0.985012 |
| 2 | 10.259021 | 1.824441 | 0.232526 | 0.971396 |
| 3 | 10.303597 | 1.834694 | 0.249604 | 0.973282 |
| 4 | 10.290056 | 1.854037 | 0.245763 | 1.154801 |
| 5 | 10.753176 | 1.817602 | 0.245868 | 0.962654 |
| 6 | 10.412892 | 1.847518 | 0.255717 | 0.951401 |

All 36 actual children exited successfully and passed their fixed terminal evidence. Native children retain strict raw terminal 166, independent N/Q 316562, actual terminal resume metadata, settled board/RAM-hash and full 16,475-event PIO comparison; batching uses 16,524 resumes versus 316,562 one-Q. Plain-JS evidence covers represented JS architecture and board/RAM/PIO, not a native 166 snapshot. Whole RAM bytes and reconstructible intermediate CPU states were not retained. This coverage remains the fixed Bochs-reset-model E16 profile, with the reviewed undefined-OF ownership policy; it does not establish generic AT, protected-mode OS or full BIOS boot admission.

The [first incomplete paired attempt](I80386-COLD-PAIRED-FIRST-FAILURE.md) remains unchanged: one successful warmup child preceded a parent progress-path error and zero measured pairs. The corrected source's actual-parent pure regression traversed 18 mocked children and all 11 controls passed before these two new gates. Neither completed gate was rerun.

Independent audits authenticate all 279 members and 18 children per completed artifact, source/worker/compiled bindings, final authentication, schedule and arithmetic: [native audit](receipts/i80386-cold-paired-results-20261003/native/independent-native-paired-audit.json), [JS audit](receipts/i80386-cold-paired-results-20261003/plain-js/independent-js-paired-audit-r2.json). The [index](receipts/i80386-cold-paired-results-20261003/index.json) retains small raw metadata, inputs, exits, terminal validations, results, context and audits with [byte-exact origins](receipts/i80386-cold-paired-results-20261003/origins.json). Complete original receipts/PIO/progress/authentication remain in the separately retained ZIPs, bound by every member hash and [external retention record](receipts/i80386-cold-paired-results-20261003/external-retention.json); binaries and full tapes are not duplicated here.

Official runs: [native comparison 37129594786](https://github.com/CrispStrobe/bw-board/actions/runs/37129594786), [JS comparison 37130085357](https://github.com/CrispStrobe/bw-board/actions/runs/37130085357). GitHub artifact expiry is recorded with each artifact; canonical local ZIPs retain the evidence beyond that temporary download availability.
