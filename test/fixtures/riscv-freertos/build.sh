#!/usr/bin/env bash
# Build the FreeRTOS demo .elf for the bw-board RISC-V machine.
#
# Toolchain: clang (riscv32 target) + ld.lld — no RISC-V gcc required. The
# resulting freertos-demo.elf is committed alongside as base64 (freertos-demo.elf.b64)
# so the boot test needs no toolchain; this script regenerates it.
#
# Kernel: FreeRTOS-Kernel (MIT), pinned. Point FREERTOS_KERNEL_DIR at a checkout
# of the pinned commit:
#   git clone --branch V11.1.0 https://github.com/FreeRTOS/FreeRTOS-Kernel.git
#   (pinned commit dbf70559b27d39c1fdb68dfb9a32140b6a6777a0)
#
# Usage: FREERTOS_KERNEL_DIR=/path/to/FreeRTOS-Kernel ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

K="${FREERTOS_KERNEL_DIR:?set FREERTOS_KERNEL_DIR to a FreeRTOS-Kernel checkout (V11.1.0)}"
PORT="$K/portable/GCC/RISC-V"
CHIP="$PORT/chip_specific_extensions/RV32I_CLINT_no_extensions"
CC="${CC:-clang}"
# picolibc's *headers* provide the standard declarations (size_t, string.h protos)
# the kernel #includes. We link no libc: mem* live in libc_shim.c and the image
# stays -nostdlib. Override with LIBC_INCLUDE if picolibc is elsewhere.
LIBC_INCLUDE="${LIBC_INCLUDE:-/usr/lib/picolibc/riscv64-unknown-elf/include}"

CFLAGS=(
  --target=riscv32 -march=rv32ima -mabi=ilp32 -O2 -g
  -ffreestanding -nostdlib -fno-pic -mcmodel=medany -Wall
  -isystem "$LIBC_INCLUDE"
  -I. -I"$K/include" -I"$PORT" -I"$CHIP"
)

SRCS=(
  start.S main.c libc_shim.c
  "$K/tasks.c" "$K/list.c" "$K/queue.c"
  "$PORT/port.c" "$PORT/portASM.S"
  "$K/portable/MemMang/heap_4.c"
)

echo "clang: $($CC --version | head -1)"
echo "lld:   $(ld.lld --version)"
"$CC" "${CFLAGS[@]}" -fuse-ld=lld -T riscv.ld \
      "${SRCS[@]}" -o freertos-demo.elf
# Strip symbols/debug: the committed fixture only needs its PT_LOAD segments and
# entry, and stripping keeps the base64 small. Program headers survive.
OBJCOPY="${OBJCOPY:-llvm-objcopy-18}"
"$OBJCOPY" --strip-all freertos-demo.elf
echo "built freertos-demo.elf:"
readelf -h freertos-demo.elf | grep -E 'Type|Machine|Entry'
base64 -w0 freertos-demo.elf > freertos-demo.elf.b64
rm -f freertos-demo.elf                       # only the .b64 is committed
echo "wrote freertos-demo.elf.b64 ($(wc -c < freertos-demo.elf.b64) bytes)"
