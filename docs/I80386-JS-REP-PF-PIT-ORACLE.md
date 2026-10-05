# Actual JavaScript AT board: protected-mode REP, faults and PIT

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

**Qualified free baseline, 2026-10-01. Native integration remains WIP.** A new MIT 64 KiB ROM starts at physical `FFFFFFF0`, enters protected mode and 4 KiB paging, recovers from two page faults, and services an actual PIT/PIC interrupt after an STI successor. It finishes with 135 successful work quanta, two failed attempts, and 814 functional board clocks. These are the existing six-clock functional convention plus one four-clock reset, not physical 386DX timing or RTx.

The [actual capture](receipts/2026-10-01-i80386-js-rep-pf-pit-oracle-capture.json.gz), [result](receipts/2026-10-01-i80386-js-rep-pf-pit-oracle-result.json), and [audit](receipts/2026-10-01-i80386-js-rep-pf-pit-oracle-audit.json) are public. A separate fresh capture is byte-identical. All 48 focused tests pass without skips. This qualifies the actual JavaScript compatibility profile, not a native execution path, strict-386 profile, full AT boot, broader guest enhanced mode or broader game.

## Cold guest and protected memory

The [guest source](../test/fixtures/i80386-free-rep-pf-pit.S) needs GNU binutils but no disk, BIOS service, licensed media, preseeded RAM, or injected interrupt. Assembly is linked at ROM-relative offset zero before binary extraction; unlinked relocations are not accepted. The reset vector far-jumps to `F000:0100`. Protected 16-bit code and handlers remain in ROM with CS base `F0000`; data and stack have base zero. Interrupt gates use 32-bit frames and ROM-relative EIP offsets.

The fresh board's zero RAM permits sparse guest construction. The guest writes GDT descriptors at `0608..0617`, IDT gates in page zero, directory `9000`, table `A000`, and only the needed PTEs. Stack top `9000` uses mapped page eight. Pages five and six start nonpresent. Descriptor accessed writes commit to RAM, yielding `9B`/`93`; page-table accessed/dirty writes are captured through the actual raw physical-write provider as well as ordinary writes.

A data32/address16 REP STOSL begins at `4FF8`, count four. Two elements complete in page four; the first `5000` element faults without changing count/index or committing destination bytes. The handler maps page five, reloads CR3, and IRETD retries the remaining two elements. Zero-count REP at still-unmapped `6000` earns one successful quantum without touching its target. A separate ordinary `6000` store then faults, is repaired and retried; a one-element REP writes `6004` and charges once.

Both page faults save `[error=2, ROM-relative EIP, CS=8, EFLAGS=10046]` in a 16-byte frame at `8FF0`. The two failed attempts add no functional clocks. Final PTEs are `5063` and `6063`; the four REP words contain `11223344`, followed by `55667788` and `99AABBCC` on page six.

## Actual timer and interrupt boundaries

Guest PIO initializes the configured master/slave cascade (`20`/`28` vector bases), masks the slave and permits only master IR0. PIT channel zero uses mode zero and reload six. The board retains its actual device-debt scheduling; the oracle does not advance a standalone PIT after every instruction or manufacture an IRQ edge.

The rising PIT edge occurs at Q72, board clock 436, with CX=3 and DI=`4FFC`: exactly one REP element has committed, and the second has not fetched yet. The actual chip advance settles 30 owed clocks at that boundary. The PIC remains pending while CLI holds through both faults, at Q73 and Q90. STI and its successor's `0530=1` store complete before the actual master acknowledge at Q108, returning vector `20`.

The IRQ frame at `8FF4` is `[after_shadow EIP=0x255, CS=8, EFLAGS=0x246]`. Delivery changes no successful-work or board clocks. The same board step then executes the first handler instruction, so the capture records delivery separately from step completion. Guest EOI passes through port `20`; the terminal marker `RPPT001` consists of actual E9 writes. Final CLI/HLT is followed only by device-debt settlement, not an idle CPU instruction.

Every configured chip, interrupt/reset signal, debt/deadline, PIT counter and separately carried fraction is retained. The capture has 520 fetch bytes, 337 read bytes, 234 write bytes, 21 byte PIO events, one PIT output callback and one PIC acknowledge. Provider instrumentation preserves existing fast callbacks and captures page-walk side effects. Successful REP elements, ordinary instructions, zero-count REP, fault delivery and IRQ delivery remain separate concepts.

## Source, checks and limits

Measured source is `7891a5c1f9ca242a86a6fcd39a61b5bc29e8d247`; all 41 inputs are authenticated against committed historical blobs and checked before/after execution. The uncompressed 3,138,118-byte capture SHA-256 is `f2c3187c40173f64b0acb51cd86d0ca9ce8a250b5d634fc4e9a2c3d95c56fe1e`. Gzip SHA-256: `b1cb5b61c736534b82ce6105a8c0f943c37b60921345f6e1dd78914ceb975f7b`. ROM SHA-256: `6fae1b9e92872ec3ae497eb5f9e7b65126409480f37e9126cc42de862f2e570b`.

Root independently reassembled and linked the ROM, authenticated historical source, replayed every physical byte and delivery frame, and reconstructed the rational PIT clock and mode-zero countdown. A second source/ROM/backing/frame audit agrees. Full CPU and configured-chip checkpoint validation also uses a cached fresh execution of the same committed engine, explicitly labeled as such. Neither this replay nor the independent byte/timer ledger is a third architectural CPU implementation.

Mutations check lost REP writes with coherent ordinal/interval mirrors, failed-work charging, saved RF/error/EIP, partial progress, zero/final REP charging, timer countdown/output/fraction, actual edge and ACK timing, decoder bounds, source identities, and full CPU/chip checkpoint changes with coherent continuity mirrors. Early unlinked-ROM, out-of-REP timer, and incorrect expected-RF drafts remain retained diagnostics; they are not relabeled as passing captures.

From a clean checkout:

```sh
node scripts/run-i80386-rep-pf-pit-oracle.mjs /new/rep-pf-pit.json
node --test --test-concurrency=1 test/i80386-rep-pf-pit-oracle.test.mjs
```

The CLI retains the actual bounded capture before semantic assertions. CI tests permit unrelated setup files while still requiring committed measured inputs. Code/guest changes need fresh qualification; documentation descendants can validate this receipt while those 41 blobs remain unchanged.

Raw reset differences from Bochs CPU3 remain visible. Explicit guest CR0 operands `11` and `80000011` do not establish raw native parity: pinned Bochs CPU3 forces `7FFFFFF0` reserved bits on every write, predicting `7FFFFFF1` and `FFFFFFF1`. This is recorded source evidence, not native execution of this guest. The JS profile remains compatibility with no NPX; no x87 behavior is tested.

## Next native gate

Bring this fixture through a separate native bridge with actual board ownership. The [qualified RAM/SMC/A20 bridge](I80386-NATIVE-RAM-COHERENCE-ACTUAL-BOARD.md) currently assumes successful-instruction Q+1 commits and rejects faults/IRQ/REP. Its next extension must flush acknowledged cache changes at each successful REP element and at zero-work fault/IRQ delivery boundaries. Preserve page-walk A/D side effects that precede a failed operand; do not discard every write from a failed attempt. Native PF/IRQ stack-write order needs its own raw audit; the earlier eight far-CALL exception grants no general permutation.

Require fresh native continuous and 1/2/257 captures, actual PIC/PIT/debt parity, guards, transport rejections, meaningful mutation tests, and independent reproduction before qualification. A production backend, in-process/WASM execution and paired workload speed measurements follow; the 10× target remains unfinished.
