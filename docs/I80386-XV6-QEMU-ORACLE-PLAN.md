# Independent stock xv6 QEMU oracle

[`scripts/probe-xv6-usertests-qemu-oracle.py`](../scripts/probe-xv6-usertests-qemu-oracle.py) prepares an independent serial oracle for the same pinned MIT xv6-public source revision, Bochs BIOS, VGA ROM, boot disk and filesystem disk used by the board `usertests` marker probes. It verifies each source/media SHA-256 before preparation, records the local QEMU version and binary hash, and copies both disks into a new output directory. The original disk images are never passed to QEMU. The pinned kernel hash is checked as build provenance; QEMU boots the pinned boot disk.

The installed QEMU is 8.2.2. The declared guest configuration is `pc-i440fx-8.2`, `qemu32`, single-thread TCG, one CPU, 4 MiB RAM, the pinned Bochs BIOS and VGA ROM, two IDE disks in master/slave positions, and a Unix socket for COM1. Python creates the socket listener before launching QEMU; QEMU connects as a client, so guest startup does not depend on its serial backend's server wait state. The runner waits for the xv6 shell prompt, sends `usertests\r`, and records raw serial bytes. It stops at `concreate ok\n` or after 900 wall-clock seconds; a separate 30-second boot guard stops a run that has not printed `xv6...`. The private receipt records ordered positions of `createdelete ok\n`, `linkunlink ok\n` and `concreate ok\n`, plus hashes of the transcript and writable disks. It cannot compare emulator guest-step counts, because QEMU has a different execution model and PC chipset.

From the board worktree, the preparation commands are:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-client-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --preflight
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-client-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --prepare
```

When the shared CPU slot is free, run this exact command in the prepared, clean worktree:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-client-20260928 \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --run
```

`manifest-private.json` contains the complete QEMU argument vector and local paths. The runner refuses reused serial/receipt files or disk copies whose hashes changed before the run. A reached marker would independently corroborate the stock guest's serial behavior under QEMU; it would not establish that the board completed the whole suite. A prior server-mode attempt remained at zero guest CPU and zero serial bytes; the client-mode retry has not started.

For a later full-suite oracle, start again from fresh copies of the pinned disks and allow the program to continue past `concreate()`. The pinned `usertests.c` ends with `exectest()`, which executes `echo` with the arguments `ALL TESTS PASSED`. A stronger completion gate is the exact serial text `ALL TESTS PASSED\n` followed by a return to the shell prompt (`$ `). The present runner stops at `concreate ok\n`; it does not make that full-suite claim.
