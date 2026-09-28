# Independent stock xv6 QEMU oracle

[`scripts/probe-xv6-usertests-qemu-oracle.py`](../scripts/probe-xv6-usertests-qemu-oracle.py) prepares an independent serial oracle for the same pinned MIT xv6-public source revision, boot disk and filesystem disk used by the board `usertests` marker probes. QEMU uses its bundled SeaBIOS 256 KiB firmware and standard VGA ROM, each pinned by SHA-256. This is a **different firmware pair** from the board's Bochs BIOS/VGA ROM; the comparison tests stock xv6 behavior under an independent CPU and PC platform, not identical BIOS boot behavior. The script verifies source/media hashes before preparation, records the local QEMU version and binary hash, and copies both disks into a new output directory. The original disk images are never passed to QEMU. The pinned kernel hash is checked as build provenance; QEMU boots the pinned boot disk. `XV6_QEMU_BIOS` and `XV6_QEMU_VGA_ROM` can select other local paths only if their bytes match the declared pins.

The installed QEMU is 8.2.2. The declared guest configuration is `pc-i440fx-8.2`, `qemu32`, single-thread TCG, one CPU, 4 MiB RAM, the pinned SeaBIOS/VGA pair, two IDE disks in master/slave positions, and a Unix socket for COM1. Python creates the socket listener before launching QEMU; QEMU connects as a client. The runner waits for the xv6 shell prompt, sends `usertests\r`, and records raw serial bytes. It stops at `concreate ok\n` or after 900 wall-clock seconds. A 30-second boot guard requires `xv6...`; a 60-second shell guard requires the prompt before injecting the command. The private receipt records ordered positions of `createdelete ok\n`, `linkunlink ok\n` and `concreate ok\n`, plus hashes of the transcript and writable disks. It cannot compare emulator guest-step counts, because QEMU has a different execution model and PC chipset.

For a replay, choose a new unused output directory. From a clean board worktree, the preparation commands are:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-seabios-fresh-run \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --preflight
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-seabios-fresh-run \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --prepare
```

After preparation and when the shared CPU slot is free, run:

```sh
XV6_SOURCE_DIR=/tmp/xv6-public XV6_IMAGE_DIR=/tmp/xv6-stock-4m \
  XV6_ORACLE_OUTPUT_DIR=/tmp/xv6-qemu-oracle-seabios-fresh-run \
  python3 -B scripts/probe-xv6-usertests-qemu-oracle.py --run
```

`manifest-private.json` contains the complete QEMU argument vector and local paths. The runner refuses reused serial/receipt files or disk copies whose hashes changed before the run. Prior pinned-Bochs QEMU attempts produced zero serial bytes. A bounded QMP diagnostic found QEMU marked `running` while the Bochs BIOS CPU halted at `f000:0872` in its timer wait. A three-second diagnostic with the pinned SeaBIOS pair and fresh copies of the same disks reached the xv6 shell.

The [SeaBIOS concreate oracle receipt](receipts/2026-09-28-xv6-stock-qemu-seabios-concreate.json) records a subsequent fresh run that sent `usertests\r` and observed `createdelete ok\n`, `linkunlink ok\n` and `concreate ok\n` in source order. It stopped at the target after 20.734 wall seconds. Its raw serial, manifest, host capture, stderr and full receipt are preserved privately at firmware commit `ae38dca`. The disposable filesystem copy changed, while the boot disk and original pinned media remained unchanged. This independently corroborates stock xv6's bounded serial prefix on QEMU with different firmware and chipset; it does not establish complete `usertests` or compare QEMU wall time to board guest steps.

For a later full-suite oracle, start again from fresh copies of the pinned disks and allow the program to continue past `concreate()`. The pinned `usertests.c` ends with `exectest()`, which executes `echo` with the arguments `ALL TESTS PASSED`. A stronger completion gate is the exact serial text `ALL TESTS PASSED\n` followed by a return to the shell prompt (`$ `). The present runner stops at `concreate ok\n`; it does not make that full-suite claim.
