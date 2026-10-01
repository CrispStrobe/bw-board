# Actual JavaScript AT board: executable RAM, SMC and A20

**Qualified JavaScript baseline, 2026-10-01. Native cache coherence remains WIP.** A freely authored MIT 64 KiB ROM starts at physical `FFFFFFF0`, creates executable RAM through guest writes, changes instruction operands, and switches the actual 8042 A20 gate. It reaches CLI/HLT after 75 successful instructions and 454 functional board clocks (four reset clocks plus 75 × six). These clock counts are not physical 386 timing or an RTx measurement.

The [actual capture](receipts/2026-10-01-i80386-js-ram-coherence-oracle-capture.json.gz), [result](receipts/2026-10-01-i80386-js-ram-coherence-oracle-result.json) and [independent audit](receipts/2026-10-01-i80386-js-ram-coherence-oracle-audit.json) are public. Root independently reassembled the ROM and replayed every byte against physical backing and A20 mapping with Python. A separate actual-board capture was byte-identical. All 34 focused tests pass without skips.

## Guest and evidence

The ROM writes `MOV BX,imm16; RETF` to low RAM `7000` and high RAM `107000`, starting from zero RAM. It uses `ES=FFFF` with offsets `7010`/`7011` for high-memory writes; a 32-bit offset above the real-mode segment limit is invalid. Far calls and returns serialize each entry. There is no preseeded RAM code, BIOS execution, disk, licensed media, REP, paging, MMIO or interrupt delivery.

Eight actual RAM entries produce witness words at `0520..052F`:

| Entry | A20 | Raw address | Decoded backing | Result |
| --- | --- | --- | --- | --- |
| 1 | On | `7000` | `7000` | `1111` |
| 2, after low operand patch | On | `7000` | `7000` | `2222` |
| 3 | Off | `107000` | `7000` | `2222` |
| 4, admit the second alias in this epoch | Off | `7000` | `7000` | `2222` |
| 5, after raw `107001` alias patch | Off | `7000` | `7000` | `5555` |
| 6 | Off | `107000` | `7000` | `5555` |
| 7 | On | `107000` | `107000` | `3333` |
| 8, after high operand patch | On | `107000` | `107000` | `4444` |

The fourth entry matters: a native mapping change invalidates old admissions, so both raw aliases must be admitted in the same A20 epoch before the alias write. The first seven-entry draft did not prove this coverage and remains an unpublished historical capture. The final sequence retains independent high backing through the OFF alias write.

The actual board handles `64:D1, 60:01` and `64:D1, 60:03`, with the fast A20 source initially zero and reset bit preserved. It emits `RAMA001` through port E9. The capture includes all 348 ordered events (235 consumed instruction bytes, 32 read bytes, 70 write bytes, 11 byte PIO events), raw/decoded addresses, effects, mapping epochs, every CPU checkpoint, every configured chip state, debt and interrupt/reset signals. Terminal settlement clears remaining chip debt without executing an idle CPU instruction.

Instrumentation preserves the existing fetch/read providers. This guest makes four `fetchRam32` attempts, none eligible for a returned fast word, and no `read32` calls; it does not qualify the fast-word provider. The validator independently replays backing bytes and fixed witnesses. Full CPU/device checkpoint validation also uses a fresh execution of the same committed JavaScript engine, explicitly labeled as such. That replay is not an independent architectural CPU oracle.

## Source and replay

Measured source revision: `a36c3687ebba1bfe541e7d33dfa63fbba399c5b2`, with all 41 inputs authenticated against historical committed blobs and checked before/after execution. The uncompressed capture SHA-256 is `aa48612c132bcdfea4ca031644100f45afed29b769b72eed706b03e706783c91`. The ROM SHA-256 is `c65ff0ecd3cb13c3f306f402973ea44e341b93c604a8a844f2654705c0c903cc`; fixture and gzip hashes are in the audit receipt.

From a clean checkout, with GNU binutils available:

```sh
node scripts/run-i80386-ram-coherence-oracle.mjs /new/capture.json
node --test --test-concurrency=1 test/i80386-ram-coherence-oracle.test.mjs
```

The CLI writes actual bounded measurement before semantic validation, so failures retain diagnostics. Unit tests permit unrelated CI setup files while enforcing committed measured inputs. Changes to measured code or the guest require a new committed capture and audit; documentation-only descendants can validate the existing receipt while those 41 blobs stay unchanged.

## Next gate

The separate native adapter must prove persistent executable RAM pages, updates to every live decoded alias, write generations, and instruction-cache/TLB/prefetch invalidation at committed boundaries. Its internal A20 mask must preserve raw addresses while the actual board owns effective A20 mapping. Require continuous and 1/2/257 budgets, complete board parity, native guards and transport rejection captures before qualification. The [native integration roadmap](I80386-NATIVE-COLD-RESET-NEXT-GATE.md) then calls for actual-board REP/page-fault/PIT integration and a production backend.

This remains the JavaScript compatibility profile. Raw reset differences from Bochs CPU3 are preserved, and strict 386 architectural reset parity, Windows enhanced mode, Doom, a shipped native/WASM backend and the 10× speed target remain unfinished.
