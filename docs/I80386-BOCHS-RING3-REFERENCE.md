# Bochs CPU3 Ring 3 reference status

Status: source remains in unmerged
[PR694](https://github.com/CrispStrobe/bw-board/pull/694). Source bc016f65 passed
all enabled automatic CI, but its separately consumed Metadata V3 event failed
before complete inventory at the unchanged no-RPATH/RUNPATH guard. The
original lacks the offending selected file and tag/value; its partial remains
refused. No Build/Reference or compiler/guest qualification follows. Preserve
all V1/V2/V3 originals, labels and historical reader verdicts.

The next [bounded ELF failure-attribution task](I80386-BOCHS-ELF-FAILURE-ATTRIBUTION.md)
is docs-only now. It collects exact evidence under the unchanged guard;
any later dependency-resolution and licensing policy decision is separate.
Preserve the separately owned same-job V3 cleanup lane and every consumed event.

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

Next: follow the ELF attribution task and its ownership/diagnostic-wire gates.
No new code, event, compiler or guest is selected by this checkpoint. The
positive Build/Reference chain remains blocked until separately reviewed
policy/source and successful metadata admission at its frozen source head.
Actual result, whole OS, strict 386DX physical accuracy, timing/RTx, release
and blanket licence approval remain unestablished.
