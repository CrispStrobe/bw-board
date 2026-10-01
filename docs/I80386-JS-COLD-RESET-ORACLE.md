# Actual JavaScript 386 board cold-reset oracle

**Status (2026-10-01): source-bound JavaScript board checkpoint passed and independently reproduced.** Source is frozen at `a12549a66783a05a159692d5e2794d0271c3ef70`. This is the existing board's compatibility-profile JavaScript CPU, not native reset parity or a new shipped backend.

The new MIT-licensed 64 KiB ROM begins with a hardware-reset fetch at physical `0xfffffff0`, decoded to the configured alias at `0xfffff0`. Its far jump reloads CS and continues at `F000:0100` / physical `0xf0100`. It sets segments and stack, stores raw reset EDX/CR0 before initializing working registers, writes and reads a RAM signature, attempts a ROM write, reads/writes open bus, emits `CRST001` through port `0xe9`, and enters CLI/HLT at `F000:018a`.

The actual `PCAT80386_EXPERIMENTAL` board owns memory decode, ports and devices. A fresh machine receives the same ROM in its low BIOS and reset-alias mappings and exactly one hardware reset. Reset advances devices by four board clocks with no CPU instruction. Forty-nine successful instructions add 294 functional clocks, for 298 total. At terminal HLT, the runner settles 18 pending chip clocks without executing an idle CPU step. These are functional scheduling units, not physical 386DX cycles or an RTx result.

The capture records 143 executable byte fetches, five data-read bytes, fifteen physical write bytes and seven port outputs, with raw/decoded addresses, effects, instruction boundaries and selected CPU/device/debt state. RAM `0x500..504` ends as `a5 5a a7 ff ff`; ignored ROM and open-bus writes leave their readbacks unchanged. Guest RAM `0x510..517` retains reset EDX=`0x300`, CR0=`0`, separate from later working EDX=`0x12345678`. Source/config/ROM/full backing seed and final memory hashes are retained. The validator replays byte effects and functional clocks, checks PIT fractional carry and PIC pending state, and authenticates measured source blobs at the captured commit. Documentation-only successors may validate the same executable bytes without rewriting the receipt's source SHA.

Full selected RTC/DMA/A20/system-control state is recorded and agrees between the two actual runs. The checker does not independently replay every ancillary device field. No IRQ, fault, protected-mode transition, REP, DMA, disk, VGA, mouse, or reset-state transfer into native execution is qualified here.

## Receipts and independent audit

- Free ROM: 65,536 bytes, SHA-256 `ea3d123a6fc9bfaee7258e98f44bc5b0d91b34aea9a01fcc5e5606339422e49b`.
- Assembly source: `aedf3c0262046d6aa219c11db97ccdb9eab1868a6a56d79413c621ec3c4c740f`.
- [Exact capture](receipts/2026-10-01-i80386-js-cold-reset-oracle-capture.json): SHA-256 `3adf9b44bb5eb6f86ffd8e24e702732dd9e21e15fb8dcedc0eeb8380d26dc66b`.

Root's independent capture is byte-identical. Root separately assembled and disassembled the ROM, checked every executable byte/address against the independently built image, verified the reset/far-jump fetch sequence, calculated the PIT fractional carry with rational clocks, and checked that settling debt leaves CPU state unchanged. The focused tests pass 22/22: an actual baseline plus 21 rejected mutations of reset/fetch/source/clock/memory/profile/witness evidence. The capture CLI refuses to overwrite a prior output and persists measured evidence before validation.

Reproduce from a clean checkout of the frozen source with a new output path; GNU `as`, `objcopy` and `nm` are required:

```sh
node scripts/run-i80386-cold-reset-oracle.mjs /new/cold-reset-capture.json
node --test test/i80386-cold-reset-oracle.test.mjs
```

## Native differences and next implementation

Pinned Bochs CPU3 reset differs from this JavaScript profile. The report preserves the raw JavaScript state and names the native source differences; these are source-audit findings, not measurements of a native cold-reset run.

| Reset field | JavaScript board | Pinned Bochs CPU3 |
| --- | --- | --- |
| EDX | `0x300` | `0` |
| CR0 | `0` (no coprocessor) | `0x7ffffff0` |
| GDTR limit | `0` | `0xffff` |
| IDTR limit | `0x3ff` | `0xffff` |
| DR6 / DR7 | `0` / `0` | `0xffff1ff0` / `0x400` |
| Hidden CS type | code/read-only | data/read-write/accessed |

Undefined CR0 bits 5..30 are deterministically zero in JavaScript; ET, EDX, descriptor limits, debug-register values and hidden attributes require explicit compatibility decisions or fixes. No broad mask is used to claim agreement. Initial-state differences remain reported even where the ROM initializes a field before the later checkpoint.

The [cold-reset/actual-board contract](I80386-NATIVE-COLD-RESET-NEXT-GATE.md) remains next for native execution: activate before its first reset fetch, route physical/PIO callbacks into the same board, admit stable ROM execution pages and preserve reset/scheduler ownership. A subprocess proof needs bounded execution-page transfer with persistent caches and explicit write/A20 invalidation; eventual WASM should use direct callbacks. After that checkpoint, add executable RAM/self-modification/A20 and the existing REP/two-fault/PIT fixture. Full AT boot, strict-386 xv6, Windows enhanced mode, Doom and the 10×/RTx objective remain unfinished.
