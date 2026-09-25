// LR/SC and AMO edge cases: SC without a reservation fails, SC clears the
// reservation, an intervening store to the reserved word (same hart), AMOs
// on every op with sign-edge operands, and misaligned LR/SC/AMO (which must
// trap — misaligned atomics are not covered by Zicclsm).
#include "common.h"
    .text
    .option norvc                            // handlers skip a trapping op with epc + 4
    .globl _start
_start:
    la t0, mtrap
    csrw mtvec, t0
    la s0, data
    li t1, 0x80000000
    sw t1, 0(s0)
    li t2, 0x7fffffff
    sw t2, 4(s0)
    // SC with no reservation: fails (rd = nonzero), memory untouched.
    li a0, 5
    sc.w a1, a0, (s0)
    lw a2, 0(s0)
    // LR / SC pair succeeds, then a second SC fails (reservation consumed).
    lr.w a3, (s0)
    addi a3, a3, 1
    sc.w a4, a3, (s0)
    sc.w a5, a3, (s0)
    lw a6, 0(s0)
    // LR, then an ordinary store elsewhere, SC to the reserved word.
    lr.w a3, (s0)
    sw zero, 8(s0)
    sc.w a4, a3, (s0)
    // LR to one word, SC to another: fails.
    lr.w a3, (s0)
    addi s1, s0, 4
    sc.w a4, a3, (s1)
    // Every AMO with signed/unsigned edge operands.
    li t3, -1
    amoadd.w a0, t3, (s0)
    amoswap.w a0, t2, (s0)
    amoxor.w a0, t1, (s0)
    amoand.w a0, t3, (s1)
    amoor.w a0, t1, (s1)
    amomin.w a0, t1, (s0)
    amomax.w a0, t2, (s0)
    amominu.w a0, t3, (s0)
    amomaxu.w a0, t3, (s1)
    amomin.w.aqrl a0, t3, (s1)
    // An AMO clears a reservation? (implementation choice; the oracle decides)
    lr.w a3, (s0)
    amoadd.w a0, zero, (s1)
    sc.w a4, a3, (s0)
    // Misaligned LR / SC / AMO: each traps; the handler skips it.
    addi s2, s0, 2
    lr.w a0, (s2)
    sc.w a0, a0, (s2)
    amoadd.w a0, a0, (s2)
    amoswap.w a0, a0, (s2)
    lw s3, 0(s0)
    lw s4, 4(s0)
    lw s5, 8(s0)
    HALT

mtrap:
    csrr t4, mcause
    csrr t5, mtval
    csrr t6, mepc
    addi t6, t6, 4
    csrw mepc, t6
    mret

    .data
    .align 4
data: .word 0, 0, 0, 0
