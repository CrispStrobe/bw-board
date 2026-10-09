# Direct V8 rollback-allocation support source

This is a **source-only, uncompiled checkpoint** on the exact f297 rollback
profiler base. It does not qualify allocation flags or run xv6. The existing
Inspector fixture and both failed original hosted attempts remain unchanged.

`addon.cc` uses the Node 20.20.2 V8 sampling API without `kSamplingForceGC`.
It holds at most 64 native weak handles, 256 GC events, 4,096 profile nodes and
65,536 samples. Weak and GC callbacks write fixed primitive slots only. A
snapshot retains sample IDs as decimal strings so JavaScript cannot round
64-bit values. `support-case.mjs` is one isolated process for each of
`minor-baseline`, `minor-enabled`, `major-baseline` and `major-enabled`. The
source-owned `allocateCohort` factory keeps targets strong through a first
profile and an event-loop turn, then releases them. The pure policy requires
an attributable GC, all 64 native weak callbacks and the exact pre/post ID
predicate. A missed collection or extra event is a refusal.

The official [Node 20.20.2 header archive](https://nodejs.org/dist/v20.20.2/)
is SHA-256 `46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836`.
`build.py` reads a previously acquired archive, verifies its complete bytes,
unpacks bounded regular files, and records header/member hashes, compiler
version/arguments, source hash and built addon hash. It does not fetch inputs
or upload the `.node` binary. Exact executable/compiler admission, ABI build,
four hosted support children, raw profile retention, and the same three-child
xv6 semantic gate remain separate required work. No guest or CPU benchmark
claim follows from this source.

CPU-free controls: `node scripts/xv6-js-rollback-direct-v8/support-policy-control.mjs`.
Do not run `support-case.mjs` until a reviewed hosted build/runner admits the
exact Node executable, source, header archive and addon binary.

The addon itself is MIT-licensed. Node's public header distribution and V8
carry their own notices; keep those source/archive obligations attached to
any hosted build and do not redistribute the temporary binary as an artifact.
