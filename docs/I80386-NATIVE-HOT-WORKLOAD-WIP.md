# Native 386 hot workload: work in progress

The experimental Bochs CPU-level-3 native adapter has completed the free, longer protected-mode guest on the board's actual memory and devices. This is a diagnostic milestone, not a qualified production backend, a full 386 compatibility result, or a throughput measurement.

The original short direct-adapter profile remains unchanged. A separate profile authenticates the longer ROM (`0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631`), allows up to 160,000 native ticks and 150,000 successful quanta, and retains the ABI, typed operand, A20, memory ownership, and fallback guards. Remaining instruction and quantum budgets are clamped before CPU execution. Each resume still permits at most 600 ticks and 300 quanta.

## Actual H1 diagnostic

Source: `c626bce01f59ae830283bfa30cda5f311612650a`. The fresh H1 native build bound 25 owned inputs and 12 patched upstream inputs. Its addon SHA-256 is `3d8e53ca438aadb9c854bea5ab9bf1c84b9d9560e50c1e9951859bb67a787f15`; generated runtime SHA-256 is `89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a`. Compiled provenance is separate from the runner's JavaScript import closure.

The actual capture-OFF run completed 100,684 native ticks, 100,682 quanta and 435 resumes. It produced the expected register checksum (200,010,000), next register value (20,001), memory-loop count (4,096), eight self-modification witnesses, two page faults, one interrupt, and the guest completion marker. No JavaScript CPU stepping or native fallback occurred. Board accounting ended at 604,096 functional clocks with no outstanding device debt.

The compact callback journal contains 209,839 rows / 11,728,896 bytes, SHA-256 `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1`. The capture SHA-256 is `12893aa4a70ba90d9e78909d19734369bfc527e3e828cebc75cf662add96a8ec`.

Independent replay authenticates the actual journal bytes, callback ordering and counters, and reconstructs the full 16 MiB backing memory. All 16,396 byte writes in the new hot tail match the JavaScript baseline in order, address, value and instruction/quantum position. All 26 output-port effects and the entire settled board state match. The raw final RAM hashes differ only at five bytes of the guest's reset witnesses: address `0x511` and `0x514`–`0x517`. The native core records reset EDX=0 and CR0=`0x7ffffff0`; the compatibility JavaScript core records EDX=`0x300` and CR0=0. These values are retained in the evidence. Earlier prefix differences in page-table and exception-frame writes also require explicit treatment; equal final RAM outside the witnesses does not establish an identical complete write history.

The original runner's checkpoints are resume-end snapshots, and its numeric PC-range labels can misclassify a fault handler as completion. Those labels establish no exact phase-boundary parity. A subsequent harness must stop at authenticated quantum boundaries and preserve the original capture as historical evidence.

## Trace transport follow-up

A later same-source ON/OFF pair (`46cbacb0b9866ae784dbffe060703c532d161d76`) matches complete native reset/final snapshots, six exact quantum boundary snapshots, callback journals and final board/RAM state. The six boundaries also match the selected JavaScript CPU fields and whole board state, with the declared raw EDX/CR0 differences retained. However, independent inspection found missing and truncated native records in the piped trace even though the child exited successfully. That 124,684,311-byte trace is retained as **incomplete**, not full trace evidence. The transport must be corrected and the run repeated with a lossless sink and a hard file-size limit.

## Lossless repeat

Repeating the same source and native build with a regular-file stderr descriptor and an OS `RLIMIT_FSIZE` of 256 MiB produced a complete 149,865,640-byte trace, SHA-256 `21ea17d068097696c3bf3c991cfdead2f236a833319a563747cabc66f7488308`. All 1,649,047 record ordinals are contiguous. Counts match 100,684 native ticks, 100,682 successful quanta and 100,688 complete post-state groups. Both children exited successfully. The original piped trace remains failed evidence.

An independent semantic audit replayed all 33,732 raw memory read/write records against the actual ROM and backing memory, including A20 decoding, and verified the actual instruction bytes for all 100,682 attempted instruction records. Every one of the 100,506 hot-tail post-states matches the JavaScript baseline's CS, EIP, EAX, EBX, ECX, instruction index and quantum index. Full native snapshots at all six boundaries, the complete callback journals, settled board state and raw RAM hashes also match between trace ON and OFF. This establishes these specific comparisons; broader opcode/cache semantics and actual total-cap exhaustion remain unfinished.

A second independent audit also verifies all 100,688 native post-state groups, their selector/control/debug mirrors, terminal N-API snapshot and close/callback/fallback witnesses. All successful checkpoints align with JavaScript's recorded CS/EIP/EAX/EBX/ECX after separately identifying 35 initial CR0-to-EAX carry states and three nonfinal REP decoded-end EIP states. These exact, source-bound differences remain visible in the evidence; they are not broad register masks.

## First equivalent timing

Eighteen fresh Node 22.23.3 children ran the same guest with native tracing and host journals disabled: two discarded warm-up pairs followed by seven alternating JavaScript/native sample pairs. Every child passed its accepted CPU, board, RAM and counter checks. Execution timing excludes assembly, source authentication, reset/startup, settlement, hashing and report writing; it includes scheduler work, delivery counters, six acceptance snapshots and the native adapter's resume snapshots.

| Engine | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Compatibility JavaScript board | 339 ms | 513 ms | 1,665 ms |
| Experimental native whole adapter | 795 ms | 1,345 ms | 3,103 ms |

This run used the shared VPS: four Intel Xeon Skylake vCPUs under KVM, approximately 8 GiB RAM. Initial load averages were 5.27 / 3.74 / 4.52, and other work, including independent audits, continued during sampling. The native median was 2.62 times the JavaScript median; the wide spread limits an isolated performance conclusion. These are measurements of the complete adapter on this register-heavy fixture, not the isolated Bochs core or representative DOS/Windows applications. There is no demonstrated native speedup or 10× improvement.

Measured source was `5e31ea058e16746c6bf3a540a3325ed201576719`; all 41 JavaScript and 54 native-runner source inputs were authenticated against that historical revision. The compiled H1 inputs were independently bound as above. Actual no-journal native files have zero rows and bytes. Historical native reports contained a generic timing description mentioning journaling; the accompanying annotation records the actual disabled modes rather than rewriting the original reports.

Profiling the bridge is the next performance gate. Each scalar quantum/tick callback currently makes a second JavaScript call to obtain mapping state. Its cost must be measured before caching or batching changes that could affect device, A20, exception or interrupt ordering.

## Bridge profiling

Three further fresh profile/OFF pairs authenticate source `fd0b83eb1c97ac031b3ef87afe24b0d6f0d6606c` and preserve complete native CPU, board, RAM and counter results. Inspector sampling starts after native creation and stops before settlement; inclusive wrappers are restored before settlement. Profiler.stop command processing itself contributes 37–52 ms of samples after the execution timer ends and is explicitly excluded from guest-hotspot interpretation.

Per run, mappingState executes 201,367 times (31.6–36.0 ms inclusive), quantum callbacks 100,682 times (38.6–46.8 ms), native-tick callbacks 100,684 times (34.8–38.7 ms), and PAGE callbacks eight times (15.9–22.8 ms). Native resume executes 439 times (801–969 ms inclusive of callbacks). These buckets overlap and cannot be summed as exclusive costs. Profiling increased observed wall time by 17–46%, with shared-host interference still present.

V8 attribution frames named `measure` or the addon export `close` do not establish exclusive wrapper CPU time, actual close calls during execution, or native C++ hotspots. The next concrete step is bounded native instrumentation to separate N-API marshalling/call overhead from Bochs execution, followed by a narrowly scoped optimization and fresh parity/throughput checks.

## Reproduce the tooling

Run the eleven focused source/transport checks with:

```sh
node --test --test-concurrency=1 test/i80386-native-hot-direct.test.mjs test/i80386-native-hot-journal.test.mjs test/i80386-native-hot-regular-file.test.mjs
```

Prepare a separate native tree from the pinned pristine Bochs revision, using `BOCHS_386_ROOT=/absolute/pinned/bochs node scripts/prepare-bochs-cpu3-native-hot-direct.mjs --prepare /absolute/new/tree`. The emitted manifest specifies the configure and serial build commands. The runner input JSON needs absolute `addon`, its freshly computed `sha256`, `configuration`, `baseline` and new `output` paths, plus explicit `nativeTrace`, `hostJournal` and optional `profile` booleans. Decompress the published [JavaScript baseline](receipts/2026-10-01-i80386-js-hot-baseline-capture.json.gz) for the `baseline` input; the runner authenticates its exact hash. A configuration must meet the original direct adapter's pinned configuration policy.

On Linux, launch the native child with `python3 scripts/run-i80386-native-hot-regular-file.py --node /absolute/node --entry /absolute/repo/scripts/run-i80386-native-hot-direct.mjs --input /absolute/input.json --stem /absolute/new-artifact-stem`. This owns regular stdout/stderr files, applies a 256 MiB OS file-size limit and rejects a reached limit even if the child exits zero. It preserves failure receipts. Never use a piped raw trace as qualified evidence. `node scripts/run-i80386-js-hot-timing.mjs /absolute/js-input.json` runs the comparable journal-disabled JS child; its input needs `baseline` and a new `output` directory.

## Remaining gates

- Authenticate exact-boundary snapshots and every retained exception/reset difference.
- Broaden native trace/budget controls beyond the single longer-workload profile already compared.
- Exercise budget and total-limit guards against actual native execution.
- Separate native bridge overhead from core execution, optimize the measured bottleneck, and repeat equivalent capture-disabled timing.
- Integrate a qualified backend into CLI/GUI only after these gates, then test real protected-mode software and Windows enhanced mode.

The diagnostic execution time includes synchronous callback journaling and snapshots. Six board clocks per successful quantum are functional scheduler accounting, not measured 386DX instruction timing. No physical 16 MHz 386DX RTx, 10× speedup, Windows/Doom compatibility, browser-native backend, or GH/Kaggle throughput is established here.
