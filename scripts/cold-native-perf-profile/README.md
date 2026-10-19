# Whole-process native batched perf source preparation

This separate manual workflow is disabled by default. It prepares exactly one
external perf profile of unchanged native worker b01c922c (56 inputs), compiled
7632/DSO40179 and Node 22.23.3. It calls only the byte-pinned d9f setup-entry with
fc0's genuine three-arm authority. It neither invokes pairs nor rebuilds.

Unprivileged setup checks the source Git roles and performs original artifact
restoration. A separate root controller owns the perf process group and cleanup.
The worker is executed with exactly its accepted heap flag/input; a resource-only
exec shim drops to the authenticated common nonroot checkout owner (perf stays
root), then preserves CPU60, V8 heap128, core0, nice10 and worker file16MiB. Perf and
its script output have a separate 64MiB file allowance. Record wall is120 seconds.
These are per-process limits, not a claim of aggregate cgroup CPU enforcement.
Six hooks and the API token are cleared; inherited Git-config overrides are
removed. The unprivileged setup retains only a credential-free ordinary owner
environment whitelist; root verifies HOME/USER and UID/GID against that owner,
rather than exposing root HOME/config defaults. Output ownership and process UID
change only the wrapper, not frozen worker code or inputs. Child Git reads
/dev/null for global configuration and disables system config, preventing inherited
wildcard trust/credential settings without writing config. Read-only safe.directory child configuration names only the exact
native-worker and compiled publication roots; no global or wildcard trust writes.

The executing perf ELF hash and version must equal the genuine privileged C
fixture proof from run37134835355, artifact11278456539 (86,564 bytes, SHA256
83227457ddba0ba7948137fd9f820027568772dee897cf1c62924e23cd615a2d).
That fixture establishes ordinary two-thread sampling only, not Bochs or JIT
unwinding. Missing/changed tools, restoration, worker parity or final map proof
fail closed, with no automatic retry or fallback.

Sampling covers the entire worker/process tree, including startup, Git/helper
descendants and final proof. Raw perf data/script and observed process images,
PID/TID/DSO counts, unresolved blocks and lost-event blocks are retained. Those
counts are not execution-window CPU shares, exclusive removable costs or speed
results. Node threads and helper/Git descendants must be distinguished using the
retained process records. Unknown native/JIT frames remain unresolved rather
than being assigned guessed functions. Symbolized native shares are a future
interpretation of the actual data, not promised by this preparation.

Terminal validation reuses the held full-native166/NQ, board/RAM-hash and PIO
receipt policy against the genuine eighth capture. RAM bytes are not retained.
All immutable source/artifact/Node/derived-binding/input maps are rechecked on
failure and success. No actual setup, privileged profile, addon or guest has run
for this source preparation. Six manufactured pure controls passed (exit0, no
timeout), with complete captured source/helper/Python pins unchanged. These
check admission/parser/resource-shim/cleanup behavior only; actual restoration,
Bochs/JIT unwind quality, sampling volume and profiled terminal parity are unrun.
This README evidence paragraph was added after controls; executable bytes are
exactly the tested bytes.

After the six-control freeze393d3713, root approved explicit read-only Git global/
system isolation. One affected environment control then passed (exit0/no timeout,
all captured pins unchanged). The original six-test receipt is retained separately;
this is a focused delta check, not a relabelled seven-test full-suite run.
