# Closed fresh-child main-thread fixed-ROM diagnostic

This experimental entry uses the unchanged compiled ABI3 addon144f from7df with its actual process singleton, initializing-thread ownership, busy/reentry and fatal guards. Original86 source files, Worker factory and loader remain unchanged. The new main-thread CLI is a separate topology, not same-Worker admission or generic full-AT support.

Only trusted bounded fresh-child launch is supported: empty NODE_OPTIONS/NODE_PATH/LD_PRELOAD/LD_AUDIT, no preloads/import/loaders/debugger, heap flag only, direct realpath entry and authenticated executable/import closure. Child checks cannot undo a preload already executed. Main lexical ownership is not security against arbitrary preloaded main-realm code or debugger access. No raw addon/provider handle or callback hooks are exported.

All439 resume snapshots, six original Q cuts, local stageIRQ/begin/resume/finally-end, caps, canonical logical/native guards and event chronology remain. Per-resume Worker transport and JSON replies are removed. The full report serializes only after execution settlement. Tests use authenticated historical request/return ledgers and mocks, not native state proof.

Compiled provenance remains7df + frozen86 + existing manifest/build/config/prepared artifacts/DSO. Current runtimeJS closure has its own revision and hashes. Every old86 current byte and oldgitblob must match; new runtime files are separately frozen and authenticated before/after.

Startup/create failures are fatal top-level child failures. Scheduler errors abort local diagnostic handles and terminate with error; no reusable recovery is promised. Native aborts kill the bounded child; no safe in-process native cancellation claim. Future native/capture/CPU gates require separate actual validation; no performance claim from source topology.
