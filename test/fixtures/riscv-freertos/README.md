# FreeRTOS demo for the emulated RISC-V SoC

A minimal but real **FreeRTOS** image that boots on the bw-board emulated RISC-V
machine (RV32IMA + SiFive CLINT + NS16550 UART) and demonstrates preemptive
multitasking. Booted by `test/riscv32-freertos.test.mjs`.

## What's here

| file | what it is |
|---|---|
| `main.c` | the demo: two tasks (`hi` prio 2, `lo` prio 1) whose interleaved UART output proves the scheduler, the timer tick, ecall-based yield, and priority preemption |
| `FreeRTOSConfig.h` | kernel config for this machine (CLINT at the SiFive layout; 1000 instructions/tick) |
| `start.S` | reset entry: sets `gp`/`sp`, zeroes `.bss`, **installs `freertos_risc_v_trap_handler` into `mtvec`** (the GCC/RISC-V port does not), then calls `main` |
| `riscv.ld` | linker script — flat RAM at `0x0` (the machine resets pc to 0) |
| `libc_shim.c` | the handful of `mem*` routines the kernel calls, so the image links `-nostdlib` |
| `build.sh` | rebuilds `freertos-demo.elf.b64` with clang + ld.lld |
| `freertos-demo.elf.b64` | the committed, stripped ELF fixture (so the test needs no toolchain) |

## Licensing

The kernel is [FreeRTOS-Kernel](https://github.com/FreeRTOS/FreeRTOS-Kernel)
**V11.1.0** (commit `dbf70559b27d39c1fdb68dfb9a32140b6a6777a0`), **MIT** licensed
— compatible with bw-board's MIT. Only the *compiled* image is committed here;
the kernel source is fetched by `build.sh`, not vendored. `main.c`,
`FreeRTOSConfig.h`, `start.S`, `riscv.ld` and `libc_shim.c` are original bw-board
code. See the repository `THIRD-PARTY.md`.

## Rebuilding the fixture

Needs `clang` (riscv32 target), `ld.lld`, `llvm-objcopy`, and picolibc's headers
(`picolibc-riscv64-unknown-elf` on Debian/Ubuntu — headers only; no libc is linked):

```sh
git clone --branch V11.1.0 https://github.com/FreeRTOS/FreeRTOS-Kernel.git
FREERTOS_KERNEL_DIR=$PWD/FreeRTOS-Kernel ./build.sh
```

This regenerates `freertos-demo.elf.b64`; the test then boots it unchanged.
