# 80386 native conditional packed arguments — H5 WIP

H5 preserves the bounded free-ROM semantics but **fails its predeclared CPU performance gate**. Mean execution process CPU was 464.402 ms for H4 and 465.336143 ms for H5, a 0.20114962% increase. Only three of seven measured pairs favored H5. H5 remains an experiment; H4 remains the baseline. This result does not establish a performance adoption or the [10× goal](I80386-10X-PERFORMANCE.md).

H5 conditionally constructs native numeric argument handles for the existing packed scalar operation. It supplies only the operation arguments required by the packed wrapper. It preserves the [H4 packed scalar protocol](I80386-NATIVE-HOT-PACKED-SCALAR-WIP.md), dynamic host method lookup, receiver and original host argument count, result validation, private typed tuple ownership, memory/PAGE callbacks, lifecycle guards, native runtime, ABI and CPU3 configuration. The exact generated source inverse restores H4 after two native substitutions and removal of the added provenance banner; source arithmetic predicts fewer numeric handles but is not a measured speed result.

## Frozen source and build

Measured H5 source is `ef106b4ae3a2ca55e9cc3253597ec66773e07847`; held H4 source is `15631beb63d7c1f17e693de7c86d4ed37b96a768`. The H5 generated NAPI hash is `f83992b411bb0756c4a0744fdd8f9ae70be6d1b3a7e23d65db199ef2fbec58b5`; the actual fresh addon is `c52943191195faae07107049dcea594f8e35451cff6d7aa0cafc485886895fc0`, 2,060,728 bytes. A later documentation commit does not relabel these measured inputs.

Thirty-four focused tests passed. The build passed 121 static checks and 130 independent root binding checks. H5's build manifest authenticates 37 source inputs and 12 transformed inputs, compared with H4's 32 and 12. These inventories are distinct from the explicit actual compiled NAPI/runtime/ABI-header/configuration hashes. Actual execution driver closures contain 65 files for H5 and 61 for H4.

## Semantic evidence

Seventeen fresh-child runtime controls passed, including internal packed argument count observation, baseline and hostile dynamic lookup, getter, receiver/reentry, primitive response and malformed tuple cases. Accepted controls preserved complete exposed reset/final/checkpoint CPU state, counters, board/device state and RAM. Nine denied controls preserved expected contained fatal/error chronology; earlier host effects may already have occurred. Root independently audited the controls in 952 checks. The raw-loader argument count control is test-only and does not weaken production admission.

The full capture-ON run matched all 1,649,067 canonical native rows and the entire ordered H1 host callback journal. Every structured trace field and ordering is compared; only the unstructured emulator preamble is excluded. Root recorded 1,649,085 checks. Full trace timing is diagnostic and is not included in the benchmark. Large raw trace, journal and native binary remain local, authenticated by SHA-256 receipts.

## CPU comparison

The criterion was declared before execution: discard two fresh-process warmup pairs, then measure seven pairs in alternating H4/H5 order; require at least 3% reduction in the ratio of mean process CPU totals **and** all seven H5 totals strictly lower. All 18 children passed full semantic/reference comparisons. No performance repeats were run after this failure.

| Measured pair | H4 total CPU, µs | H5 total CPU, µs | H5 favorable |
| --- | ---: | ---: | :---: |
| 1 | 492225 | 497575 | No |
| 2 | 467493 | 537592 | No |
| 3 | 464641 | 460128 | Yes |
| 4 | 471127 | 475989 | No |
| 5 | 490188 | 431603 | Yes |
| 6 | 431306 | 440774 | No |
| 7 | 433834 | 413692 | Yes |
| Mean | 464402 | 465336.142857 | 3/7 |

The process CPU metric is captured user plus system microseconds across all process threads during the adapter execution loop. It excludes startup, settlement and serialization and includes tiny timer overhead. CPU fields explicitly end in `Us`; the general timing unit describes wall nanoseconds. Inspector/C++ profiling, raw native trace and host journal were disabled. Each child used official Node 22.23.3, bounded regular-file transport, a 512 MiB heap, 120-second timeout and 256 MiB output cap. Root and the independent agent paused local audits during measurement; shared VPS load, cache, GC and scheduling still limit inference. This is a whole adapter comparison on one bounded free workload, not isolated core cost, physical RTx, broader guest compatibility or Windows/Doom qualification.

Root independently audited 1,800 artifact/calculation checks; a separate audit passed 1,805 checks. Both record semantic integrity and the failed criterion honestly. The benchmark summary SHA-256 is `20d25925a85cbd97d5dd28a5295d0b31d822866753ae26142b9af062f930519b`.

## Reproducible receipts

The [SHA-indexed receipt inventory](receipts/2026-10-02-i80386-native-hot-h5-receipt-index.json) binds source derivation/inverse, build manifests, actual compiled files, runtime controls, full trace comparisons, CPU helper derivation, before/after authorization, environment, captures and independent/root audits. Captures are deterministic gzip; process files are lossless base64 with original-byte hashes. Only public free-ROM evidence is included. Local absolute paths identify historical provenance; published copies are separately hashed. No licensed guest media or native binaries are included.
