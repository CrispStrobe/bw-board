# Owned Bochs CPU3 checkpoint and hook record

**Scope:** one freely owned VM86 task-switch fixture, without licensed guest
media, on the pinned Bochs 2.7
CPU-level-3 source. The [native receipt](receipts/2026-09-30-i80386-bochs-cpu3-owned-native-checkpoint.json)
captures Bochs integer/system CPU state and a bounded ordered instrumentation
hook stream. It is a native capture, with `comparison: "not-run"`; it is not a
full physical-byte bus oracle or a WASM-backend qualification.

The [probe](../scripts/bochs-cpu3-owned-oracle/instrument.cc) replaces only the
pinned source's `instrument/stubs/instrument.cc` in a **separate** source tree.
The [preparer](../scripts/prepare-bochs-cpu3-owned-oracle.mjs) requires Bochs
revision `0e45b736ef9792eb9b752b0a35db49eaf2faea47`, a clean tracked
source and the expected upstream hook declarations before cloning locally.
The [runner](../scripts/run-bochs-cpu3-owned-oracle.mjs) requires the owned
fixture, probe, parser and runner to match committed board `HEAD` bytes. It
hashes the Bochs binary/configuration, probe/header, free BIOS/VGA ROM and
assembled floppy and stops at the complete native record. No legacy guest
media or CPU runtime source is involved.

To reproduce from a clean board checkout with the pinned Bochs source already
available locally:

```sh
BOCHS_386_ROOT=/path/to/pinned/Bochs node scripts/prepare-bochs-cpu3-owned-oracle.mjs --prepare /tmp/bw-bochs-cpu3-owned
cd /tmp/bw-bochs-cpu3-owned/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
make -j1
cd /path/to/clean/board
BOCHS_386_INSTRUMENTED_ROOT=/tmp/bw-bochs-cpu3-owned node scripts/run-bochs-cpu3-owned-oracle.mjs > native-checkpoint.json
```

This run built with `-j1`; the owned probe compiled without a warning. The
receipt freezes board source `2342e52fcbc5ab65640b8b0f27df60366b20d2e9`,
Bochs configuration SHA-256
`d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`,
and Bochs executable SHA-256
`209ec4ef28fa0f0e1f458d0515aeb916bc87ffbdae8d50b4cf4be8d60f43be19`.
The existing noninstrumented Bochs binary has debugger and instrumentation
disabled; this is a different, separately pinned build.

The probe arms at the fixture's first `B` output to port `0xE9` in real mode
at `CS=0` in the owned setup address range. It captures callback events through
the final `3` output of `BHVK003`, then reads Bochs CPU fields in the next
`before_execution` callback. That is **after the final E9 OUT and before the
following F4 OUT** at `CS:IP = 0000:7E62`. The first `B` port callback is
recorded, but the instruction and accesses before it are outside the stream.
The fixture emitted the expected marker; the record has 35 instruction hooks,
146 linear-access hooks, seven port writes, one interrupt hook and zero
physical-access hooks. The configured CPU has one core, and the record is
bounded to 100,000 events.

State fields come directly from Bochs: eight 32-bit GPRs, EIP, materialized
EFLAGS, CR0/CR2/CR3, DR0–DR3/DR6/DR7, GDTR/IDTR, visible selectors and
cached base/limit/presence/privilege/type/size for ES/CS/SS/DS/FS/GS/LDTR/TR,
plus instruction and interrupt-inhibit counters. An invalid segment cache has
no architectural hidden fields; the parser reports those as `null`. The TR
checkpoint is selector `0x20`, base `0x7f18`, limit `0x67`, busy type `0xb`.
The probe does not dump TSS RAM, selected RAM page hashes, FPU state or device
state. Those remain separate requirements for a complete-machine oracle.

The stream reports **callback order and addresses**, not physical-byte bus
cycles. Bochs's `BX_INSTR_LIN_ACCESS` reports linear/translated physical
address, length, memory type and read/write code without data bytes; the
separate `BX_INSTR_PHY_ACCESS` reports direct physical accesses such as page
walks. The latter did not fire in this paging-disabled fixture. CPU memory
callbacks can also cover internal task-switch accesses, while fetch/fast
paths and hook placement need their own coverage audit before equating these
records with every board bus transaction. Port writes are observed before the
device handler and reads after it. The stream intentionally never reads guest
memory again to manufacture missing values or ordering.

An independent JavaScript run of this owned fixture at the same final E9
boundary agreed on all eight GPRs, EIP `0x7e62`, EFLAGS `0x23206`, CR2/CR3,
GDTR/IDTR and TR selector/base/limit/busy type. **Raw full-state equivalence
has not passed:** native CR0 was `0x7ffffff9` versus JavaScript `0x00000009`;
native DR6/DR7 were `0xffff1ff0`/`0x00000400` versus zero. Native Bochs boots
through BIOS from reset, while the JavaScript fixture starts directly at the
loaded setup entry; these runs do not establish a matching initial-state
contract. In addition, pinned Bochs [`init.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/init.cc)
and [`crregs.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/crregs.cc)
explicitly force CPU3 CR0 bits `0x7ffffff0`, and reset DR6/DR7 to the values
above. The raw gap therefore includes strict-model register behavior, not
only BIOS versus direct entry. The earlier direct-entry JavaScript fixture
used a none-NPX reset with ET=0, while this Bochs CPU3 reference fixes ET=1.
The [Intel manual's reset and coprocessor sections](https://www.read.seas.harvard.edu/~kohler/class/aosref/i386.pdf)
allow ET=0 without an 80387 and permit software to write ET, so the observed
ET gap is not by itself an Intel-386 defect. ET is a defined bit and must
not be masked away as reserved. The new [scoped comparator](I80386-STRICT-PROFILE.md)
chooses an explicit 80387 setup to align ET and reports the remaining raw
Bochs-specific CR0/debug differences. Bochs represents VM86 CS
with cache type `3`, while the JavaScript cache has `code: true`; compare the
VM86 architectural selector, base, limit, presence and address size rather
than treating these internal type encodings as equal. A future fixture must
align initial CPU state explicitly and add TSS/RAM and memory-value capture
before using this stream as a full differential acceptance gate.

The parser's focused tests reject missing state, altered marker, bad event
order/count/kind, over-width CPU3 values and probe errors. The actual native
record was reproduced independently with the same source, binary and config
hashes and the same parsed 189-event checkpoint. This validation is limited
to the owned fixture and the stated hooks.
