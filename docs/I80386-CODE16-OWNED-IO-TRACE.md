# Owned protected-16 executable trace spike

The opt-in
[`runOwnedI80386Code16IoTrace`](../src/experimental/i80386-code16-owned-io-trace.js)
executes exactly the owned boot fixture's `MOV BX,1; CMP BX,imm8; JZ +6`
span in one bounded call. It does not call `cpu.step()` for these three
instructions and is not wired into the normal CPU, AT machine, CLI or GUI.
It accepts only the fixture's protected-16 CS, DS, SS, EIP, segment cache,
code bytes and no-paging state. The immediate may be `1` (taken branch) or
`2` (fallthrough). Other code, debug/shadow state and shorter chip-event
horizons are refused without changing guest state. The caller must provide
a pure stable fetch bus and an event horizon already expressed in guest
instruction slots; this spike does not calculate a real chip deadline.

At `stepsUntilChipEvent:3`, the taken case returns:

```json
{"accepted":true,"completed":3,"reason":"io-required","stop":{"cs":8,"eip":31804},"branchTaken":true}
```

`31804` is `7C3C`, the `IN AL,DX` instruction. The call has made **zero**
device reads. One ordinary `cpu.step()` then performs exactly one 8-bit
read of PIC1 port `0021` and stops at `CS:EIP=0008:7C3D` with `AL=A5`.
The full test checkpoint compares all eight general registers, all six
segment selectors, EIP, EFLAGS, CR0, cycle count and device-read count
against three ordinary steps and the one-step resume. The selected
CS/segment/EIP/EFLAGS/BX/DX/AL fields also match the existing
[QEMU pre/post checkpoints](receipts/2026-09-28-i80386-win16-io-boundary-oracle.json).
The test hashes the owned assembly, assembled image and 386 core against
that receipt. The pinned Bochs CPU-level-3 result remains an `A5 4B`
output witness only; it has no per-instruction state snapshot.

A horizon of one or two instructions returns `chip-deadline` with zero
completed instructions and no CPU or port change. Changing the CMP
immediate to `2` causes the JZ fallthrough exit at `7C36`; its complete
local state matches ordinary stepping and no device read occurs. Changing
the JZ displacement returns `code-mismatch` before any state change.
These are acceptance controls for a future event-aware block engine, not
Windows workload coverage, interrupt-timing proof, or a speed claim.
The [source-bound acceptance receipt](receipts/2026-09-28-i80386-code16-owned-io-trace.json)
records the four passing focused tests, fixture/source hashes, and exact
checkpoint and refusal outcomes. It links to the earlier QEMU/Bochs oracle
receipts without upgrading Bochs to a CPU-state reference.

Run the focused tests with:

```sh
node --test test/i80386-code16-owned-io-trace.test.mjs
BOCHS_386_ROOT=/path/to/pinned/bochs node --test test/i80386-win16-io-boundary-oracle.test.mjs
```
