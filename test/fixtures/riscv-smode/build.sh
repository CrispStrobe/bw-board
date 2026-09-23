#!/usr/bin/env bash
# Build the S-mode paging demo (clang + ld.lld, rv32ima — no compressed ISA, so
# no RVC needed). The stripped ELF is committed as base64 for a toolchain-free
# boot test. This demo is original bw-board code (no third-party kernel).
set -euo pipefail
cd "$(dirname "$0")"
CC="${CC:-clang}"; OBJCOPY="${OBJCOPY:-llvm-objcopy-18}"
"$CC" --target=riscv32 -march=rv32ima -mabi=ilp32 -O2 -ffreestanding -nostdlib \
      -fno-pic -mcmodel=medany -Wall -fuse-ld=lld -T riscv.ld \
      start.S kernel.c -o smode-demo.elf
"$OBJCOPY" --strip-all smode-demo.elf
readelf -h smode-demo.elf | grep -E 'Type|Machine|Entry'
base64 -w0 smode-demo.elf > smode-demo.elf.b64
rm -f smode-demo.elf
echo "wrote smode-demo.elf.b64 ($(wc -c < smode-demo.elf.b64) bytes)"
