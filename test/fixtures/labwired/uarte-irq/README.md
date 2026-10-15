# UARTE interrupt-chain guest (A10)

Original MIT Cortex-M4 assembly from the exact core source in `provenance.json`;
no Nordic or CODAL implementation copied. Its real UARTE0 interrupt handler
starts the next stack-backed byte on ENDTX before inspecting TXSTOPPED. The
last byte explicitly requests STOPTX. RAM at `0x20000100` contains six words:
terminal status (1 = done, 2 = unsolicited stop, 3 = timeout), completed bytes,
unsolicited-stop count, busy flag, next-byte index and explicit-stop request.
Qualification requires all six expected values and exact `A10 IRQ chain OK\n`.
An unsolicited stop can never pass by a later terminal-status overwrite because
its monotonic failure counter must remain zero.

Rebuild here with GNU Arm Embedded GCC 12.2.1:

```sh
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -nostdlib -Wl,-T,board-io.ld -o firmware.elf uarte-irq-chain.S
```

Source/linker/ELF hashes establish identity. The actual released-WASM test is
separate from native guest qualification and from Lite's real compiled MakeCode
CLI/browser assertions. No whole-board or physical timing claim is made.
