# Task-attempt facts and GC-support refusal

Both exact heads passed every enabled ordinary check before one dedicated
label application. Both actual runs failed and their originals remain frozen.
Root and separate Sol readers audited original packets and finite failure
facts without producer imports or guest replay. Packet admission passing is
separate from guest/profiler qualification. Exact identities are in the
[summary](summary.json).

## The handler attempts a task jump

[PR468](https://github.com/CrispStrobe/bw-board/pull/468), reviewed source
`f3b8b31d6e403020089f1dee31eaece45c06ac25`, passed 12 enabled checks with two
optional skips. Actual [run37893093332](https://github.com/CrispStrobe/bw-board/actions/runs/37893093332)
retained [artifact11598672750](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11598672750/zip).
Its 112 report-only members, 196 source roles and 62 JavaScript nodes matched
immutable source and inventory admission.

The same owned INT31/AX0501 entry was committed: gate14, code16 handler,
stack32, CPL3 to CPL3, 12-byte frame and 4,096-byte request. At active step20
the new ticket records `jmp`, target selector `0x70`, current source
CS:EIP `0x2b:0x3e38`, CPL3, NT clear, current TR selector `0x60` and cached
type11. EIP is the current value at the guard, not a decoded instruction start.
The first refusal is still `task-switch-during-owned-frame`, return remains
null, and the client has no completion output. The ticket is recorded before
task descriptor validation: it proves the attempted path, not the target's
validated descriptor type or the task-switch outcome.

Next: a separate bounded post-core outcome diagnostic distinguishing normal
core return, recognized faults with or without the core
`taskCommitted` marker, and unknown throws. Absence of that marker does not
prove side-effect-free rollback: the core can write task state before it marks
later exceptions. Preserve original guest return/throw identity and external error-code
handling. Read only primitive own-data diagnostic fields; retain the current
ownership refusal and grant no frame/IRET credit.

## The minor-GC witness is unsuitable

[PR469](https://github.com/CrispStrobe/bw-board/pull/469), reviewed source
`f2971d8ae7bd67a30f13baa45b63956790d9b975`, passed ten enabled checks with two
optional skips. Actual [run37893388067](https://github.com/CrispStrobe/bw-board/actions/runs/37893388067)
retained [artifact11599252623](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11599252623/zip).
All five report-only members and 18 source roles matched their inventories.

The first minor baseline created 64 targets. After eight bounded pressure
blocks, its recorded window contains six minor and zero major collections,
but zero targets reported unreachable. The release-to-pressure interval has
no recorded GC. It refuses `0 != 64`; no support receipt, image build or xv6
child exists. The raw profile contains two live factory samples (264,192
sampled bytes), which are not collected-allocation or CPU-cost evidence.

Pinned V8 source explains the witness limitation: its
[JSWeakRef descriptor](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/objects/objects-body-descriptors-inl.h)
uses custom weak-pointer traversal, whose
[default visitor](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/objects/visitors.h)
feeds ordinary pointer traversal. The
[minor scavenger](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/heap/scavenger-inl.h)
treats these references strongly. More nursery pressure is therefore not a
sound way to prove minor-only death for this JSWeakRef fixture.

There is a second isolation gap: the pinned
[Inspector implementation](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/inspector/v8-heap-profiler-agent-impl.cc)
sets the forced-GC sampling bit, and the
[profiler](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/profiler/sampling-heap-profiler.cc)
collects the heap when obtaining a profile. The recorded event window ends
before retrieval. These source observations explain why the witness must be
redesigned; they do not establish a complete source-to-binary reproduction.
The same pinned Inspector source declares and implements both collected-object
flags. This failed fixture does not prove those flags unsupported.

Next: separately review a direct V8 sampler without forced GC, a fixed cohort
with native weak-handle callbacks, matching pre/post sample IDs and GC events
covering retrieval. Keep the emulated workload unchanged and retain complete
semantic comparison. No allocation hotspot, speedup, RTx or source
adoption claim follows from either failed diagnostic.
