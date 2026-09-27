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
This is an earlier diagnostic guest variant. The stock SMP-capable kernel now
boots to an interactive shell on the 4 MiB profile without the UP patch; see
[the stock xv6 acceptance and reproduction notes](XV6-STOCK.md). Keep this
builder only for comparing the legacy PIC path with the APIC path.
