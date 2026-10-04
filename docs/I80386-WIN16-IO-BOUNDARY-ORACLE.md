# Protected-16 branch-to-I/O acceptance fixture

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

This is a small architectural acceptance harness for a future
event-aware block engine; it is not a measured speedup or a broader guest media
trace. The QEMU 486 opinion applies to the overlapping protected-16 instructions;
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

The pre-I/O checkpoint still matches, but the post-I/O `AL` assertion fails. This negative control detects a trace that skips, duplicates, or substitutes
the device result when the future engine resumes at the boundary. The harness
does not yet execute any speculative block engine and does not establish
interrupt timing, memory-fault, or VM86 behavior. Those need separate tests.

Run the public oracle on the pinned QEMU/SeaBIOS build:

The script rejects
unexpected QEMU/SeaBIOS and Bochs build hashes and publishes source, image,
emulator and ROM hashes alongside the reference checkpoints in the receipt.
