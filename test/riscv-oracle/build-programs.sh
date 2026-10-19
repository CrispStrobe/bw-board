#!/usr/bin/env bash
# Build the oracle's own test programs (programs/*.S) with a riscv64 GCC in
# rv32 mode, linked at 0x80000000 by the same script as the arch tests.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/build}"
CC="${RISCV_CC:-riscv64-unknown-elf-gcc}"
mkdir -p "$out"
for s in "$here"/programs/*.S; do
    n="$(basename "$s" .S)"
    "$CC" -march=rv32imac_zicsr_zifencei -mabi=ilp32 -static -nostdlib -nostartfiles \
        -T "$here/arch-env/link.ld" -Wl,-e,_start -o "$out/prog-$n.elf" "$s"
done
ls "$out"
