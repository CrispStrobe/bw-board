# Owned DOS/32A LE client: keyboard challenge and checked file response

The [hosted four-case gate](https://github.com/CrispStrobe/bw-board/actions/runs/38849884458)
passed at source `c65edcb2cbbd45f19d1150e2461877f130ff1847`, tree
`2403aaf43218e7843995fd1184529cfc8c02d5c3`, in
[job 116808531533](https://github.com/CrispStrobe/bw-board/actions/runs/38849884458/job/116808531533).
The [original artifact](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/12025225433)
is a 91,159-byte ZIP, SHA-256
`dc790a2146928046616530203ebf7b3a5674bed9e541dcf1fc7974bef353408e`.
Original-only review and the standalone reader accept all 43 original roles,
the unchanged 352-row Git source census, observed runtime identities and
successful owned cleanup. The reader reports `finiteKeyboardApplicationPass:
true` and `wholeDiskByteProof: false`.

The [new authored generator and gate](../scripts/i80386-dos32a-input/README.md)
use an 8,192-byte LE32 client without an MZ stub or extender bytes. Its SHA-256
is `bedf8a2786c64e01cb8810499d869e9243ad94cc44fe43d3a9fb895afa2e7179`.
After the completed, unredirected `BW-LE-INPUT-READY` display, the guest keyboard
interface receives lowercase `a` or `b`; DOS AH08 consumes it. The client computes
unsigned `(key * 0x01010101) ^ 0x5A5A5A5A`, then creates `C:\RESULT.BIN`,
checks the five-byte write count, closes it and exits zero. A separate shell
VERIFY command subsequently creates the return marker and reaches the current
prompt. Readiness is not redirected, and no DOS-buffer or guest-memory input
injection is used.

Four fresh processes ran serially with the same initial media and client:

| Engine | Input | Exact result bytes | Ordinary target step calls | Observed child wall time (s) |
| --- | --- | --- | ---: | ---: |
| JavaScript AT | `a` | `613b3b3b3b` | 48,450,000 | 18.1663 |
| QEMU pc/486 | `a` | `613b3b3b3b` | — | 7.2049 |
| JavaScript AT | `b` | `6238383838` | 48,450,000 | 18.1509 |
| QEMU pc/486 | `b` | `6238383838` | — | 7.2047 |

The target used ordinary `machine.step` scheduling. Authenticated generated
payload bytes, CR0.PE, 32-bit code-segment state and owned linear-code witnesses
bind entry, key consumption, arithmetic, checked close and zero exit. The
challenge key’s make and release events follow readiness; observed AL/EAX values
and later stored bytes match the selected key. Each response precedes the
separately offered VERIFY command. QEMU supplies independent QMP key events,
VGA captures, selected disk bytes and process outcomes, using TCG `pc`/`486`
with its own BIOS/VGA profile. It is a compatibility oracle; the two machines
are not asserted to have matching architectural state.

The selected original disk evidence contains both FATs, the root directory
and only the result/exit/return file clusters at the captured boundaries.
Outputs are absent initially and at readiness. The independent reader checks
the exact response, zero-exit marker and later shell-return marker in order.
Every selected cluster must have been free in the frozen initial FAT before
its bytes are captured, and current root chains must not crosslink. Full disks,
client/extender binaries and boot-media sectors are absent from the artifact;
observed image hashes do not establish an independently rehashed whole-disk
proof.

The boot image remains the pinned FreeDOS 1.4 `120m/x86BOOT.img`. The raw
FreeDOS acquisition archive and its acquisition receipt were not retained in
this artifact; admission relies on the hash-bound staging helper and the
extracted image identity. DOS/32A 9.1.2 comes from the
[pinned public source](https://github.com/amindlost/dos32a/tree/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc).
Its custom license and required acknowledgment are retained: “This product
uses DOS/32 Advanced DOS Extender technology.” Firmware notices are also
retained. This result adds no binary bundle or redistribution clearance.

Each child was bounded to 600 seconds, one logical CPU, 1 GiB RAM and zero
swap; the target also had a 120-million-step bound. The enclosing controller
was limited to 2,500 seconds and the job to 45 minutes. Resource observations,
child status, empty process groups and terminal controller cleanup passed.
The wall times above document completion within those bounds; they are not a
performance or RTx benchmark. Runtime executable/firmware identities were
observed, without complete dependency authenticity.

This adds a finite keyboard-to-protected-code-to-file response to the earlier
[owned LE arithmetic result](I80386-DOS32A-OWNED-LE-RESULTS.md). It does not
qualify strict original 386DX behavior, DPMI, physical timing, mouse/IRQ fidelity,
full OS compatibility or an installed GUI. The successor
[protected file-readback, seek and EOF result](I80386-DOS32A-FILE-READBACK-RESULTS.md)
has now reached its finite boundary: checked reopen, actual protected full/short/
EOF buffers and counts, unchanged guards and a later separate shell return on
both fresh engines. Its report records the remaining consumer dependency and
qualification limits.
