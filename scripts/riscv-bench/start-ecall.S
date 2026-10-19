// User-level entry for the ecall variant of the RISC-V benchmarks: the same
// register set-up as riscv-tests' benchmarks/common/crt.S (gp, tp = _end
// aligned, a 128 KiB stack above it, then _init(0, 1)) but with no CSR
// access, so a user-mode emulator (rv32emu) and our machine both run it.
    .section .text.init, "ax", @progbits
    .globl _start
_start:
.option push
.option norelax
    la gp, __global_pointer$
.option pop
    la tp, _end
    addi tp, tp, 63
    andi tp, tp, -64
    li sp, 1 << 17
    add sp, sp, tp
    li a0, 0
    li a1, 1
    j _init
