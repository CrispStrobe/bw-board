# Reproduce the owned code32 REP fault checkpoint

Use a clean checkout of the tested source commit `b950d610a93b7b6fed8d30465d00a5d79e129cda` with Node, GNU binutils and the pinned QEMU build identified in [the result](../../docs/I80386-CODE32-REP-PF-RESULTS.md). From the repository root:

```sh
node --test test/i80386-code32-rep-pf.test.mjs
mkdir -p output
QEMU_BIN=path/to/pinned/qemu-system-i386
node scripts/run-i80386-code32-rep-pf-js.mjs output/js-capture.json.gz
node scripts/run-i80386-code32-rep-pf-qemu.mjs output/qemu-receipt.json "$QEMU_BIN"
```

Use new output files because both runners refuse to replace evidence. The JS capture contains actual CPU, board, effect and selected-page records. The QEMU receipt contains its independent exception record and guest completion marker. Compare the ROM hash in both outputs before comparing behavior. The [source fixture](../../test/fixtures/i80386-free-code32-rep-pf.S) is MIT-licensed and uses no external guest media.
