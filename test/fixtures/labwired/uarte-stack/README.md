# UARTE stack-lifetime guest (A10)

Original MIT-licensed Cortex-M4 assembly from the exact LabWired source commit
in `provenance.json`; no Nordic, CODAL or MakeCode implementation copied.
`stack_putc` arms a one-byte transfer from its stack, returns, and a separate
function overwrites that same slot before polling ENDTX. Expected UART bytes:
`A10 stack reuse OK\n`. RAM at `0x20000100` records terminal status (1 = done,
2 = timeout), followed by transmitted and reused-slot counts.

Rebuild from this directory with ARM GCC (the retained fixture was built with
GNU Arm Embedded GCC 12.2.1):

```sh
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -nostdlib -Wl,-T,board-io.ld -o firmware.elf uarte-stack-buffer.S
```

The model's source-built native guest qualification and this consumer's actual
released-WASM test are separate. Hashes bind the retained source, linker and
ELF; passing those hashes alone does not prove serial correctness, whole-board
accuracy, physical timing or a released engine.
