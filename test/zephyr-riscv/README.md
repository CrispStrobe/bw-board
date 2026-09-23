# Zephyr on the emulated RISC-V SoC (CI cross-build)

Boots a real **Zephyr RTOS** image on `RiscV32Machine`. Zephyr's `qemu_riscv32`
board is M-mode + SiFive CLINT@0x02000000 + NS16550 UART@0x10000000 + RAM@0x80000000
— an exact match for our machine once `ramBase` is `0x80000000` (the configurable
RAM base). So a **stock** Zephyr `qemu_riscv32` build boots unmodified.

## Why this is built on CI, not on the box

The Zephyr SDK + source tree is several GB and the build spawns parallel
compilers — more than the shared dev box can host. So the heavy build runs in CI
(`.github/workflows/zephyr-riscv.yml`, in the Zephyr CI container), and a light
second job boots the result here with `boot.mjs`. Booting is cheap; only the
build is heavy. This is the FreeRTOS/RT-Thread "fixture, not toolchain" pattern,
with the toolchain moved to CI.

## What runs

`samples/synchronization` (Zephyr, Apache-2.0): two threads hand off a semaphore
and each print a line via the console UART. `boot.mjs` asserts both `thread_a`
and `thread_b` appear — proving the kernel booted, the CLINT tick drives
`k_sleep`/scheduling, and ecall-based context switch reaches Zephyr's trap
handler (`ecallTraps`).

- Zephyr **v3.7.0** (LTS), Apache-2.0. https://github.com/zephyrproject-rtos/zephyr
- `boot.mjs` — loads `zephyr.elf` (ET_EXEC, via `loadExecSegments`) at RAM base
  `0x80000000` and asserts the two threads ran.

## Next (once the CI build is green)

Commit the built `zephyr.elf.b64` as a fixture + a committed boot test (so the
box runs it with no toolchain), then embed it in brickwright-lite's RISC-V
programs so Zephyr boots in the browser too — the same path the RTOSes took.
