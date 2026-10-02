# H2 opt-in NAPI cost diagnostic

This separate derivative authenticates NAPI source SHA `a131583191a71a4a675c66339440d5ce6b4ae1332d5b14bef10d7a8d47e36c40`. ABI2 exports, runtime, loader, callback arguments/results, predicate/property order, immediate borrowed-byte copies, mutex/thread/lifecycle guards remain unchanged. It is not a guest qualification or throughput claim.

`BW_HOT_NAPI_PROFILE=1` is read once during validated create. Startup has no clock reads. Timers run only for `bw_direct_resume` and its callbacks, plus return snapshot conversion on that resume branch; create/inspect/setIRQ/close snapshots are not timed. Disabled mode has no clock reads, counter changes or diagnostic output; guarded C++ timer scaffolding remains and no zero-overhead claim is made.

Close emits exactly seventeen `BWNP1` lines to **regular-file stderr**, once after successful native close. This is a diagnostic side channel, separate from native `BWSD1` proof rows. Preserve both raw files and child exit/size-limit evidence.

- `HEADER 1 nanoseconds resume-only`.
- `CONTROL successfulResumes callbackCalls maxCallbackDepth nestedCallbacks clockReads liveCallbackDepth overflow clockRegression`: eight canonical unsigned decimal 64-bit fields.
- Fifteen unique `BUCKET name count totalNs maxNs` rows, names in `profileBuckets`.

`native_resume_inclusive` includes whole scalar/memory/page callbacks and instrumentation. `resume_return_conversion` runs after native resume and covers returned NAPI arrays/counters/slice conversion. Whole scalar is partitioned exactly into arguments/scopes, operation call (NAPI lookup plus JS body), return validation, mapping call (lookup plus JS body, non-PIO only), mapping fields, scope-close. Per-operation scalar buckets also partition whole scalar by tick/quantum/PIO/ACK; they are alternative inclusive views, not additive to phases. Memory/page times are whole callbacks, including copies and validations. Failed operations retain original outcomes; no failed run is accepted as a complete diagnostic.

Only when observed maximum callback depth is one, nested callbacks zero and total callbacks are contained in resume time may the parser expose `resume minus whole callbacks`. This residual includes other bridge/profiler work; it is **not pure Bochs time**. Zero-valued total time is possible at clock resolution. Overflow, clock regression, missing/duplicate/noncanonical records, unequal scalar partitions and inconsistent counts reject.

H1 expected successful fixture counts: 439 resumes, scalar 201393 (N=100684, Q=100682, PIO=26, ACK=1), mapping calls 201367, memory 8438 (4235 reads+4203 writes), PAGE 8. These remain expected counts until an actual H2 run authenticates them. Profiling on/off must match actual CPU, native counters, board, RAM and raw trace before timing interpretation. No optimization, caching or batching is introduced.
