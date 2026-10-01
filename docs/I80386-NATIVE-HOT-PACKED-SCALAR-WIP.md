# 80386 native packed scalar protocol — H4 WIP

The packed scalar candidate lowered mean execution process CPU cost from **580.047 ms to 502.477 ms (13.37%)**, with all seven measured pairs favorable. It passed the predeclared 10% mean-reduction criterion. All 1,649,067 canonical native trace rows and the complete ordered host callback journal match accepted H1 exactly. These results apply to the bounded free-ROM workload and this shared VPS. The 10× goal, full Windows/Doom compatibility and production native CLI/GUI integration remain open.

## Protocol and validation

One native scalar call invokes the source-owned `packedScalar(op,a,b,c)` wrapper. The wrapper dynamically invokes the original tick, quantum, PIO or IRQ-ack method with its original receiver and argument count. It validates the operation's numeric result before any mapping lookup. For non-PIO operations it then dynamically invokes `mappingState`; PIO uses its own response metadata. Epoch is read and validated before the A20 field. Only after every validation succeeds does it update a private reusable `Uint32Array(3)` containing value, epoch and A20.

Strict numeric validation uses operators, with the original finite integer uint32 domain including negative zero. Required reflection, boxing, allocation and error intrinsics are captured before callbacks. Review found two issues before build: mutable global helpers could bypass validation, and direct `Reflect.get` rejected primitive responses that the original NAPI bridge boxed. Both were fixed. Each primitive field lookup now uses a fresh box, preserving getter receivers and prototype changes between reads; object receivers remain unchanged. Installation rejects collisions, and receiver/reentry guards run before host operations.

The native bridge requires an ordinary attached, unshared `Uint32Array` of exactly three elements, zero offset, a 12-byte backing buffer and aligned data. It immediately copies the three words into native locals before any further JavaScript operation. It retains no borrowed buffer pointer. Existing memory/PAGE callbacks, runtime, thread/lifetime guards and C ABI remain unchanged. The production opt-in loader admits the existing actual hot facade and pinned free ROM.

This derivative authenticates the original unprofiled NAPI source `a131583191a71a4a675c66339440d5ce6b4ae1332d5b14bef10d7a8d47e36c40` and replaces only its scalar callback. It does not inherit the H2/H3 `BWNP1` profiler or falsely label a mapping-call phase. The comparison therefore measures the entire H4 bridge/protocol/wrapper candidate against H3's key cache and disabled profiling scaffold.

## Source and build

Measured source: `15631beb63d7c1f17e693de7c86d4ed37b96a768`. Generated NAPI: `b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb`. Fresh addon: `5257a116734fb813b3ef9df31666eea0b41753d344f5c928b312765c0c497cd4`, 2,060,728 bytes. The preparer authenticates 32 source inputs and 12 transforms. Native runtime, CPU3 configuration and ABI2 header remain byte-identical to H1/H2/H3. Later publication commits do not relabel these measured inputs.

Twenty-six official Node 22 focused tests passed with zero skips; generated C++ passed C++17 `-Wall -Wextra -Werror` syntax checking. Fresh build passed 111 static checks and 86 root binding checks. Independent source differential passed 12 checks: every byte outside the scalar callback matches the authenticated original NAPI source.

An initial configure tool launch preceded preparation completion and failed because the target working directory did not exist. No configure work ran in that attempt. The preserved failure receipt distinguishes it from the later sequential successful preparation, configuration and build.

## Actual semantic checks

Sixteen fresh-child runtime controls passed. Seven accepted cases—baseline, dynamic method replacement, getter order, reentry/receiver rejection, mutable globals, boxed primitive mapping and boxed primitive PIO—preserved full exposed reset/final/checkpoint CPU state, counters, devices and RAM. Nine rejection cases covered invalid operation values, invalid/throwing epoch getters and tuple type, length, offset, backing size, shared-buffer and detached-buffer errors. Each rejection produced the expected contained scalar-callback fatal error, with no accepted completion capture. Invalid operation values prevented mapping lookup; invalid epochs prevented later A20 reads. Earlier host effects may already have occurred.

Malformed tuple controls deliberately use the raw authenticated loader with an actual facade to exercise native guards. They do not weaken the production packed loader's collision policy. Root independently audited all controls in 202 checks, including before/after source, transform, binary and helper hashes.

The complete capture-ON run produced 149,865,640 bytes of raw stderr, SHA-256 `1df0b89f1b99a25729adbf193bf86f0fb2b8618ab22b13915d2f050e7e668a51`. All **1,649,067 BWSD1 rows** match authenticated H1, including every field, ordinal and order. Only unstructured emulator preamble is excluded; malformed native-marker fragments are rejected. The complete 209,839-row, 11,728,896-byte host journal matches H1 SHA-256 `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1`. Full CPU snapshots, cache/debug/system fields, board and RAM also match. Root independently compared the complete trace and journal in 1,649,085 checks.

The first full-trace parent launch collided with the child wrapper's reserved stdout filename. It stopped before guest execution. That failed launch is preserved separately; the successful run used a fresh directory and distinct parent log names. No failed guest sample was reclassified.

## Timing evidence

Hardware: shared VPS with four Intel Xeon Skylake KVM vCPUs, approximately 8 GiB RAM and official Node 22.23.3. All timing children used a 512 MiB heap, 120-second timeout, 256 MiB regular-file output cap and disabled core dumps. Inspector/C++ profiling, raw native tracing and host journaling were disabled. Both comparisons discarded two fresh-process warmup pairs and then measured seven alternating pairs. Root and the other agent paused CPU audits during each comparison; external workload contention remained.

The first wall-only comparison passed all 18 children's semantic checks, but paired H4/H3 ratios ranged from 0.241 to 1.804 while load rose from 5.95 to 9.87. Its observed medians of 878.684 ms for H3 and 502.355 ms for H4 do not establish a stable speed benefit. The original run remains preserved and inconclusive.

The follow-up uses execution-window `process.cpuUsage()` deltas alongside wall time. Externally generated drivers add only CPU timing and reporting, preserve original driver identities/imports and reverse exactly to authenticated originals. They change no frozen source or compiled input. CPU starts after create/setup and stops immediately after the scheduler/resume loop, before settlement and serialization. It includes all active process threads, GC, callbacks, returned snapshots and the tiny measurement-call overhead. CPU time can exceed wall time when threads run concurrently; it is not pure core time.

Before execution, the criterion was fixed at at least **10% lower mean process CPU cost and all seven measured pairs favorable**. It passed:

| Metric | H3 | H4 |
| --- | ---: | ---: |
| Mean execution process CPU | 580.047 ms | 502.477 ms |
| Median execution wall time in CPU run | 574.609 ms | 507.295 ms |

| Pair | H3 CPU | H4 CPU | H4/H3 CPU |
| --- | ---: | ---: | ---: |
| 2 | 576.709 ms | 499.357 ms | 0.8659 |
| 3 | 596.558 ms | 495.452 ms | 0.8305 |
| 4 | 639.463 ms | 538.125 ms | 0.8415 |
| 5 | 592.180 ms | 509.091 ms | 0.8597 |
| 6 | 533.064 ms | 512.964 ms | 0.9623 |
| 7 | 604.239 ms | 487.936 ms | 0.8075 |
| 8 | 518.113 ms | 474.417 ms | 0.9157 |

All 18 follow-up children retained full H1 exposed CPU, board, RAM and counter parity. Independent helper review passed 159 checks and root derivation review passed 37. Independent actual artifact/calculation audit passed 1,665 checks; root passed 1,675. Original H3/H4 driver closures contain 55/61 inputs, while compiled inputs remain pinned separately to H3's a645 source and H4's 15631 source. Binary, helper, derived child and source/transform bindings stayed unchanged before/after.

The CPU result supports this candidate on this workload. It is not an isolated packed-protocol estimate, a general application result or physical 16 MHz 386DX RTx. The earlier H2/H3 wall improvement uses a different comparison and metric; percentages must not be multiplied into a combined gain. GitHub CI and Kaggle throughput remain unmeasured for this adapter.

## Reproduction and next work

The new opt-in driver is `scripts/run-i80386-native-hot-packed-scalar.mjs`; the preparer is `scripts/prepare-bochs-cpu3-native-hot-packed-scalar.mjs`. Both require the current bounded free-ROM policy and an authenticated addon. The existing CLI/GUI execution choices are unchanged. Actual local inputs, manifests, source pins and commands are preserved in [the artifact index](receipts/2026-10-01-i80386-native-hot-h4-artifact-index.json). Receipt scripts retain original paths as provenance and need path adaptation on another machine. Process bundles losslessly preserve input/exit/stdout/stderr bytes using base64. Large successful raw traces and compiled binaries remain local and SHA-bound.

Next concrete work is to measure and reduce remaining bridge costs under the packed protocol, then widen admission using separately proved free guests and real disk/device paths. Conditional argument construction and reuse of immutable scalar keys/values are narrow candidates; reducing original board operations requires a new device/event proof. Arbitrary AT boot, Windows enhanced mode, Doom and production native UI integration are still unqualified.
