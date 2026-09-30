# Native CPU3 typed memory and A20 self-parity

**Status (2026-09-30): source-bound native self-parity passed and independently reproduced.** Combined executable/validator/runner/test source is frozen at `753a5e0aa184f2c87b4041068fa8e700cafcf7db`.

A separate owned adapter now decodes low/extended RAM, a source-pinned free BIOS ROM, one synthetic MMIO register, and declared open-bus holes. Physical callbacks apply the effective A20 gate before decode. This also covers raw PDE/PTE accesses and A/D writes, which bypassed the original Bochs memory layer in the previous adapter. Ordinary translated data can arrive already masked; the journal preserves the actual callback input rather than inventing a pre-mask address.

The free BMAP001 guest uses FFFF:0510 for low/high sentinel alias and restoration. It verifies a ROM write is ignored, one fake MMIO write/read has its own counted effects, and an unmapped write/read yields open-bus FF. Its protected-mode probe uses raw CR3=`0x110000` and PTE base `0x111000` while A20 is disabled. The page walker must access low `0x10000`/`0x11000`, update low PDE/PTE A/D bits, and leave distinct high backing values unchanged. Call-site tags in the pinned legacy walker distinguish these transactions from ordinary data accesses. The guest disables paging before reenabling A20 and verifies high backing remains intact.

The effective map domain is `0..0x17ffff`: RAM `0..0x9ffff` and `0x100000..0x17ffff`, MMIO `0xa0000` only, ROM `0xf0000..0xfffff`, and open-bus holes elsewhere within that domain. Addresses outside the domain after gating fail closed. Raw uint32 inputs above backing capacity can validly alias low RAM; the out-of-range probe uses `0x200000`, which remains outside regardless of A20. Unsafe ROM/MMIO/unmapped execute pointers, unsupported physical spans/ports and Bochs memory/device/timer fallbacks abort at named guards. Executable pointers are granted only for stable whole RAM pages. RAM commits retain effective-address write stamps. Ordinary PTE stores do not invent a TLB flush; guest CR3/CR0 changes and actual A20 transitions supply invalidation.

Post-BIOS handoff copies 288 decoded RAM pages (1179648 bytes), packed in physical-page order for its seed hash. The backing capacity is 1572864 bytes; ROM/hole bytes are not part of that copied seed. The ROM provider embeds the exact source-pinned 65536-byte free BIOS rather than treating raw copied memory as ROM authority. The 8042 A20 source is explicitly fixed low for this owned provider; port `0x92` drives the actual Bochs gate. This does not qualify real keyboard-controller arbitration.

| Arm | Resume calls | Attempts | Completed | REP iterations | Partial REP returns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Continuous |12|904|904|1024|0|
| Budget 1 |1927|1927|904|1024|1023|
| Budget 2 |965|1415|904|1024|511|
| Budget 257 |19|908|904|1024|4|

All arms share 1,927 native ticks and 7,259 complete recorded events: 5,279 typed physical access bytes, 1,927 tick records, 20 execute-page callbacks, 14 selected instruction attempts, 14 port callbacks and 5 A20 latch records. Physical callback counts are 32 reads and 1,302 writes. Exact journal equality includes execute callbacks and selected attempts; there is no filtered evidence comparison. Instruction fetch bytes read through executable pointers are not individually journaled. Six C ABI probes and eleven exact SIGABRT guards passed.

The aliased page-walk counters are 4 PDE reads, 1 PTE5 read, 1 PDE A update, and 1 PTE5 A/D update. Low final PDE/PTE values are `0x00111023`/`0x00005063`; high shadows remain `0x00b02002`/`0x00505002`. The successful data store is `0x11223344`, low/high sentinels `0x52`/`0xa7`, and ROM byte `0xea` remains unchanged. There is no fault, IRQ or HLT claim in this fixture.

This gate qualifies one owned static mapping, selected CPU/RAM state and byte-level physical callback effects. It does not qualify full hidden/reset state, real VGA/PIC/DMA/ATA, JavaScript board parity, WASM integration, Windows enhanced mode, or a 10× speed gain. The next concrete slice is host-owned PIT/PIC scheduling and HLT timer wake, with explicit native-step versus board/device clock accounting.

Source and artifact pins:

- Pinned Bochs: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`.
- Free fixture image: `e4b4a6412357dae0167e16024a3d24776c568430d98cbea50e853b1701ab0f9f` (1086 bytes).
- Native binary: `b81da424d3bf51f5eec974574ffc4eb1f44c97c489f4175d98caa66d4421ab78`.
- Config: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Compiled ROM include: `1e1d8f080834396ed15e1344f39ad2a8bde937260d3289eb91a3862c4687acb4`.
- Qualified capture: `7f5edc6639491b49b015784dda968e4786a271f71551e50a24b3350b30f5591a`.
- Compact result: `6908c363995529088c5ca87f0d653d75d5e487c199399b33014eb30507bc7390`.

The [capture](receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json) includes full recorded byte journals, source/map/ROM/media/build identities and retained raw artifact hashes. The [compact result](receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-result.json) states the proved scope. Earlier adapters, prepared trees, fixtures and receipts are unchanged. The initial four-arm capture is preserved as a clearly labeled free mutation input; it is not the final qualification receipt.

Root's independent capture SHA is `a527b95c5694d38ea3fad4aeb7940dcc4903c9713ea02841629b7dbc66fe7401`. Its compact result is byte-identical. Seeds, API probes, all four arm records and guards match exactly; their path-independent semantic SHA is `45030873a81e12c95653c289ea791864234555db2db76810aff545c32ce76424`. Complete capture bytes differ because host configuration hashes include output paths. Root verified all 47 retained artifact hashes, reparsed all four raw arms, and separately audited ordinal continuity, address gating, map effects, source-tagged page walks and complete cross-arm journal equality in Python.

Nine focused tests passed without skips. The locked-dependency broad 386 suite passed 762 tests with zero failures and five optional-data skips. Mutation tests reject fabricated callback origin, borrowed out-of-phase alias reads, lost page-walk gating/provenance, ROM/MMIO class/effect substitutions, wrong ROM byte, lost API/guard/arm/seed evidence, false callback counts in one or all arms, and clock/executable-page drift.

Reproduce from a clean checkout of the frozen combined source, using new prepared and output directories:

```sh
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-memory-map.mjs --check
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-memory-map.mjs --prepare /new/native-memory-map
cd /new/native-memory-map/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /checkout/of/frozen/source
node scripts/run-bochs-cpu3-native-memory-map-compare.mjs --preflight /new/native-memory-map
node scripts/run-bochs-cpu3-native-memory-map-compare.mjs --capture /new/native-memory-map /new/proof-directory
node --test test/i80386-native-memory-map.test.mjs
```

The [next device boundary audit](I80386-NATIVE-DEVICE-NEXT-GATE.md) specifies guest-programmed PIT/PIC timer wake and the successful-step clock convention. The 10× target remains unfinished; instrumentation and transport overhead in these proofs are not production backend performance.
