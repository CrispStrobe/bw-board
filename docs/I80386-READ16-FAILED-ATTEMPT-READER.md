# Ordered 16-bit read: retain a failed paired attempt

Status: ownership claim only. The selected ordered-read candidate remains
unadopted. Implement after this claim merges, without changing the CPU arm,
the spent event, its original reader, thresholds or original bytes.

The historical paired source is
[`55917c48`](https://github.com/CrispStrobe/bw-board/commit/55917c48dffe0c7c743388024481ef0a47a7c76c),
which is not the mainline CPU source. Its selected reader is a byte-only,
producer-free Python module at `scripts/i80386-read16-paired/reader.py` in
that historical Git commit; that path is absent from current main. It imports
only standard-library modules. The selected job completed 18 children and
the separate protected xv6 compatibility check passed, but a measured CPU
ratio was below the predeclared every-pair threshold. The unchanged reader
also refused the final inactive-unit status. Neither refusal may be changed
into a passed performance or cleanup grade.

Own only new `scripts/i80386-read16-failure/reader.py` and
`scripts/i80386-read16-failure/controls.py`, this task leaf, the own x86
claim section of `LANES.md`, and own status prose in `docs/X86-NEXT-LANES.md`
if needed. The new module is standalone and producer-free; do not copy the
old candidate CPU arm or import its controller. It receives the old reader
digest and original request/source/official identities as externally pinned
inputs. Its own commit, tree and file SHA-256 require separate external
review and binding; neither the original packet nor its report can select
the auditor. The historical reader, source row roster, source files, thresholds,
workflow, original packet and mainline CPU source remain byte-held.

Classify the retained complete 18-child schedule and semantic/device facts,
the seven measured whole-child CPU/wall ratios, the failed strict gate and
bounded terminal observation as **one failed attempt**. A zero stop exit and
empty direct/nested cgroup and PID censuses may coexist with a stale failed
unit status; retain those distinct facts. Refuse populated or nested
descendants, wrong unit identity, unknown terminal fields, changed child
order, altered semantic goldens, missing failures or any crossed source,
archive, official run/job/artifact or request digest. Preserve finite byte,
time, resource and error-order bounds. A coherent mutation of the old
original must not become a successful CPU comparison.

The report must identify the old reader refusal separately from the new
failure-only classification, and set adoption, performance, guest, physical
timing and full-OS approval false. Public synthetic controls and separately
reviewed offline originals must show the original reader still refuses and
the new reader reports only the failed attempt; test populated/nested PID
mutants, wrong unit/source/official metadata and failure chronology. No
original re-GET, one-shot event replay, workload extension, threshold change,
new guest run or hardware-model inference is part of this task.

A longer paired workload, parent-host capture and profiled replacement CPU
arm remain separate future claims. Keep the old seven-pair median CPU >=1.03,
every CPU ratio >1 and median wall B/A <=1.02 gates when those tasks are
reviewed. This failure-only reader grants no adoption.
