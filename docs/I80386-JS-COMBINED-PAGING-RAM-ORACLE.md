# Actual-board JS: protected paging, RAM execution, SMC and A20

**Qualified bounded baseline, 2026-10-01.** A free MIT cold-reset ROM combines the [REP/two-page-fault/PIT case](I80386-JS-REP-PF-PIT-ORACLE.md) with eight protected-mode entries into guest-created RAM code, self-modification and actual 8042 A20 OFF/ON. It completes 192 successful work quanta, 194 attempts and 1156 functional board clocks. These are functional charges, not 192 retired instructions or measured physical 386 timing.

The [capture](receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-capture.json.gz), [result](receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-result.json) and [independent audit](receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-audit.json) are public. This is the JavaScript compatibility profile (`strict386=false`). The separately qualified native [ROM-executed REP/PF/PIT gate](I80386-NATIVE-REP-PF-PIT-ACTUAL-BOARD.md) and [real-mode RAM/SMC/A20 gate](I80386-NATIVE-RAM-COHERENCE-ACTUAL-BOARD.md) remain separate scopes; their combined native execution is next.

## Guest and actual memory

The [free guest](../test/fixtures/i80386-free-combined-paging-ram.S) starts at raw `FFFFFFF0`, creates low code at `7000` and high code at `107000`, installs GDT/IDT and sparse 4 KiB page tables, and enters protected16 code. No RAM code or CPU state is preseeded. High real-mode initialization uses `ES=FFFF`, offset `7010`, within the segment limit.

The RAM bodies are `MOV BX,imm16; RETF`. Code selectors `18` and `20` have bases zero and `100000`, limit `FFFF`, and 16-bit defaults; data selector `28` supplies high operand stores. All eight same-ring far CALLs execute their RAM instruction and return through the actual stack. The two low entries occur before PIT programming; the remaining six follow IRQ return.

| Entry | Selector | Raw physical PC | A20 | Witness |
|---|---|---|---|---|
| Initial low | `18` | `7000` | ON | `1111` |
| Patched low | `18` | `7000` | ON | `2222` |
| High alias | `20` | `107000` | OFF | `2222` |
| Low before alias write | `18` | `7000` | OFF | `2222` |
| Low after alias write | `18` | `7000` | OFF | `5555` |
| High after alias write | `20` | `107000` | OFF | `5555` |
| Independent high restored | `20` | `107000` | ON | `3333` |
| Patched high | `20` | `107000` | ON | `4444` |

Both current OFF aliases execute before the raw high operand write updates decoded low backing. Final code is `BB5555CB` at `7000`, `BB4444CB` at `107000`; words `0560..056F` retain all eight witnesses. The four REP destination words and ordinary/one-REP data remain on non-executable pages. Page-table, descriptor, stack and witness writes are retained separately from code writes.

## REP, faults and actual timer

The existing data32/address16 REP spans `4FF8..5007`, faults at missing `5000`, repairs its PTE through guest code and MOV CR3, and resumes the remaining two elements. The ordinary write to missing `6000` triggers the second page fault and guest repair. Zero REP makes no destination access; one-element REP charges once. Faults occur after Q94 and Q111, with error2 and RF-bearing frames. Neither failed attempt nor fault/IRQ delivery earns a successful quantum.

Guest-programmed binary mode-0 PIT channel0, reload6, raises actual PIC IRQ0 at Q93, board cycle562, CX3/DI4FFC: after one successful REP element and before the second fetch. IRQ vector20 is acknowledged after the STI successor at Q129. Its saved EIP is the actual `after_shadow` symbol; the guest sends EOI and emits `RPGC001`. All eleven configured chip snapshots, debt, advance phases and terminal settlement remain captured.

## Recorded cache policy

This baseline explicitly sets `experimentalFastA20Port92=true` to install the board's 8042 translation-cache invalidation callback. The fast latch stays zero and the guest never uses port92. The actual OFF/ON transitions occur at Q146/cycle880 and Q167/cycle1006. Exactly two controller invalidations precede those gate changes, using the old gate/epoch in their raw records.

The existing JavaScript implementation also invalidates translations on tracked page-table writes and every ordinary byte write while A20 is OFF. The capture records 36 invalidations: five guest CR0/CR3 control writes, two tracked-table writes, 27 ordinary OFF writes and two controller hooks. Pagewalk A/D writes cause zero invalidations. Generations run from one to 37 across the full CPU checkpoint ledger.

This is recorded implementation behavior, **not architectural stale-PTE parity or native TLB parity**. Native comparison must retain the full read/pagewalk chronology and audit precise source-backed differences. Ordinary non-code/table writes must not automatically justify a production native TLB flush. The [combined native plan](I80386-NATIVE-COMBINED-RAM-REP-NEXT-GATE.md) separates executable-alias repair from mapping changes and keeps RAM REP/current-page SMC outside its first bounded scope.

## Qualification and replay

Measured source `15f010c92b5227622b76da815bd47000e28a988c` authenticates 41 guest/code inputs. ROM SHA-256 is `608930336bd6ea9bc7a49ae02d823f54c46786a2359b335c0c1ccee55f7bb938`; source assembly SHA-256 is `0be1a177c4f59649d90653bf524b8b88c561d00fbb0b05d6b7dd792f966d27ad`. The two fresh captures are byte-identical: 4,762,372 bytes, SHA-256 `bcf52cc49849a2c7889077d2b6f80d980916766d175ab78cd656689d9a7f3ab2`. Public gzip is 91,478 bytes, SHA-256 `93d02510df5d98c7db2b079bd2d316e56111162fc4d4d58ec685851e7b950bb1`.

All 37 focused tests pass without skips: one assembler check, one actual baseline and 35 targeted corruptions. Coherent CPU/chip mutations preserve continuity and reach semantic checks for protected CALL/RETF, RAM witnesses, aliases, pagewalk roles, A/D bits, cache origins, RF frames, REP charging and PIT phase/countdown. The checker also caches a reexecution through the same JavaScript CPU; this is reproduction evidence, not an independent architectural CPU oracle.

Root separately assembles/links the ROM, authenticates source blobs, replays the full 16 MiB backing, derives CALL and fault/IRQ frame bytes, and checks rational PIT phases/countdown in both captures. An independent auditor checks 27,260 assertions per capture, including all protected segment caches, 1049 typed translation intervals, every translation generation and its source-owned origin. Raw evidence retains 3079 events: 761 instruction bytes, 857 read bytes, 347 write bytes, 25 PIO operations, one PIT output, one ACK, two A20 transitions, 1049 translations and 36 invalidations. Read32 providers remain active; 16-bit RAM bodies do not consume fetchRam32.

```sh
node scripts/run-i80386-combined-paging-ram-oracle.mjs /new/capture.json
node --test --test-concurrency=1 test/i80386-combined-paging-ram-oracle.test.mjs
```

Use a clean committed checkout, GNU binutils and Node20. Assembly uses `as --32`, then `ld -m elf_i386 -Ttext 0 -e setup`. The early default-profile pilot did not install the specialized A20 hook; later explicit-profile pilots still had uncommitted sources. Those diagnostics remain preserved and are not the source-bound publication. A first root CLI invocation omitted the required output argument and failed before execution; its usage log is retained separately.

Next qualify this same combined guest through a separate native bridge before production backend and paired guest-workload speed measurements. Full AT boot, strict-386 xv6, Windows enhanced mode, Doom and the 10× target are not established by this bounded baseline.
