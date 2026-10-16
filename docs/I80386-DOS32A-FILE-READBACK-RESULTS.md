# Owned DOS/32A LE client: protected file readback, seek and EOF

The [sole hosted four-case gate](https://github.com/CrispStrobe/bw-board/actions/runs/38860693983)
passed at source `a66718199f9b7d6a1ae8c8e46f6f8d4331b91c6f`, tested tree
`078c09c4f3e6a9fa5c9c14ef206d5be12c86c65f`, in
[job 116842056116](https://github.com/CrispStrobe/bw-board/actions/runs/38860693983/job/116842056116).
The [original artifact](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/12029405468)
is a 97,032-byte ZIP, SHA-256
`329c713ab40bea2cd9bd84746bc0815b15620518743c4aea6a214f4be5bae56c`.
Independent original-only review and the standalone reader accept the 43
original roles, unchanged 353-row Git/live source census, observed runtime
identities and successful owned cleanup. The reader reports
`finiteFileReadbackPass: true` and `wholeDiskByteProof: false`.

[Source PR635](https://github.com/CrispStrobe/bw-board/pull/635) merged as
`1fbb9e647e830c9dd5af3d6cecfe9cc021b24d8e`, tree
`3a3733d703e2e36df12ec1843c003f17050b8b2c`. Its ordered parents are
`a72acc06ac07fcbeb0c4760d0c3a41a7aa6ee8dd` and the tested source above.
The newer base added unrelated labwired work. All nine owned source paths,
six immutable helpers and the complete 40-module x86 JavaScript runtime graph
are unchanged in the landed composition; the conservative source census has
one unrelated changed row, `src/labwired-catalog.js`. The 353-row observation
belongs to the tested source, not the whole landed tree. No guest was repeated
for that unrelated composition.

The [authored generator and gate](../scripts/i80386-dos32a-file-readback/README.md)
use one 8,192-byte LE32 client without an MZ stub, compiler or extender bytes.
Its SHA-256 is
`c4cd62d6e884264f03eda088c826c9158564d2a3c1250120844a2efa1937d1f3`.
After completed, unredirected `BW-LE-FILE-READY`, guest keyboard input supplies
lowercase `a` or `b`; DOS AH08 consumes it. No DOS-buffer stuffing or guest-memory
input injection is used. Case `a` has 17 bytes `(37*i+0x11)&255`; case `b` has
31 bytes `(53*i+0xa7)&255`, for zero-based byte index i.

The client creates `C:\DATA.BIN`, checks the complete write and close, and
reopens it read-only. It reads N bytes into a 64-byte protected buffer, seeks
that same live handle to absolute position N-5, requests 8 bytes into a separate
16-byte buffer and receives 5, then requests one byte at EOF into a third
16-byte buffer and receives zero. The observed requested and returned seek
positions are 12 and 26. Actual pre-call buffers contain `CC`; all untouched
tails and eight-byte prefix/suffix guards remain unchanged. Every file service,
carry, complete return count, seek position and close is checked. AH08 carry
state is not treated as defined.

Four fresh processes ran serially with identical initial media and client:

| Engine | Input | Payload bytes | Proof count bytes: full/short/EOF | Ordinary target step calls | Observed child wall time (s) |
| --- | --- | ---: | --- | ---: | ---: |
| JavaScript AT | `a` | 17 | `17 / 5 / 0` | 48,600,000 | 18.4961 |
| QEMU pc/486 | `a` | 17 | `17 / 5 / 0` | — | 7.3972 |
| JavaScript AT | `b` | 31 | `31 / 5 / 0` | 48,600,000 | 18.6004 |
| QEMU pc/486 | `b` | 31 | `31 / 5 / 0` | — | 7.2942 |

The 155-byte `C:\RESULT.BIN` contains `BWFR1`, the selected key/N, three
saved actual DOS return count bytes and success byte `A5`, actual 64/16/16-byte
buffers, and all six actual eight-byte guards. Each guard is
`A5 5A A5 5A 3C C3 3C C3`. Full EAX returns are checked before saving and
narrowing; immediate post-call frames, saved 32-bit counts, proof header and
original file bytes join. The two exact proof SHA-256 values are:

| Input | 155-byte proof SHA-256 |
| --- | --- |
| `a` | `53ed14cbc792e80fe88f2ac9714d997e4cf3a658421b3f2601afd35c1102f7c2` |
| `b` | `4376b5d8223e2838c3b6e5a656c7e62563f6a718e1c4dfe776104863f71f70af` |

The target preserves ordinary `machine.step`. Its 29 ordered witnesses bind
the full initial owned payload, PE/CS.D, fixed opcode windows, original CALL/POP
EBP anchor and CS/DS extents. Original DS:EDX operands locate the named,
nonaliasing protected buffers; snapshots immediately after INT21 precede later
validation or stores. Every read, seek and read-handle close joins the successful
reopen handle and actual service operands. Full return registers, pre/post
buffers, guards, seek origin/offset and returned position establish the protected
read boundary; final file bytes alone are insufficient.

After checked proof write/close and zero exit, the batch creates `KEYOK.TXT` as
`BW-FILE-EXIT-0\r\n`, with no failure marker and a current prompt. Only a later,
separately offered VERIFY command creates `RETURN.TXT` as
`BW-FILE-SHELL-RETURN\r\n` and reaches a fresh current prompt. QEMU supplies
independent original QMP key events, VGA cuts, selected files and process
outcomes. Its proof count bytes match the target's; no QEMU architectural-state
witnesses or target/QEMU state parity are claimed. Both QEMU cases acknowledged
quit and exited zero. The frozen gate can also retain specific disconnect
observations joined to successful terminal status; the held helper's
`QMP reply extent` conflates EOF and an oversized reply, so that observation
would not establish a validated quit reply.

At boot, READY, response and final cuts, and in the final selected-file capture,
original evidence retains both FATs, root entries and only clusters for
`DATA.BIN`, `RESULT.BIN`, `KEYOK.TXT`, `KEYFAIL.TXT` and `RETURN.TXT`.
All five names are absent initially and at READY. Both current root-chain
ownership and every selected cluster's free allocation in the copied immutable
initial FAT are checked before any selected data copy. Response data/proof/zero
exit precedes VERIFY; the return marker appears only later. Full disks,
client/extender binaries and boot-media sectors are excluded. Observed disk
hashes are not independent whole-disk byte proof.

The fixed inputs remain FreeDOS 1.4 `120m/x86BOOT.img`, DOS/32A 9.1.2 and the
reviewed firmware identities. The raw FreeDOS acquisition archive and receipt
are absent from the artifact; admission relies on the hash-bound staging helper
and extracted image identity. DOS/32A comes from the
[pinned public source](https://github.com/amindlost/dos32a/tree/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc).
Its custom license and acknowledgment are retained: “This product uses DOS/32
Advanced DOS Extender technology.” Firmware notices are retained too. No new
binary bundle, blanket redistribution or license-clearance claim is added.

Each child used one logical CPU/100% quota, 1 GiB RAM and zero swap, with a
600-second wall bound; targets also had a 120-million-step bound. The controller
had 2,500 seconds and the job 45 minutes. Original before/after/between-case
resources show no new OOM; all children exited zero, were reaped and left empty
owned groups. The controller was collected after its known wait and its cgroup
was absent. The held QEMU limits also kept core dumps disabled, virtual address
space at 64 GiB and each file at 32 MiB, under the enclosing 1 GiB cgroup.
Observed runtimes include Node 22.23.3, Python 3.12.3 and QEMU 8.2.2 with its own
TCG `pc`/`486`, 4 MiB BIOS/VGA profile. These are observed executable/firmware
identities, not complete dependency authenticity or a canonical QEMU profile.
The completion times above are not a performance or RTx benchmark.

This extends the [keyboard/write result](I80386-DOS32A-KEYBOARD-RESULTS.md) to a
finite protected-buffer file-input boundary. It does not qualify general DOS
error paths, strict original 386DX behavior, DPMI/high-linear/timer behavior,
physical timing, mouse/IRQ fidelity, full OS compatibility, installed GUI or a
release. The next dependency gate is the existing Lite HDD/GUI handoff:
[runner prerequisite PR986](https://github.com/CrispStrobe/brickwright-lite/pull/986)
remains unmerged with an unrelated WeDo policy unit-check failure. Consumer-owned
prerequisite checks, explicit dependency adoption and fresh installed acceptance
remain separate. This result changes no consumer pin or notice and does not
justify repeating the successful supplier guest.
