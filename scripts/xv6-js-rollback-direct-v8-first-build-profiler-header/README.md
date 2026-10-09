# Direct V8 profiler-header first-build source

This separately named source profile is uncompiled and unrun. The original
unloaded first-build attempt failed during compilation because the owned addon
used `v8::HeapProfiler` without including its defining header. This profile
keeps the 51 inherited source roles byte-exact and derives `addon.cc` from the
held owned addon by inserting only `#include <v8-profiler.h>` after
`#include <v8.h>`. Its source and runner both refuse any other addon delta.

The hosted adapter repeats the reviewed exact Node 20.20.2 archive, complete
header map, five compiler/tool identities, fixed arguments, closed environment,
90-second/32-KiB compile bound, and all five post-compile observations. It
retains the compiler failure first if a later tool observation also fails.
A successful run would report only the SHA-256 and size of an **unloaded**
`.node` file. No binary, archive, header, guest, or RAM bytes are uploaded.
There is no addon-load, allocation-support, xv6, or performance result here.
Further compiler/API errors remain possible.

CPU-free checks:

```sh
python3 -B scripts/xv6-js-rollback-direct-v8-first-build-profiler-header/source-control.py
python3 -B scripts/xv6-js-rollback-direct-v8-first-build-profiler-header/control.py
python3 -B scripts/xv6-js-rollback-direct-v8-first-build-profiler-header/inventory-control.py
```

The dedicated labeled workflow alone can run the hosted compile after exact
source review and enabled checks. Its report and source receipt are bounded;
it uploads only after the closed report-only inventory succeeds.
