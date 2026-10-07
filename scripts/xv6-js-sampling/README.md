# xv6 JavaScript V8 diagnostic

This source-only harness samples the **same stock MIT xv6 `forktest` workload**
used by the [accepted JavaScript comparison](../xv6-js-acceptance/README.md).
It does not change the emulator, choose a default execution path, or make a
performance-adoption decision. An actual guest or profiler result must come
from the dedicated labeled hosted workflow and be audited separately.

The workflow checks out the exact accepted probe source
`22ca742ed60e1350ed96110986a09b2ce84620ac` and builds one fresh stock
4 MiB xv6 image from MIT revision `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`.
The accepted probe remains byte-identical. `derive.mjs` authenticates its SHA,
applies one exact source transform, proves the inverse, and writes one sibling
probe. That sibling starts and stops Node's Inspector CPU profiler around the
existing guest loop, with profiler failures unable to replace an earlier guest
exception. It retains the original source inventory, complete guest report,
and ordinary/dispatch execution behavior. Both generated and qualified source
bytes are checked before and after execution.

There are six bounded fresh processes: one unprofiled ordinary and one
unprofiled native-dispatch reference, then two sampled runs per arm in
alternating order. The unprofiled references establish the **fresh image's**
full CPU, RAM and disk hashes, serial/input, interrupt-prefix, and device
outcome. Every sampled child must match that projection before its raw profile
is summarized. The original successful paired run is read from its exact
official ZIP and compared separately for source, workload, runtime, media
hashes, and the historical guest state after normalizing hosted paths. Its
historical image hash or step count is not imposed on a fresh build.

`profile.py` validates bounded graph, sample IDs, signed time deltas and
timestamps. Only exact canonical file URLs whose bytes match authenticated
source roles receive JS role names. Other file URLs, blank frames, WASM and
native frames remain unresolved; a JS ancestor does not prove its leaf's CPU
cost. A negative time delta leaves sample counts available but suppresses all
delta-weighted bucket values. The profiler perturbs execution; sample counts
are diagnostic observations, not precise cost shares or throughput timings.

The job runs on Ubuntu 24.04 with Node 20.20.2. Each process has the accepted
wall, CPU, RSS, virtual-address, file-size and process-group bounds; raw
profiles are capped at 8 MiB. Source, media, host and raw profile digests are
retained in a bounded artifact inventory. The failure packet preserves the
first guest or admission failure and does not summarize profiles from failed
semantic children. No native addon, private media, restricted guest, or
physical RTx claim is involved.

Source-only controls, without a guest or build:

```sh
node scripts/xv6-js-sampling/derive-control.mjs QUALIFIED_SOURCE_ROOT
python3 -B scripts/xv6-js-sampling/profile-control.py
python3 -B scripts/xv6-js-sampling/run-control.py \
  --qualified QUALIFIED_SOURCE_ROOT --historical-zip OFFICIAL_ORIGINAL_ZIP
```

The qualified root must be an existing exact checkout of the accepted head;
the last control needs the original official artifact. These controls certify
only the derivative/parser/reference admission, not an actual xv6 guest run.
