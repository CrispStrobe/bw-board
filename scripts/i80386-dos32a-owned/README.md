# Owned LE32 DOS client

The [first actual FreeDOS and QEMU result](../../docs/I80386-DOS32A-OWNED-LE-RESULTS.md)
passes this finite client's protected-mode arithmetic, print, zero exit and
shell-return gate at tested source `f8748bcf8dc5c20b37fe62340b7ea42a048cb144`.
The host structural control below remains a separate source-only check.

`build.py` emits an 8,192-byte standalone Linear Executable (`LE`) file. Its
first 4 KiB 32-bit RX object holds owned x86 instructions and two
`$`-terminated messages. A separate zero-filled 32-bit RW object supplies the
stack, so SS can use a writable data selector. The code obtains its runtime address with
`call`/`pop`; it has no absolute address, import, fixup, MZ stub, or extender
bytes. It checks `0x12345678 + 0x11111111 == 0x23456789`, writes either an
`OK` or `FAIL` marker through DOS `INT 21h` function `09h`, then exits through
function `4Ch` with status `0` or `1`.

The format choices were checked against the pinned [DOS/32A loader source](https://github.com/amindlost/dos32a/blob/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/src/dos32a/loader.asm), its [external-application dispatch](https://github.com/amindlost/dos32a/blob/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/src/dos32a/dos32a.asm), and its [raw external-file search](https://github.com/amindlost/dos32a/blob/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/src/dos32a/text/client/misc.asm): an `LE` signature, 0xA8-byte header, two objects, one page, 32-bit object flags, entry/stack objects, last-page byte count, and empty fixup-page offsets. This source does not reuse the DOS/32A example's code or any third-party LE generator.

From the repository root, the bounded host control is:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/i80386-dos32a-owned/control.py
```

To write the deterministic client into an owned output directory:

```sh
python3 scripts/i80386-dos32a-owned/build.py output/owned-le-client.le
```

The output is generated and is not checked into this repository. Its current
SHA-256 is `7b8e9545b05d6697e934cffc69bfdf4ec0442147382948db9535a262d2a2a23a`.
The control independently checks the exact header/object/page/fixup structure,
entry/stack, arithmetic/branch, both DOS call paths, address derivation, and
negative mutations. These host checks alone do not establish loader or guest
behavior. The separate actual gate observed this client's 32-bit protected
entry, DOS print and zero-exit calls, matching output and returned shell.
It does not qualify above-1-MiB allocation, DPMI, IRQ, broad applications,
mouse support or performance.

The external DOS/32A binary is **not** bundled by this fixture. The actual
gate acquired its pinned public source commit and binary hash and retained its
[specific license and required attribution](https://github.com/amindlost/dos32a/blob/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/license).
The generated client and this generator are covered by this repository's MIT
license. No DOS/32A binary redistribution or broad legal-clearance claim is
made here.
