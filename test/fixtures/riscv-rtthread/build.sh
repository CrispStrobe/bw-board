#!/usr/bin/env bash
# Build the RT-Thread Nano demo .elf for the bw-board RISC-V machine.
#
# Toolchain: clang (riscv32) + ld.lld — no RISC-V gcc. picolibc headers only
# (no libc linked; mem*/str* live in libc_shim.c). The stripped ELF is committed
# as base64 (rtthread-demo.elf.b64) so the boot test needs no toolchain.
#
# Kernel: RT-Thread Nano (Apache-2.0), pinned. Point RTT_DIR at the rt-thread/
# directory of a checkout:
#   git clone https://github.com/RT-Thread/rtthread-nano.git   # pinned 8afd0416
#   RTT_DIR=$PWD/rtthread-nano/rt-thread ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

RTT="${RTT_DIR:?set RTT_DIR to the rt-thread/ dir of an rtthread-nano checkout}"
CC="${CC:-clang}"
# RT-Thread's banner embeds __DATE__/__TIME__; pin SOURCE_DATE_EPOCH so clang
# makes those reproducible and the committed fixture is byte-stable.
export SOURCE_DATE_EPOCH=1704067200      # 2024-01-01T00:00:00Z, fixed
OBJCOPY="${OBJCOPY:-llvm-objcopy-18}"
LIBC_INCLUDE="${LIBC_INCLUDE:-/usr/lib/picolibc/riscv64-unknown-elf/include}"

CFLAGS=(
  --target=riscv32 -march=rv32ima -mabi=ilp32 -O2 -g
  -ffreestanding -nostdlib -fno-pic -mcmodel=medany -Wall
  -isystem "$LIBC_INCLUDE"
  -I. -I"$RTT/include" -I"$RTT/libcpu/risc-v/common"
)

SRCS=(
  start.S board.c main.c libc_shim.c
  "$RTT/src/clock.c" "$RTT/src/object.c" "$RTT/src/scheduler.c"
  "$RTT/src/thread.c" "$RTT/src/timer.c" "$RTT/src/ipc.c" "$RTT/src/irq.c"
  "$RTT/src/kservice.c" "$RTT/src/mem.c" "$RTT/src/idle.c" "$RTT/src/components.c"
  "$RTT/libcpu/risc-v/common/context_gcc.S"
  "$RTT/libcpu/risc-v/common/cpuport.c"
  "$RTT/libcpu/risc-v/e310/interrupt_gcc.S"
)

echo "clang: $($CC --version | head -1)"
"$CC" "${CFLAGS[@]}" -fuse-ld=lld -T riscv.ld "${SRCS[@]}" -o rtthread-demo.elf
"$OBJCOPY" --strip-all rtthread-demo.elf
readelf -h rtthread-demo.elf | grep -E 'Type|Machine|Entry'
base64 -w0 rtthread-demo.elf > rtthread-demo.elf.b64
rm -f rtthread-demo.elf
echo "wrote rtthread-demo.elf.b64 ($(wc -c < rtthread-demo.elf.b64) bytes)"
