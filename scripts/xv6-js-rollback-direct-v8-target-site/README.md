# Direct V8 target-site support fixture (source checkpoint)

This proposed free, owned fixture separates the sampled target allocation from
cohort bookkeeping. `case.mjs` makes one `new Array(1024)` target per call to
`allocateTarget`; its caller builds and strongly holds exactly 64 distinct
targets before the first profile and passes them to the unchanged native
addon. The source-owned policy selects the target function at its exact script
and start line. It keeps canonical unsigned 64-bit sample IDs, complete node
ancestry, four ordered cases, a nonempty pre-profile set, exact baseline death
or enabled retention with no extra selected IDs, the GC window, and all 64
native weak callbacks.

The first broad factory profile retained one sampled allocation beneath its
factory call tree after all 64 adopted targets were collected. This new
fixture changes the workload and attribution source rather than excluding an
observed ID, size, or leaf line from that result. A V8 sample ID identifies a
sample; matching a source site does not by itself identify an adopted object.

This is **source only and unrun**. The control is authored for a later hosted
CPU-free check and has not been executed at this checkpoint. No runner,
source manifest, workflow, exact input admission, artifact inventory, or
independent raw-packet reader selects this namespace yet. The existing four
case result remains unqualified. A later gate must review those bindings and
the exact Node, addon, compiler, profile, and report inputs before any hosted
use. There is no emulator, guest, benchmark, or performance claim here.
