# Direct V8 target-site four-case support source

This separate source profile starts at the reviewed target-site fixture
`9367cfa9a8f6ffaaee2afaa59be4735e6b494aad`. It holds the prior 70 source
roles and four target-site fixture roles byte-exact, and admits only this
namespace and its dedicated workflow. The corrected addon still differs from
the older addon by the single `#include <v8-profiler.h>` line. The runner
builds that source in its own hosted job and does not reuse an earlier binary.

The runner admits the same pinned Node archive, complete header map, compiler
and five tool identities, closed compiler environment, arguments, bounded
process, post-tool observations, and first-failure order as the previous
support profile. Before each of four fresh children it reopens the Node
executable, same-run addon, and exact new `case.mjs` and `policy.mjs` bytes.
It records a load attempt before launch, with an unknown load result until
the child and its raw files pass independent grading. A failed child stops
the sequence and retains bounded partial raw reports.

The new CPU-free grader requires exactly the target fixture's
`allocateTarget` callsite at line 16, full bounded ancestry, canonical uint64
sample IDs, exact pre/post selected ID sets, a single designated GC and all
64 weak callbacks in the finite four-case order. This tests only this small
fixture and the reported sampler lifetime behavior. It does not measure the
xv6 workload, total allocated bytes, CPU cost, guest semantics, or speedup.
The original strict sample-ID failure remains a failure of the old fixture;
this source has not been compiled or run with Node, V8, or a guest.

The label-only workflow requires a same-repository exact head and first
attempt. Its 72-MiB closed report-only inventory excludes Node/addon binaries,
archives, headers, images and RAM. A prospective positive
`FOUR_CASE_TARGET_SITE_SUPPORT_ONLY` status still requires independent audit
of the original hosted packet before any further profiling claim.

CPU-free controls:

```sh
python3 -B scripts/xv6-js-rollback-direct-v8-target-site-support/source-control.py
python3 -B scripts/xv6-js-rollback-direct-v8-target-site-support/grade-control.py
python3 -B scripts/xv6-js-rollback-direct-v8-target-site-support/control.py
python3 -B scripts/xv6-js-rollback-direct-v8-target-site-support/inventory-control.py
```
