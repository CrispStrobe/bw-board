# Finite owned LE keyboard challenge

The [four-case hosted result](../../docs/I80386-DOS32A-KEYBOARD-RESULTS.md)
passed at source `c65edcb2cbbd45f19d1150e2461877f130ff1847`, with independent
original-only audits and the standalone reader. It uses one authored 8192-byte
LE32 client without an MZ stub or extender bytes. After unredirected
`BW-LE-INPUT-READY`, actual hardware input supplies lowercase `a` or `b`.
DOS AH08 consumes the key; unsigned multiplication by `01010101` followed by
XOR `5A5A5A5A` produces `3B3B3B3B` or `38383838`. The checked DOS
create/write-five-bytes/close sequence writes `C:\RESULT.BIN` as
`613b3b3b3b` or `6238383838`. Errors exit nonzero. The shell writes a zero-exit
marker, then a separately offered VERIFY command writes a return marker.
Readiness is never redirected. No internal DOS-buffer or guest-memory injection
is used.

Four fresh serial cases are fixed: target/a, QEMU/a, target/b, QEMU/b. Each
starts with the same initial FAT16 master data disk and the pinned FreeDOS
1.4 1200 KiB boot floppy. Target evidence authenticates the entire generated
initial payload and records PE/CS.D/linear-code preinstruction witnesses:
read=16, consumed=20 (AL before MOVZX), computed=60 (EAX before result store),
closed=127 (five actual result-memory bytes after checked close), exit=142
(AX after MOV 4C00 and before INT21). Execution uses ordinary `machine.step`.
There is no owned-PC requirement while DOS is blocked. QEMU pc/486 with TCG,
4 MiB and independent BIOS/VGA is a 386-class compatibility oracle, not strict
386DX or matching CPU/device-state evidence. Its originals are QMP input events,
VGA snapshots and selected disk-file evidence.

The immutable old QMP/FAT/key/archive helpers are hash-bound by `source.py`;
none of their historical pins or results change. New source census conservatively
covers all tracked `src/`, this namespace, selected helpers, firmware and package
module metadata before Node imports and after all cases. Runtime executable
paths, versions, extents and hashes are observed before/after; this is not
complete executable/ELF/stdlib authenticity. FreeDOS archive/member, DOS/32A
9.1.2 executable and license, and Bochs BIOS/VGA identities remain fixed.
DOS/32A has its own license and required acknowledgement:
“This product uses DOS/32 Advanced DOS Extender technology.” Firmware LGPL
notices and source obligations remain. There is no new media redistribution
clearance or binary bundle.

Each child has a 600-second wall bound and the target has 120 million ordinary
step calls. The enclosing owned systemd service has a 2500-second hard lifetime,
one logical CPU/100% quota, 1 GiB RAM and zero swap. The job has 45 minutes;
acquisition/setup occurs outside the service lifetime. Memory pressure is observed;
OOM counter changes reject. Exact owned-unit terminal/empty cleanup runs before
artifact upload and its official step must succeed. Children retain original
stdout/stderr, wait4 status/usage, resource observations and first failure.
Failed unit queries or cgroup-member reads reject cleanup; a collected unit
requires the completed owned wait. Both prelaunch shells refuse run attempts
other than one, matching the actual-job and reader admission guards.

Artifacts exclude full disks, client/extender and boot-media sectors. At boot,
READY, response before VERIFY and final prompt, original FAT1/FAT2/root regions
and only selected file clusters are retained, with fixed offsets (9216,30208,
51200,67584 data base), extents and observed whole-image hashes. All root FAT
chains are checked before selected data capture to prevent crosslinks leaking
other files. Every selected cluster at every capture must also be free in the
copied pre-guest initial FAT, before any selected bytes are copied; deleting a
current foreign file cannot authorize its former content. The independent
reader repeats this initial-allocation check for every screen and final region,
then parses both FATs and original data; it
checks absence, five-byte response, zero exit and later shell return in order.
These are selected-file proofs. Missing full disk bodies mean the reader does
not independently rehash or prove unchanged whole disks.

Local controls are authored bytes/scalar arithmetic and exact pure source
functions plus the exact cleanup shell with mocked systemctl/cgroup responses;
they never import or run an emulator. Full manufactured packet and ZIP positives
exercise the reader, with independently rehashed semantic mutants. These
manufactured controls do not establish an actual guest result:

```sh
python3 -B scripts/i80386-dos32a-input/controls.py
node --test test/i80386-dos32a-input.test.mjs
```

The dedicated workflow runs controls on PRs. An actual requires separately
reviewed source/reader, exact-source CI, component/input admission and the
`x86-dos32a-input-actual` label on an own-repository PR. No retries are selected
for a passing result. The standalone reader imports no producer:

```sh
python3 -B scripts/i80386-dos32a-input/reader.py --packet originals
python3 -B scripts/i80386-dos32a-input/reader.py --artifact original.zip --external admission.json
```

Directory mode reports consistency only. Artifact mode also authenticates the
original ZIP against independently supplied official run/attempt/job/artifact,
workflow/head/label/terminal-step facts and externally admitted exact source,
runtime and original role hashes. The external admission is trusted input from
an original-only reviewer, not a producer-issued approval. Even finite keyboard
application success does not qualify whole disks, physical timing, performance,
DPMI, IRQ/mouse fidelity, full OS, installed GUI or release readiness.
