# Owned cross-mode polling-loop execution proof

The [cross-mode potential-trace census](I80386-CROSS-MODE-POTENTIAL-TRACE-OBSERVER.md) passed its necessary 60M Windows opportunity screen. This opt-in proof implements only one owned nine-byte loop, separately from the ordinary dispatcher:

```asm
loop: in   al, dx
      mov  [bx/ebx], al
      mov  al, [bx/ebx]
      cmp  al, imm8
      jnz  loop
```

[`runOwnedI80386CrossModeIoProof`](../src/experimental/i80386-cross-mode-io-proof.js) executes these instructions without calling `cpu.step()`; the ordinary CPU remains the reference and fallback. The fixture fixes CS, DS, DX=0021 (PIC1 mask), code location, no paging, A20, descriptor values, CPU mode, interrupt/debug state and a single physical RAM code page. The 16-bit modes use BX addressing and protected32 uses EBX. VM86 has an explicitly checked RAM TSS I/O bitmap granting port 0021, because this CPU checks the bitmap even at IOPL3. This is a fixture grammar, not a general cross-mode micro-op decoder.

Before each instruction the runner rechecks code bytes, mode and translation identity, chip deadline, interrupt/debug state, and the effective RAM address when a load or store is next. It exits before a missing, non-RAM, code-page, page-table, segment-limit or other unsafe data access. `IN` invokes the same synchronous board port read as ordinary stepping; that helper catches up chips and re-arms the horizon. The runner then rechecks the boundary before executing the next instruction. It charges the same functional board cycles and commits each instruction before a later side exit. A callback that changes code bytes, CR0 or a descriptor is observed before the following RAM access. An unrecognized boundary resumes through ordinary `machine.step()`.

The [focused differential tests](../test/i80386-cross-mode-io-proof.test.mjs) compare taken and fallthrough loops in real, protected16, VM86 and protected32 modes. They compare the complete core rollback snapshot, all RAM by SHA-256, board cycles/debt/deadline, modeled chip states, and the ordered port, operand-RAM and VM86 bitmap read/write log including EIP at each effect. Separate tests cover a chip deadline, a dynamic RAM slow exit followed by ordinary fault handling, code mutation, a synchronous callback changing code or translation state, descriptor mutation, VM86 I/O denial, and refusal before any device read. All tests use a bounded owned fixture; there was no full Windows or xv6 executable run and no speed measurement.

This proof does **not** establish a reusable Windows trace executor. Paging, MMIO, arbitrary code bytes, other ports and opcodes, general IRQ/NMI scheduling, cache invalidation across raw external mutations, and a compiled backend remain outside its admitted contract. A future general implementation needs independent parity for these cases and the draft's full opt-in guest and serial user-CPU gates before any performance or default-path claim.
