#!/usr/bin/env bash
# Build hello.c with the COMPRESSED ISA (rv32imac) so the image is full of RVC.
set -euo pipefail; cd "$(dirname "$0")"
clang --target=riscv32 -march=rv32imac -mabi=ilp32 -Os -ffreestanding -nostdlib \
      -fno-pic -Wl,-Ttext=0x1000 -fuse-ld=lld hello.c -o rvc-hello.elf
llvm-objcopy-18 --strip-all rvc-hello.elf
base64 -w0 rvc-hello.elf > rvc-hello.elf.b64; rm -f rvc-hello.elf
echo "wrote rvc-hello.elf.b64 ($(wc -c < rvc-hello.elf.b64) bytes)"
