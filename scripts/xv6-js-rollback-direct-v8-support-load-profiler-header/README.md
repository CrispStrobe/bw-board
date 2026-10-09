# Direct V8 four-case support load, corrected header profile

This source-only, unrun profile begins at the audited profiler-header first
build `b8ce3eb36d6022eb82415c80fdbcf9b37e23284f`. That hosted result
reported one **unloaded** 33,896-byte addon. This new profile does not reuse
its binary. It keeps all 60 inherited source roles byte-exact and repeats the
corrected one-include addon build in the same hosted job that would load it.
The source identity checks the held addon and corrected derivative differ by
exactly `#include <v8-profiler.h>`; the new runner binds the corrected addon,
not the older missing-header source. It imports only byte-bound archive,
compiler, tool-roster and bounded-process helpers from the corrected build
profile; it owns its own expanded source admission and report schema.

Before each child, the runner reopens the verified Node executable and same-run
addon and retains their SHA-256/size leases. It starts fresh isolated
`minor-baseline`, `minor-enabled`, `major-baseline` and `major-enabled`
processes using the unchanged owned support case. Major cases alone use
`--expose-gc`. Each child has a 45-second wall and 32-KiB combined-output
bound. A child refusal stops before later cases and keeps bounded partial raw
reports. The CPU-free grader checks exact four result roles, reviewed factory
callsite, pre/post sample IDs, collection-window and weak-callback predicates,
and closed unpoisoned native facts. The original compiler refusal remains the
first failure ahead of any later post-tool refusal.

The dedicated workflow admits only the exact reviewed source, same-repository
head, first labeled attempt and closed report-only inventory. Raw pre/post
profiles, facts and result reports are bounded by a 72-MiB aggregate ceiling.
It excludes Node/addon binaries, archives, headers, guest images and RAM. A
future positive status would be `FOUR_CASE_SUPPORT_ONLY` pending independent
packet audit; it would not establish xv6 allocation hotspots, total allocated
bytes, CPU cost, guest semantics or speedup. Additional native ABI or GC
failures remain possible.

CPU-free controls:

```sh
python3 -B scripts/xv6-js-rollback-direct-v8-support-load-profiler-header/source-control.py
python3 -B scripts/xv6-js-rollback-direct-v8-support-load-profiler-header/grade-control.py
python3 -B scripts/xv6-js-rollback-direct-v8-support-load-profiler-header/control.py
python3 -B scripts/xv6-js-rollback-direct-v8-support-load-profiler-header/inventory-control.py
```
