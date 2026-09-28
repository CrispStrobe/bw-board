# Pinned 256 MiB stock xv6 QEMU full-suite oracle

The earlier 4 MiB SeaBIOS QEMU full-suite attempt reached `sbrktest`, printed
`sbrk test failed to grow big address space; enough phys mem?`, and timed out
after 300.641 seconds without the final marker. That was a negative result for
the **4 MiB kernel and RAM configuration**, not a full-suite verdict. The raw
serial, manifest, receipt, and stderr are retained in the private evidence
branch `evidence/xv6-qemu-4m-negative-20260928` at `cc3ae89`; the serial hash
is `9fb92894cd5a3be43e69bacbe8ce7db3c5ac3f5a9124cf6325cf7a4a815b2b67`.

This follow-up uses QEMU with **256 MiB** RAM and a freshly built, unmodified
stock xv6 kernel with `PHYSTOP=0xE000000` (224 MiB). Merely changing QEMU's
`-m` while reusing the 4 MiB kernel would leave the sbrk limit in place.
[`build-xv6-stock-qemu-224m.py`](../scripts/build-xv6-stock-qemu-224m.py)
archives pinned xv6 revision `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`,
builds with the recorded compiler flags, and writes a private media manifest.
The runner requires the manifest and these exact new output hashes:

| Artifact | SHA-256 |
| --- | --- |
| `xv6.img` | `de7f0e4aab39c0fc6d21aa283943e8dfe6420ef0806df87efb21bf336e1a353a` |
| `fs.img` | `0b86e83c68d45d34fd0cecddd627b2d71893ab9df7d77d5372941c701d4eae22` |
| `kernel` | `10bf65351fe69951a42673bc314049c15a1432cd5cdab004df5e7268cff8eafb` |

[`probe-xv6-usertests-qemu-256m-full-suite.py`](../scripts/probe-xv6-usertests-qemu-256m-full-suite.py)
also enforces the stock `usertests.c`, `echo.c`, and `sh.c` contents, SeaBIOS
and VGA ROM hashes, and the exact QEMU 8.2.2 binary SHA-256
`28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5`.
It copies both disks to a new output directory before the run. The machine is
`pc-i440fx-8.2`, `qemu32`, single-thread TCG, one CPU, SeaBIOS, with a serial
UNIX socket. These QEMU firmware conditions differ from the board's Bochs
firmware, so any QEMU pass is an independent stock xv6 oracle, not board parity.

The sole success condition is the exact serial sequence
`ALL TESTS PASSED\n$ ` after source-ordered `createdelete ok\n`,
`linkunlink ok\n`, and `concreate ok\n`. The bounded runner waits at most
300 wall-clock seconds, with 30-second boot and 60-second shell limits. A
stock sbrk failure, panic, timeout, missing or reordered marker, or early exit
is recorded as a failure. Private output includes raw serial, QEMU stderr,
post-run writable-disk hashes, and a receipt.

The pinned 256 MiB run **passed the stock full suite**. The
[media-neutral public result](receipts/2026-09-28-xv6-stock-qemu-256m-full-suite.json)
records ordered prefix marker offsets 192, 224, and 253, then the exact final
`ALL TESTS PASSED\n$ ` marker at serial byte 4639. The raw serial has SHA-256
`a60b4272f7e6ec98bf10fb598c1976021354bb9af3fce19f792602175928efc8`
and length 4658 bytes; it contains no failure marker. The runner stopped on
the target after 140.439 wall-clock seconds. The original boot image hash was
unchanged; the writable filesystem image changed as expected during testing.
The private manifest, receipt, serial, and stderr are preserved on branch
`evidence/xv6-qemu-4m-negative-20260928` at `88f2424`. This result establishes
an independent stock xv6 QEMU oracle pass. It does not establish board xv6
execution or performance parity.

With the pinned source checkout and matching media already present, preflight
and prepare from a clean board worktree:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-224m-qemu \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-256m-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-256m-full-suite.py --preflight
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-224m-qemu \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-256m-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-256m-full-suite.py --prepare
```

To reproduce the oracle when a guest CPU slot is available, execute the
prepared run once in a new output directory:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-224m-qemu \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-256m-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-256m-full-suite.py --run
```

To reproduce the media, set `XV6_224M_IMAGE_DIR` to a **new**, absent output
directory and run `python3 -B scripts/build-xv6-stock-qemu-224m.py`. The oracle
accepts the reproduction only when its output hashes match all pins above.
Source, image, output, QEMU binary, BIOS, and VGA ROM paths are configurable
through the corresponding `XV6_*` environment variables in the scripts.
