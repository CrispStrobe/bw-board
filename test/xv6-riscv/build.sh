#!/usr/bin/env bash
# Build the xv6-rv32 kernel + filesystem image for the boot test. Uses a riscv64
# GCC in rv32 mode (rv32imac_zicsr / ilp32). xv6-rv32 (michaelengel) targets a
# riscv32-unknown-elf gcc that defaults to rv32; the patches below make the more
# common riscv64 toolchain build it, and shrink PHYSTOP so the interpreter's
# per-page memset at boot isn't zeroing 128 MiB.
set -euo pipefail
cd "$(dirname "$0")"
REV=73b634560546a13f3c1a209c09cc6b584e1de68f   # pinned michaelengel/xv6-rv32

rm -rf xv6-rv32
git clone https://github.com/michaelengel/xv6-rv32.git
git -C xv6-rv32 checkout -q "$REV"
cd xv6-rv32

# Force rv32imac + zicsr + ilp32 on the riscv64 toolchain (it defaults to rv64).
sed -i '/^CFLAGS += -mcmodel=medany/a CFLAGS += -march=rv32imac_zicsr -mabi=ilp32' Makefile
sed -i 's/^LDFLAGS = /LDFLAGS = -m elf32lriscv /' Makefile
sed -i 's/-Wall -Werror/-Wall/' Makefile          # newer gcc warns on ptr casts / uninit
# The builtin .S rule ignores CFLAGS, so the assembly built rv64; force it.
printf '\n%%.o: %%.S\n\t$(CC) $(CFLAGS) -c -o $@ $<\n' >> Makefile
# 16 MiB of RAM is plenty for the boot and keeps freerange fast.
sed -i 's/#define PHYSTOP (KERNBASE + 128\*1024\*1024)/#define PHYSTOP (KERNBASE + 16*1024*1024)/' kernel/memlayout.h

# Our riscv64 toolchain emits a .riscv.attributes section; the linker gives it its
# own RISCV_ATTRIBUTES program header, so each user ELF has two phdrs. But xv6-rv32
# exec strides the program-header table by sizeof(struct proghdr)==28 while the
# ELF's e_phentsize is 32, so the *second* phdr is read 4 bytes misaligned — exec
# then parses the LOAD segment's file offset (0x74) as its vaddr, finds it not
# page-aligned, and rejects /init (=> "panic: init exiting"). Discard the
# attributes section at link time so each user program links to a single LOAD
# segment, exactly as the original riscv32-unknown-elf toolchain produced. The
# sed only touches the user-program link lines (`-Ttext 0 -o`); the kernel link
# uses -T kernel.ld and is left alone.
printf 'SECTIONS { /DISCARD/ : { *(.riscv.attributes) } }\nINSERT AFTER .text;\n' > user/discard-attrs.ld
sed -i 's|-Ttext 0 -o|-Ttext 0 -T $U/discard-attrs.ld -o|g' Makefile

TP="${TOOLPREFIX:-riscv64-unknown-elf-}"
make clean >/dev/null 2>&1 || true
make kernel/kernel fs.img TOOLPREFIX="$TP"
ls -la kernel/kernel fs.img
