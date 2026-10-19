# Protected-16 branch-to-I/O acceptance fixture

The owned [512-byte boot fixture](../test/fixtures/i80386-win16-io-boundary.S)
enters a 16-bit protected code segment, writes `A5` to the PIC1 interrupt
mask register at port `21`, then begins a three-instruction trace at
`CS:EIP=0008:7C2E`. `MOV BX,1; CMP BX,1; JZ` takes the branch to a single
`IN AL,DX`. This is a small architectural acceptance harness for a future
event-aware block engine; it is not a measured speedup or an external guest media
trace. The [source-bound receipt](receipts/2026-09-28-i80386-win16-io-boundary-oracle.json)
uses QEMU TCG 8.2.2 with a 486 software CPU as an independent reference,
and steps the same bytes through `ExperimentalI80386` at the trace entry.
The QEMU 486 opinion applies to the overlapping protected-16 instructions;
it is not a 386 model. A second run boots the exact same sector on a pinned
Bochs CPU-level-3 build. Bochs supplies an output/event witness, not the
per-instruction CPU-state checkpoints below.

| Checkpoint | CS | DS/SS | ES/FS/GS | EIP | EFLAGS | BX | DX | AL | Local reads |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| Before device read | `0008` | `0010` | `0000` | `7C3C` | `0046` | `0001` | `0021` | `A5` | 0 |
| After one `IN` | `0008` | `0010` | `0000` | `7C3D` | `0046` | `0001` | `0021` | `A5` | 1 |

The stop event is **I/O read required** at `0008:7C3C`, *before* `IN DX`
causes a device callback. The ordinary executor then performs exactly one
8-bit read of port `0021` and reaches `0008:7C3D`. The taken-branch trail
is `7C2E → 7C31 → 7C34 → 7C3C`; the failure fallthrough would emit `F`.
QEMU's CPU log independently exposes both EIP/segment/flag checkpoints,
and its debug port emits bytes `A5 4B` (`A5`, `K`) before the owned F4 exit.
QEMU does not instrument the device callback count: the one-read statement
is directly observed in the local hook and bounded in QEMU by the single
`IN` between the logged checkpoints and its returned `A5` byte.
Bochs also boots the image without a panic and emits `A5 4B`; the harness
stops Bochs at that marker, so later guest behavior is outside its claim.

`I386_WIN16_IO_MUTATION=io-value` changes only the local read value to `A4`.
The pre-I/O checkpoint still matches, but the post-I/O `AL` assertion fails.
The [negative-control receipt](receipts/2026-09-28-i80386-win16-io-boundary-mutation.json)
records that exact `local.after` difference against unchanged QEMU and Bochs
references.
This negative control detects a trace that skips, duplicates, or substitutes
the device result when the future engine resumes at the boundary. The harness
does not yet execute any speculative block engine and does not establish
interrupt timing, memory-fault, or VM86 behavior. Those need separate tests.

Run the public oracle on the pinned QEMU/SeaBIOS build:

```sh
BOCHS_386_ROOT=/path/to/pinned/bochs node scripts/compare-qemu-i80386-win16-io-boundary.mjs
BOCHS_386_ROOT=/path/to/pinned/bochs I386_WIN16_IO_MUTATION=io-value node scripts/compare-qemu-i80386-win16-io-boundary.mjs
```

The first exits successfully; the second exits with failure and a
`local.after` difference. `node --test test/i80386-win16-io-boundary-oracle.test.mjs`
checks both paths (and Bochs when `BOCHS_386_ROOT` is set). The script rejects
unexpected QEMU/SeaBIOS and Bochs build hashes and publishes source, image,
emulator and ROM hashes alongside the reference checkpoints in the receipt.
