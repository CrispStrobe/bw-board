# RT-Thread Nano demo for the emulated RISC-V SoC

A real **RT-Thread Nano** image that boots on the bw-board emulated RISC-V machine
(RV32IMA + SiFive CLINT + NS16550 UART) and demonstrates preemptive multitasking
— a second, independent RTOS on the same map as the FreeRTOS demo. Booted by
`test/riscv32-rtthread.test.mjs`.

Unlike FreeRTOS, RT-Thread's cooperative context switch is a **direct**
save/restore + `mret` (not an `ecall`), and preemption happens in `trap_entry`
off the CLINT timer interrupt — so this boots on the **plain** machine (no
`ecallTraps`), exercising a different context-switch design.

## What's here

| file | what it is |
|---|---|
| `main.c` | the demo: `main()` (prio 10) prints `H` then `rt_thread_mdelay(5)`; a `wrk` thread (prio 12) prints `L` every tick; interleaved output proves preemption |
| `rtconfig.h` | RT-Thread Nano config for this machine (1000 ticks/s, small-mem heap, user main) |
| `board.c` | the BSP: `handle_trap` (CLINT tick), `rt_hw_board_init` (mtvec + systick + heap), `rt_hw_console_output` (UART) |
| `start.S` | reset entry: `gp`/`sp`, zero `.bss`, call RT-Thread `entry()` |
| `riscv.ld` | linker script — flat RAM at `0x0`, heap between `.bss` and the startup stack |
| `libc_shim.c` | freestanding `mem*`/`str*` so the image links `-nostdlib` |
| `build.sh` | rebuilds `rtthread-demo.elf.b64` with clang + ld.lld |
| `rtthread-demo.elf.b64` | the committed, stripped ELF fixture (test needs no toolchain) |

## Licensing

Kernel: [RT-Thread Nano](https://github.com/RT-Thread/rtthread-nano) (commit
`8afd041631ec44653c2de45581bcdae15fb2ae06`), **Apache-2.0**. Only the *compiled*
image is committed here; the kernel source is fetched by `build.sh`, not vendored.
`main.c`, `board.c`, `start.S`, `rtconfig.h`, `riscv.ld` and `libc_shim.c` are
original bw-board code. See the repository `THIRD-PARTY.md`.

## Rebuilding

```sh
git clone https://github.com/RT-Thread/rtthread-nano.git
RTT_DIR=$PWD/rtthread-nano/rt-thread ./build.sh
```
(Needs clang riscv32 + ld.lld + llvm-objcopy + picolibc headers — headers only.)
