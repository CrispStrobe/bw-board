# Pinned QEMU stock xv6 full-suite oracle

The [bounded SeaBIOS oracle](receipts/2026-09-28-xv6-stock-qemu-seabios-concreate.json) reached `concreate ok\n` on the same pinned stock xv6 boot and filesystem images as the board probe. [`scripts/probe-xv6-usertests-qemu-full-suite.py`](../scripts/probe-xv6-usertests-qemu-full-suite.py) uses a **fresh pair of writable copies** and lets `usertests` continue toward its final marker. It pins the xv6 source revision, `usertests.c`, `echo.c`, `sh.c`, the exact original disk hashes, SeaBIOS and VGA ROM hashes, QEMU 8.2 machine configuration and the local QEMU binary hash in its private manifest. SeaBIOS is different from the board's Bochs BIOS, as described in the [oracle comparison](I80386-XV6-QEMU-ORACLE-PLAN.md).

The success gate is the exact serial sequence `ALL TESTS PASSED\n$ `, following source-ordered `createdelete ok\n`, `linkunlink ok\n` and `concreate ok\n`. The pinned `usertests.c` ends by executing `echo` with `ALL TESTS PASSED`, `echo.c` formats the line, and `sh.c` prints the returning `$ ` prompt. The runner waits up to **300 wall-clock seconds** overall, requires `xv6...` within 30 seconds and the first shell prompt within 60 seconds, then injects `usertests\r`. It streams serial bytes to a private file and writes a private receipt with its SHA-256, marker positions, stop reason, elapsed time and post-run writable disk hashes. A timeout or early QEMU exit records failure evidence and does not claim a suite pass.

From this clean board worktree, prepare without starting the guest:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-full-suite.py --preflight
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-full-suite.py --prepare
```

When the guest CPU slot is available, run the prepared oracle:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-full-suite-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-full-suite.py --run
```

`--run` has not started during preparation. QEMU wall time and board guest-step counts use different clocks; they should not be compared as emulator performance measurements.
