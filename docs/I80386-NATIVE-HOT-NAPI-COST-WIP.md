# 80386 native bridge cost profile — H2 WIP

The longer free protected-mode workload now has an opt-in C++ bridge cost profile. Three alternating profiler OFF/ON pairs preserved the accepted native H1 CPU, checkpoints, devices and whole-RAM results. The largest measured scalar costs are dynamic operation calls, mapping-state calls and mapping-field extraction. This is profiling evidence for choosing an optimization; it establishes neither a speedup nor Windows/Doom compatibility.

## Build and source identity

Measured source: `d074466f7b077cbe6c8ad57a80d309761a958ee1`. Fresh CPU3 addon SHA-256: `791774c572e0b170b66f1eaa26145da2cf9505060939631ac4395ee760f5fb65`. Generated NAPI C++: `eed8d0692f6158562a0ab2dc4cd64f52f08045ad45c45cf607b797a3d5cf1896`. The preparer authenticates 30 source inputs and 12 upstream transforms. Original H1 runtime, ABI and loader remain unchanged. Public documentation commits follow the measured source and do not relabel its revision.

The profiler uses `BW_HOT_NAPI_PROFILE=1`, sampled at addon creation. Disabled mode performs no clock reads and emits no cost rows; the profiling scaffold still introduces branches. Enabled mode reports 17 canonical `BWNP1` rows at close, with overflow, clock-regression, callback-depth and exact count/partition checks. Native-resume timing includes callbacks. `resume_return_conversion` covers snapshot extraction and all returned NAPI object allocation outside CPU resume, not only snapshot extraction. Startup, settlement and serialization remain separate.

## Actual measurements

Hardware: shared VPS, four Intel Xeon Skylake KVM vCPUs, approximately 8 GiB RAM, official Node 22.23.3. Each fresh child used regular-file output descriptors, a 512 MiB Node heap, a 120-second timeout and a 256 MiB output limit. Native raw tracing, host journals and Inspector profiling were off in all six runs.

| Pair | Profiling OFF execution | Profiling ON execution | Observed increase |
| --- | ---: | ---: | ---: |
| 0 (OFF then ON) | 492.003 ms | 640.406 ms | 30.2% |
| 1 (ON then OFF) | 466.524 ms | 550.401 ms | 18.0% |
| 2 (OFF then ON) | 480.220 ms | 564.870 ms | 17.6% |

Shared-host scheduling and instrumentation overhead cannot be separated by these three pairs. Do not compare these times to earlier runs taken under different host load as an optimization result. Physical 16 MHz 386DX RTx and GitHub/Kaggle throughput remain unmeasured for this adapter.

| Enabled-profile bucket | Three-run range | Relationship |
| --- | ---: | --- |
| Native resume | 507.409–592.067 ms | Includes whole callbacks |
| Whole scalar callbacks | 371.686–415.494 ms | Includes six disjoint scalar phases below |
| Argument creation and scopes | 20.104–23.975 ms | Scalar phase |
| Dynamic operation lookup and call | 133.165–153.145 ms | Scalar phase, includes JS body |
| Return validation | 12.452–13.388 ms | Scalar phase |
| Mapping-state lookup and call | 94.289–104.697 ms | Scalar phase, includes JS body |
| Mapping fields | 94.728–105.522 ms | Scalar phase, includes property access and validation |
| Scalar scope close | 15.222–18.207 ms | Scalar phase |
| Whole memory callbacks | 55.653–93.849 ms | Separate callback family |
| Whole page callbacks | 14.483–21.517 ms | Separate callback family |
| Resume return conversion | 26.903–31.151 ms | Outside native-resume interval |
| Resume minus whole callbacks | 48.184–61.206 ms | Includes other bridge/profiler/runtime work; not pure Bochs |

The six scalar phases partition scalar time exactly. Operation-specific scalar buckets offer an alternative partition of the same time; they must not be added to the phase buckets. Whole scalar, memory and page callback times can be subtracted from inclusive resume time only after establishing no nesting and callback containment.

Every enabled run recorded 439 successful resumes, 100,684 native ticks, 100,682 quanta, 209,839 callbacks, 201,393 scalar operations, 201,367 mapping calls, 8,438 memory callbacks and eight page callbacks. Maximum callback depth was one, with zero nesting, live callbacks, overflow or clock regressions. Exactly 1,428,373 clock reads matched the successful-operation census. Both disabled and enabled runs retained the full accepted native H1 reset/final/checkpoint CPU state, whole board state, RAM SHA, checksums and witnesses. The earlier native-versus-JS raw reset witness differences remain explicit in the [H1 notes](I80386-NATIVE-HOT-WORKLOAD-WIP.md).

## Validation and receipts

Focused official Node 22 tests: 14 passed, zero skipped. Generated C++ passed C++17 `-Wall -Wextra -Werror` syntax checking. Build preflight passed 104 static checks; root build binding passed 79 checks. Root independently reconstructed actual artifact hashes, full invariants and cost partitions in 640 checks. A separate audit passed 916 checks, including historical/current source closures, compiled transforms and addon identity. All six children exited successfully; no lossy pipe trace was used.

The first coordinator attempt stopped before guest execution because importing the regular-file helper created untracked Python bytecode and failed the clean-source preflight. The bytecode and failed attempt remain preserved locally. The retry explicitly disabled bytecode generation, retained the same measured tracked source and passed. This failed preflight is not a successful guest sample.

Actual source-bound captures, raw profile stderr, process exit receipts, environment, helper and audit scripts are indexed by SHA-256 in [the receipt index](receipts/2026-10-01-i80386-native-hot-h2-artifact-index.json). Audit/coordinator scripts deliberately retain original local paths to identify historical inputs; those paths must be supplied or adapted for replay on another machine. The addon itself is not bundled.

## Next optimization

Test reuse of immutable property-key handles within each resume's callback interval. Continue resolving methods and getters dynamically and performing the same numeric validation. Only the scalar hot path should change; memory/page callbacks and returned snapshot creation keep their current behavior. Temporary handle scopes must close before construction of the returned snapshot.

Node 22's [NAPI implementation](https://github.com/nodejs/node/blob/v22.23.3/src/js_native_api_v8.cc) constructs a UTF-8 property key in `napi_get_named_property`; `napi_get_property` accepts an existing key. Avoiding repeated key construction is a hypothesis, not a measured gain. The candidate requires a fresh authenticated build, hostile callback tests, full guest parity and alternating profiler-disabled H2/H3 timings before adoption.

Full AT boot, Windows 3.1 enhanced mode, Doom, arbitrary DOSBox media and production native CLI/GUI integration remain unfinished. This bounded free-ROM profile does not expand the adapter's admitted guest policy.

## Measured candidate

[H3 scalar property-key reuse](I80386-NATIVE-HOT-PROPERTY-KEYS-WIP.md) passed full trace/journal parity and reduced median execution time by 7.83% in seven unprofiled pairs on the shared VPS. Scope and timing variation remain explicit in those notes.
