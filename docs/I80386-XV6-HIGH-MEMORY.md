# Stock xv6 224 MiB board profile

Pinned MIT xv6-public revision `eeb7b415dbcb12cc362d0783e41c3d1f44066b17` has `PHYSTOP=0xE000000` (224 MiB). Its `usertests.c` uses `BIG=100*1024*1024` in `sbrktest()`. The earlier 4 MiB and 14 MiB board profiles cannot complete that stock test. This profile makes physical RAM continuous from 1 MiB through `0xDFFFFFF`, with 256 MiB of address backing, while retaining conventional RAM below the BIOS area. The old 4 MiB full-suite attempt was aborted before a guest report; see [the correction](I80386-XV6-USERTESTS-NEXT-MARKER.md#superseded-4-mib-full-suite-probe).

The high-memory profile is available only through the experimental 80386 adapter. Ordinary 8086 and 80286 machines retain their 16 MiB allocation limit and 24-bit address behavior. The 80386 decode keeps the full 32-bit physical address, including page-table walks and A20 gating. Tests cover dword reads and writes above 16 MiB, a page directory, page table and target page all above 16 MiB, the 224 MiB RAM boundary, and the unchanged older-machine limit.

On the existing 15 MiB profile, the reset BIOS alias at `0xFFFF0000` maps to ROM at `0xFF0000`, leaving a 15–16 MiB ROM hole. That hole would corrupt stock xv6's contiguous physical allocator. The 224 MiB profile therefore removes the high ROM region and maps the 64 KiB reset alias to the retained low BIOS ROM at `0xF0000`. Its CMOS advertises 15 MiB below 16 MiB and 208 MiB above 16 MiB; the legacy checksum is recomputed. Other 80386 profiles retain their existing reset alias.

The source and media for the full-suite probe are pinned. The clean stock 224 MiB media build uses the original `PHYSTOP=0xE000000` and the compiler settings recorded by [`scripts/build-xv6-stock-qemu-224m.py`](../scripts/build-xv6-stock-qemu-224m.py). Its SHA-256 values are:

| Item | SHA-256 |
| --- | --- |
| Boot image | `de7f0e4aab39c0fc6d21aa283943e8dfe6420ef0806df87efb21bf336e1a353a` |
| Filesystem image | `0b86e83c68d45d34fd0cecddd627b2d71893ab9df7d77d5372941c701d4eae22` |
| Kernel | `10bf65351fe69951a42673bc314049c15a1432cd5cdab004df5e7268cff8eafb` |

[`scripts/probe-xv6-usertests-224m-full-suite.py`](../scripts/probe-xv6-usertests-224m-full-suite.py) checks those media hashes, pinned Bochs BIOS and VGA ROM hashes, the stock source revision and test order, and a clean board revision. `--preflight` does not start a guest. `--run` boots from the original pinned filesystem image, sends `usertests\r`, and records the source-ordered `createdelete ok\n`, `linkunlink ok\n`, and `concreate ok\n` markers. It stops at the exact `ALL TESTS PASSED\n$ ` serial gate or a predeclared 3,000,000,000-step ceiling. Stderr progress is streamed every 50,000,000 steps. Reaching the ceiling yields a bounded failure receipt, not a suite pass. The full-suite board run has not been started.

For a future run, `XV6_LIVE_SERIAL=1` makes the wrapper write exact COM1 bytes to a new `serial-private.bin` in its private output directory as they arrive. The probe itself accepts `XV6_SERIAL_TEE_PATH=/path/to/new/private/file`. Both options are off by default and refuse to overwrite an existing tee file. The live file is diagnostic evidence; it is not added to the public candidate receipt.

The [manual GitHub Actions workflow](../.github/workflows/x86-xv6-224m-full-suite.yml) runs on Ubuntu 24.04 only when dispatched. It fetches the pinned public MIT xv6 source, builds the stock 224 MiB media, runs the probe's source/media/free-firmware preflight, then gives the 3-billion-step board probe up to 225 minutes inside a 240-minute job. It uploads the raw report, host record, stderr, public candidate receipt, and an inventory of any missing files on success or failure. These artifacts may be visible to people with repository access; no private media or secrets are provided. A workflow artifact is evidence for review, not a published full-suite result. This workflow has not been dispatched.

The [board boot smoke receipt](receipts/2026-09-28-xv6-stock-224m-boot-smoke.json) records a fresh run on those exact stock images and the pinned Bochs BIOS. It reached `init: starting sh` and the `$ ` prompt after 74,948,430 guest steps, under a predeclared 120,000,000-step ceiling. This establishes a stock-media shell boot, not a `usertests` result. Raw serial and the complete report are private at firmware commit `ad83714`.

The independent QEMU 256 MiB oracle uses different SeaBIOS firmware and isolated writable copies of the same pinned stock media. Its [full-suite receipt](receipts/2026-09-28-xv6-stock-qemu-256m-full-suite.json) records the final marker on QEMU; that result does not substitute for a board run. The board must reach the source-ordered markers under its declared budget before any full-suite completion claim.
