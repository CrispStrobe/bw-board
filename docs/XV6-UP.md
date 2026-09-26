# xv6 one-CPU diagnostic build

The stock MIT xv6 x86 image expects an Intel MP table, LAPIC, and IOAPIC. The
experimental AT profile currently provides the 8259/PIT path instead. The
labelled UP builder therefore applies a small source patch that skips SMP
discovery and APIC setup, leaves IDE interrupt routing to the existing profile,
and builds the image with `BW_XV6_UP`.

```sh
XV6_SRC=/tmp/xv6-public XV6_UP_OUT=/tmp/xv6-up \
  node scripts/build-xv6-up.mjs
```

The builder copies the MIT tree, checks its patch anchors, builds `xv6.img`,
and writes `bw-xv6-up-receipt.json` with the source revision and image hash.
This is a diagnostic guest variant; it does not change or weaken the stock
xv6 acceptance claim. The current run reaches the xv6 console banner through
the experimental 386 protected-mode, PSE-paged, 32-bit-ATA path. The next
stock-image milestone is complete interrupt delivery through the WIP MP/LAPIC/IOAPIC
profile; that profile currently proves metadata and register initialization only.
