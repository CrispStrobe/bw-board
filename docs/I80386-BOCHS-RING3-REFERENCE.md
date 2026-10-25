# Bochs CPU3 Ring 3 reference source candidate

Status: merged claim and metadata V2 amendment; inactive V2 source candidate.
The consumed metadata V1 attempt failed and remains unqualified. New V2 and
current Build/Reference execution guards are disabled; their events are
unselected and unqualified. The exact envelope is the
[new Bochs claim in LANES.md](../LANES.md). Preserve the separately owned
same-job V3 cleanup lane and every consumed event/original.

The existing authored fixture expects descriptor accessed bits to be written
when its kernel/user code selectors load. The selected
[V2 run](https://github.com/CrispStrobe/bw-board/actions/runs/40130461323)
retained JavaScript agreement but QEMU differences at physical address 0x100d and 0x101d,
as well as an independent outside cleanup failure. Existing strict readers
continue to refuse; this proposal grants no architectural pass.

[Intel 80386 PRM](https://read.seas.harvard.edu/~kohler/class/aosref/i386.pdf),
sections 5.1.1 and 10.4.3, documents descriptor A writes. Pinned
[Bochs load_cs/branch_far](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/ctrl_xfer_pro.cc)
calls the genuine
[descriptor-byte writer](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/segment_ctrl_pro.cc).
Use this LGPL tool independently, retain its
[project and file notices](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/LICENSE),
and preserve the MIT Board CPU/fixture instead of copying engine code.

The source pin matches the earlier
[CPU3 reference work](I80386-REFERENCE-EMULATORS.md). Its old standalone binary
and profile-locked native addons are not provenance or runtime admission for
this new ring3 capture. A fresh HOSTED standalone build must retain full
source/tool/config/license and binary/library/manifest identities. Proposed
build bounds are one CPU, 2 GiB, no swap, 64 tasks, 900-second child, 960-second
outer and 20-minute job. They are not demonstrated sufficient. No local build
or guest is authorized by this leaf.

Treat the selected Node toolcache as input data. Before executing Node, make
one owned, read-only stage copy and verify its bytes, identity and readback;
retain the fixed copy, resource-limit and cleanup facts. Admit the compiler's
identity from separate build metadata rather than inferring it from a local
executable. Preserve the exact VGA source and its notices alongside any
reviewed configuration that uses it. Local source and mocked tests establish
the protocol only; they do not qualify a Bochs build or reference execution.

A separate runtime selection follows only after root admits official build
metadata, the checkout/source/build manifest from the sole retained build-job
log, and the archive's official digest/size. The runtime job is the sole getter
of that official build archive. It keeps the exact ZIP inside its own result
artifact so the independent reader can rederive it without a second Build GET.
Closed archive and nested bundle bounds, exact raw originals and unknown/
partial refusal remain mandatory; no invented binary identities or approval.

The unchanged ROM emits 1730 bytes including its magic/end. Bochs also has a
real startup stdout header and lacks QEMU's F4 exit. The new protocol retains
all stdout/stderr/log bytes, independently locates exactly one complete frame,
and records the actual checkpoint-triggered stop/signal/reap/cleanup. It may
not call that a natural QEMU exit, strip evidence, mask bits or normalize the
frame. A proposed one-CPU/1 GiB/no-swap/64-task/60-second runtime envelope
needs separate source/resource admission and a genuine bounded capture.
Default VGA/CMOS/share resources, if required, must be explicitly disabled or
reviewed and pinned with notices; no fallback download or guessed absence.

Next: qualify the final source head and independently admit each separate
metadata, Build and Reference request/event. Keep that source head fixed across
the three events, with each executing workflow and request frozen separately.
Source arming grants no actual approval. Actual result, whole OS,
strict 386DX physical accuracy, timing/RTx and release approval remain false.

The candidate preserves the consumed metadata V1 failure and its strict
partial-packet refusal. Metadata V2 has a distinct armed, unselected route and exact
cache DATA owner/mode policy, separate from each protected bootstrap caller.
Current Build/Reference inputs explicitly require V2 metadata and staging;
legacy modes remain available only for interpreting old originals. Connected
manufactured controls establish source wiring, not compiler or guest results.
Current V2 producer/reader flags and the metadata V2 job are armed for source
qualification; V1 execution remains disabled. Fresh source review, exact-head
CI and separate event/original admission are required before any new selection.

The current runtime bundle contains no host-library, loader or Node bodies.
It keeps the compiled Bochs payload, selected VGA, authored inputs, notices and
complete selected Bochs/VGA corresponding sources. Matching host libraries are
staged transiently per job and used through the verified staged loader. Sparse
ELF metadata supports independent structural decoding, while complete-file
SHA256 values remain observed readback facts. This boundary does not prove a
whole-system dependency closure or grant blanket licence clearance. Whole
cleanup reservation precedes every deletion; unknown files, resource drift,
close uncertainty or incomplete originals remain failures.

Metadata V2 records fresh held/named ownership and bounded empty/member census
before any cleanup mutation, independently of cache-content approval. Its
complete prospective cleanup/error wire must fit 16 KiB before effects. The
V1 created-empty directory facts do not establish live named or terminal
cleanup, and cannot be upgraded by the repair. The existing pinned Node bytes,
exclusive root copy/reopen/hash before publication, CPU wire, limits and
component/source obligations remain unchanged.
