# 80386 native scalar property keys — H3 WIP

Reusing eight property-key handles per resume reduced median whole-adapter execution time from **488.240 ms to 449.993 ms (7.83% lower)** in seven alternating pairs on the shared VPS. Six pairs improved and one regressed. All canonical native trace rows and the ordered host callback journal match the accepted H1 workload exactly. This is a bounded workload improvement; the approximately 10× performance target and full Windows/Doom compatibility remain unfinished.

## Behavior and lifetime

The candidate preserves original methods, getters, receivers, callback arguments, numeric validation and callback ordering. It retains only immutable string-key handles for `nativeTick`, `quantum`, `outPort`, `acknowledgeIrq`, `mappingState`, `value`, `mappingEpoch` and `boardA20`. Every method and property value is still resolved dynamically. Reuse applies only inside scalar callbacks; memory/page callbacks and snapshot construction retain their prior property lookup paths.

Each validated resume creates the keys in a parent NAPI handle scope. Scalar child scopes borrow these handles; the parent clears its active pointer and closes before returned snapshot construction. Review caught and fixed an early scope placement that would have invalidated returned snapshot handles, before building or executing the candidate. No keys or borrowed buffers survive their scope. Setup and scope teardown occur outside the inclusive native-resume cost interval but remain inside the whole-adapter execution timer.

Measured source: `a645480594a9bc20a4046619745bb85e57abacd0`. Generated NAPI SHA-256: `7f1c59f85acb858caaf672a21310b6e43e24529196ed9c7ee3880cc194e78634`. Fresh addon: `47cbd33c1856d585208221d28aa614345723a42ea302eff83128671e6fe030de`, 2,066,568 bytes. All 34 compiled source inputs and 12 transforms are authenticated. Native runtime, ABI2 header, CPU3 configuration and all original H2 transforms are byte-identical. Later documentation commits retain this measured source identity.

## Timing comparison

Hardware: four Intel Xeon Skylake KVM vCPUs, approximately 8 GiB RAM, official Node 22.23.3. Two warmup pairs were discarded, followed by seven fresh-process alternating H2/H3 pairs. Both builds used the same a645 JavaScript driver and input ROM. C++/Inspector profiling, native raw tracing and host journals were disabled. The timer includes key setup/close, scheduler work, callbacks and returned snapshot conversion; startup, settlement and serialization are separate. Root and the other agent paused CPU audits during this comparison.

| Build | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| H2 original named-property lookup | 454.600 ms | 488.240 ms | 619.071 ms |
| H3 reused property keys | 412.635 ms | 449.993 ms | 498.055 ms |

| Measured pair | H2 | H3 | H3/H2 time |
| --- | ---: | ---: | ---: |
| 2 | 488.240 ms | 437.007 ms | 0.8951 |
| 3 | 486.795 ms | 444.208 ms | 0.9125 |
| 4 | 454.600 ms | 412.635 ms | 0.9077 |
| 5 | 542.645 ms | 455.162 ms | 0.8388 |
| 6 | 619.071 ms | 498.055 ms | 0.8045 |
| 7 | 497.369 ms | 449.993 ms | 0.9047 |
| 8 | 460.159 ms | 485.098 ms | 1.0542 |

The median paired ratio is 0.9047. Shared-host scheduling and fresh-process JIT variation limit this result; it does not establish an application-wide speedup, pure Bochs speed or physical 16 MHz 386DX RTx. There are no comparable GitHub CI or Kaggle throughput measurements for this adapter.

The historical benchmark helper retained a `sample.profile` boolean as its H2/H3 build selector; it did not enable profiling. Its original summary also retained wording about three profiling pairs. [The separate annotation](receipts/2026-10-01-i80386-native-hot-h3-benchmark-annotated-summary.json) corrects both labels without rewriting measured artifacts. Every actual child input had profiling disabled, and every stderr lacked C++ profile rows.

## Runtime and complete trace validation

Twenty-one focused official Node 22 tests passed with zero skips; generated C++ passed C++17 `-Wall -Wextra -Werror` syntax checking. Static fresh-build audit passed 115 checks and root build binding passed 89. Reversing only the four intended generated-code changes reproduced H2 byte-for-byte.

Nine fresh-child runtime controls passed. Baseline, dynamic method replacement, getter replacement/order and caught reentry all preserved full exposed H1 reset/final/checkpoint CPU state, counters, board and RAM. A throwing mapping getter and NaN, fractional, negative and overflowing metadata each produced the expected contained native fatal rejection, without reading the later A20 getter or producing an accepted completion capture. Host tick/quantum effects can precede metadata rejection; these controls do not claim zero prior effects. Root runtime audit passed 103 checks; after-run source/binary/helper binding passed 112.

A separate regular-file capture-ON run completed within its 256 MiB output cap. Its raw stderr was 149,865,626 bytes, SHA-256 `f586171d2ad40abe8b5890a3234a586a565358c525bd05b4db316ec20757c1a3`. **All 1,649,067 canonical BWSD1 rows match H1 exactly**, including every field, ordinal and ordering. Only unstructured emulator preamble is excluded. The 11,728,896-byte ordered host journal matches H1 SHA-256 `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1`. No CPU state or trace event was masked.

Independent trace replay checked 1,649,047 contiguous ordinals, 100,688 complete CPU groups, all 17,009 read bytes, 16,723 written bytes, 26 PIO events and the complete final RAM digest. Root independently compared every canonical native row, journal and final invariant in 1,649,085 checks. All 18 timing children also preserved full exposed H1 invariants, with 1,401 independent checks and 1,500 root checks. This evidence applies to the admitted free-ROM workload; it does not qualify arbitrary guests.

## Remaining measured costs

Three separate H3 C++ profiler OFF/ON pairs preserved all H1 invariants and the exact 1,428,373-clock-read census. Enabled runs measured these ranges:

| Bucket | Range |
| --- | ---: |
| Inclusive native resume | 416.082–489.988 ms |
| Whole scalar callbacks | 303.693–359.522 ms |
| Scalar operation lookup/call | 105.822–131.386 ms |
| Mapping lookup/call | 74.543–89.755 ms |
| Mapping-field extraction/validation | 76.900–86.786 ms |
| Argument creation/scopes | 20.218–21.209 ms |
| Whole memory callbacks | 59.045–69.410 ms |
| Whole page callbacks | 11.961–30.762 ms |
| Returned snapshot/object conversion | 24.363–29.324 ms |
| Resume minus whole callbacks | 41.384–48.313 ms |

The nesting and partition rules in [H2 cost notes](I80386-NATIVE-HOT-NAPI-COST-WIP.md) still apply. Residual time includes other bridge/profiler/runtime work and is not pure core time. Observed enabled/disabled timing ratios ranged from 0.894 to 1.432, so these six diagnostic runs do not isolate instrumentation overhead or independently establish an optimization speedup. Root cost audit passed 648 checks.

Mapping calls and field extraction remain a larger target than argument construction. The next investigation is a separate opt-in packed scalar host protocol that preserves all original board operations and strict validation order while reducing NAPI crossings. It requires its own contract, authentication and hostile callback/trace proof. No such protocol is included in this candidate.

Actual captures, process provenance, audits and build manifests are indexed in [the H3 artifact index](receipts/2026-10-01-i80386-native-hot-h3-artifact-index.json). Bundled process provenance preserves original bytes as base64 with their hashes. Large raw traces and build binaries remain local; audit hashes bind them. Receipt scripts intentionally identify original local inputs and require path adaptation for replay elsewhere.

Full AT boot, Windows 3.1 enhanced mode, Doom and native CLI/GUI integration remain unfinished. Original JavaScript execution paths and the native backend's bounded guest admission are unchanged.
