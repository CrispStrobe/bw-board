# Proposed finite owned LE32 file readback

This source candidate has not executed a guest. It generates one authored
8192-byte LE32 client, without an MZ stub, compiler or extender bytes, and runs
two distinct case payloads in four fresh serial processes: target/a, QEMU/a,
target/b, QEMU/b. Case `a` has 17 bytes `(37*i+0x11)&255`; case `b` has 31 bytes
`(53*i+0xa7)&255`.

After completed unredirected `BW-LE-FILE-READY`, the guest consumes key `a` or
`b`. It creates/writes/closes `C:\DATA.BIN`, reopens read-only, reads exactly N
bytes into its protected 64-byte buffer, seeks to N-5, requests 8 bytes and gets
5 in a separate 16-byte buffer, then requests one at EOF and gets zero in a
third 16-byte buffer. All have eight-byte prefix/suffix guards; untouched tails
remain `CC`. Check every DOS carry/count/position and close. The buffers are
initialized in the generated LE payload; actual pre-call memory proves their
prefill and guards before each read.

The 155-byte `C:\RESULT.BIN` proof contains `BWFR1`, case/N and three saved
ACTUAL returned count bytes plus success byte, actual 64/16/16-byte buffers and
all six actual guards. Full EAX counts are validated before saving/narrowing;
expected N/5/0 constants cannot stand in for returned counts. After checked
proof write/close and zero exit, the batch creates `KEYOK.TXT`; only a separate
VERIFY command creates `RETURN.TXT` and returns to a fresh current prompt.

The target preserves ordinary `machine.step`. All 29 source-bound witnesses
include original registers, PE/CS.D, CS/DS descriptor identity and exact owned
instruction windows. `dsSelector` duplicates architectural `cpu.ds`; the actual
cache at index 3 supplies base/limit and has no selector property. Each read
captures original service, reopened handle,
count, DS:EDX buffer and pre/post memory/guards; immediate return witnesses
precede JC/CMP/MOV. Seek captures actual origin/offset/handle and returned
position; read-handle close joins the same reopened handle. Proof memory and
saved full counts join those return frames. Initial whole 4096-byte payload
identity and fixed independent reader offsets/windows prevent metadata from
changing accepted pointers. Authenticated guest failure paths and actual
failure markers terminate promptly while retaining earlier return frames.

QEMU TCG `pc`/`486` with `-m 4` uses its own BIOS/VGA profile and actual QMP
keys/VGA/file/process records. It is a compatibility oracle, not strict 386DX
or architectural-state parity. Both engines expose original FAT1/FAT2/root and
ONLY selected DATA/result/exit/failure/return file clusters. All current root
chains and every selected cluster's frozen initial-free allocation are admitted
before ANY selected data copy at every captured cut. A deleted current foreign
entry does not authorize its initial clusters. Full disks, client/extender and
boot-media sectors are excluded; observed image hashes are not whole-disk proof.

`source.py` authenticates a complete Git/live namespace/engine/helper/firmware
census before target imports and after all four children. Six immutable helpers
remain pinned to predecessor `c0c880b6838ac118f36eac7eab7747d24535f9a8`;
only held lifecycle/resource/runtime primitives are reused from its controller.
Old run/inventory/selector/reader functions do not qualify this namespace.
FreeDOS 1.4, DOS/32A 9.1.2 and BIOS/VGA pins/notices stay unchanged. Retain the
DOS/32 Advanced custom license and acknowledgment: “This product uses DOS/32
Advanced DOS Extender technology.” No binary bundle or license clearance is
added. Raw acquisition archive/receipt absence cannot be promoted into raw
archive/member provenance; staging-helper and extracted-image identity are
the stated boundary. Runtime executable/firmware identities are observed,
without complete dependency authenticity.

Proposed limits are 600 seconds, one logical CPU/100% quota, 1 GiB RAM and zero
swap per child; targets additionally have 120 million ordinary steps. The
controller has 2500 seconds and the job 45 minutes. Retain first failures,
stdout/stderr, wait4 status, before/after/between-case resources, no new OOM and
empty owned groups/cgroup. Query/read errors reject cleanup; a collected unit
requires its known wait. Job and both prelaunch boundaries require attempt one.

The held QEMU launcher also keeps core dumps disabled, a 64 GiB virtual-address
limit and a 32 MiB per-file limit; the enclosing 1 GiB cgroup remains the
physical-memory bound. These held limits have not been changed. Operation errors
remain primary when cleanup or evidence retention also fails; secondary errors
are retained where possible. A successful oracle requires no secondary errors.
Its quit observation distinguishes an acknowledged command from a disconnect,
and always requires the original zero exit, reaped child and empty group. The
held helper's `QMP reply extent` error conflates EOF with an oversized reply;
that exact observation is retained without claiming a validated quit reply.
Other protocol and transport errors fail the run.

Local controls are only authored bytes/scalars and exact source functions with
mocked boundaries; they never import or execute an emulator:

```sh
python3 -B scripts/i80386-dos32a-file-readback/controls.py
node --test test/i80386-dos32a-file-readback.test.mjs
```

A complete manufactured packet/ZIP positive and fully rehashed semantic mutants
exercise the independent standard-library reader. They do not prove a guest
result. Directory mode proves reported consistency only. Artifact mode requires
independently admitted official event/head/attempt/job/workflow/artifact/cleanup,
source, runtime and all original role identities. Acquire each new original once
and audit unchanged bytes without guest replay. Never rerun or reacquire an old
successful actual to read it.

Source/reader review and enabled exact-head CI precede a separately frozen,
separately admitted one-shot hosted `x86-dos32a-file-readback-actual` event. No
label/dispatch/retry is authorized by these controls. No whole-disk, strict
386DX, DPMI/high-linear/timer, full OS, physical timing, mouse/IRQ, performance/
RTx, installed GUI or release qualification follows from this source candidate.
