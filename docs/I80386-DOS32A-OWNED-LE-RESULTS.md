# Owned DOS/32A LE client: first actual application result

The [hosted FreeDOS and QEMU gate](https://github.com/CrispStrobe/bw-board/actions/runs/37648932918)
passed at tested source `f8748bcf8dc5c20b37fe62340b7ea42a048cb144`.
The [original artifact](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11495396917)
is 68,182 bytes as a ZIP, SHA-256
`c04b99d1faaf4cb2f710fb86e5297b0a71927bebef1768009bf0ea685d5b06b8`.
Two independent standard-library audits of that unchanged ZIP agree: all 60
members are unique, its 59 inventory entries match exact bytes, and its 344
declared source roles match Git at the tested head. The public
[compact receipt](receipts/2026-10-07-i80386-dos32a-owned-le.json) records the
observable checks and limits; the original raw reports and three VGA text
snapshots remain in the official artifact.

The opt-in [owned LE generator](../scripts/i80386-dos32a-owned/README.md)
produces an 8,192-byte client, SHA-256
`7b8e9545b05d6697e934cffc69bfdf4ec0442147382948db9535a262d2a2a23a`.
The gate acquired the exact external DOS/32A 9.1.2 binary and its custom
license from [pinned public source](https://github.com/amindlost/dos32a/tree/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc);
the required acknowledgment and full license are in the artifact. Neither
the extender nor the disk images are bundled in this repository or uploaded
as test evidence. Both guests used the same authenticated FreeDOS 1.4
`120m/x86BOOT.img` floppy and initial owned FAT16 disk, SHA-256
`2e0d20b55e2fde2b26cd841c4c01812dea88af80a76a83bd4bc684f522bc9164`.

On the JavaScript AT, FreeDOS booted and accepted `C:\RUNLE.BAT`. At step
41,313,352 the CPU entered the client's exact code prefix at linear
`0x100010` with CR0.PE set, a 32-bit code segment and a writable 32-bit
stack segment. Its observed arithmetic result was `0x23456789`; the
success branch, DOS function `09h` print call and `4C00h` exit call followed
in order. The batch checked zero error level, wrote `LEOK.TXT`, returned to
the `A:\>` shell, then accepted a second command, `C:\VERIFY.BAT`, which
wrote `RETURN.TXT` and returned to the prompt. All 64 offered Set-1 scan
codes were accepted, including releases, with at least 5,000 guest steps
between offers. The target completed within 43,500,000 bounded steps without
CPU shutdown. Its selected reset/final CPU and device records, 16 MiB
backing-memory SHA-256 and final disk SHA-256 are retained in the raw report.

The independent QEMU TCG `pc`/486 oracle used a separate SeaBIOS/VGA device
profile and `-m 4`. Its QMP physical VGA-text snapshots independently show
the current `A:\>` prompt before the client, after the client and after the
second command. QEMU exited zero with an empty owned process group. Both
guests produced the same exact 75-byte redirected application output,
including DOS/32A's `mouse initialization failed` warning and
`BW-DOS32-LE-ARITH-OK`, plus identical `BW-LE-EXIT-0` and
`BW-LE-SHELL-RETURN` files. The warning is evidence that this run does
**not** qualify mouse initialization. The guests' final whole-disk hashes
differ; this gate compares the observed result files and return, not complete
disk-state parity.

The AT configuration declares **4 MiB of installed guest RAM** (640 KiB
conventional plus 3,456 KiB extended) within a **16 MiB backing/address
span** retained for high ROM aliases. The target report's
`configuredBytes`/`backingBytes` both equal 16,777,216 and hash that whole
backing, including holes and aliases. QEMU's separate `-m 4` configuration
does not make the two CPU, BIOS, device or backing-memory layouts identical.
This is one finite flat protected-mode LE application, using the existing AT
**compatibility** CPU profile. It is not strict original 386DX hardware,
DPMI, IRQ, above-1-MiB allocation, broad DOS-extender or game compatibility,
full architectural-state parity, physical mouse support, or a performance
result. Next acceptance should add an owned DPMI client and an application
with explicit input/device responses, each with its own affected guest gate.
