// M/S/U privilege, trap delegation and returns:
//  - medeleg delegates U-ecall, illegal-instruction and breakpoint to S;
//    mideleg delegates the supervisor software interrupt.
//  - M drops to S (mret, MPP=S), S drops to U (sret, SPP=U).
//  - U: ecall (to S), an illegal CSR access (to S), ebreak (to S), and a
//    csrr of mstatus (illegal from U).
//  - S: sets sip.SSIP with sstatus.SIE=0 (pending, not taken), then enables
//    SIE — the interrupt is taken at once; handler clears it.
//  - S: ecall goes to M (not delegated; cause 9); M returns with mret.
//  - M sets mip.STIP itself (firmware-forwarded timer) → delegated to S.
//  - Vectored stvec: interrupts land at base + 4*cause.
//  - sret with mstatus.TSR set traps to M as illegal.
#include "common.h"
    .text
    .option norvc                            // handlers skip a trapping op with epc + 4
    .globl _start
_start:
    la t0, mtrap
    csrw mtvec, t0
    li t0, (1 << 8) | (1 << 2) | (1 << 3)     // U-ecall, illegal, breakpoint → S
    csrw medeleg, t0
    li t0, (1 << 1) | (1 << 5)               // SSI, STI → S
    csrw mideleg, t0
    la t0, stvec_base
    ori t0, t0, 1                            // vectored
    csrw stvec, t0
    li t0, (1 << 1) | (1 << 5)
    csrw mie, t0                             // enable SSIE, STIE
    // mret into S
    li t0, 3 << 11
    csrc mstatus, t0
    li t0, 1 << 11
    csrs mstatus, t0
    la t0, s_entry
    csrw mepc, t0
    mret

s_entry:
    li s1, 0                                 // count of S traps taken
    // sret into U
    li t0, 1 << 8
    csrc sstatus, t0                         // SPP = U
    la t0, u_entry
    csrw sepc, t0
    sret

u_entry:
    li a7, 1
    ecall                                    // → S (delegated)
    csrr a0, mstatus                         // illegal in U → S
    csrr a0, sstatus                         // illegal in U → S
    ebreak                                   // → S (delegated)
    csrr a1, cycle                           // counter not enabled for U → S (illegal)
    li a7, 2
    ecall                                    // → S: returns to S mode for the rest
u_after:
    j u_after                                // not reached

// Vectored stvec: exceptions at base, interrupt n at base + 4*n.
    .align 6
    .option push
    .option norvc                            // vector slots are exactly 4 bytes
stvec_base:
    j s_exc
    j s_ssi
    .word 0, 0, 0
    j s_sti
    .option pop

s_exc:
    addi s1, s1, 1
    csrr t0, scause
    csrr t1, stval
    csrr t2, sepc
    li t3, 8
    bne t0, t3, 1f
    li t3, 2
    beq a7, t3, s_phase2                     // second U ecall: continue in S
1:  addi t2, t2, 4
    csrw sepc, t2
    sret

s_ssi:
    csrr t0, scause
    li t1, 1 << 1
    csrc sip, t1                             // acknowledge
    addi s2, s2, 1
    sret

s_sti:
    csrr t0, scause
    addi s3, s3, 1
    li a7, 0x54494D45                        // ask M to clear STIP
    li a6, 99
    ecall
    sret

s_phase2:
    // In S now, SPP = U from the trap; stay in S.
    csrci sstatus, 2                         // SIE = 0
    li t0, 1 << 1
    csrs sip, t0                             // SSIP pending, masked
    nop
    nop
    csrsi sstatus, 2                         // SIE = 1 → taken now
    nop
    // S ecall → M (cause 9): M raises STIP for S, returns.
    li a7, 7
    ecall
    nop                                      // STIP delegated → taken here (SIE=1)
    nop
    // TSR: M sets it on the next ecall; then sret is illegal (to M).
    li a7, 8
    ecall
    la t0, s_done
    csrw sepc, t0
    sret                                     // illegal (TSR) → M, which finishes
s_done:
    j s_done

mtrap:
    csrr t0, mcause
    csrr t1, mepc
    li t2, 9
    bne t0, t2, m_other
    li t2, 7
    beq a7, t2, m_raise_sti
    li t2, 8
    beq a7, t2, m_set_tsr
    // 0x54494D45: clear STIP
    li t2, 1 << 5
    csrc mip, t2
    j m_ret
m_raise_sti:
    li t2, 1 << 5
    csrs mip, t2
    j m_ret
m_set_tsr:
    li t2, 1 << 22
    csrs mstatus, t2
    li t2, 1 << 2
    csrc medeleg, t2                         // the TSR-illegal sret must reach M
m_ret:
    addi t1, t1, 4
    csrw mepc, t1
    mret
m_other:
    csrr s4, mcause
    csrr s5, mtval
    csrr s6, mstatus
    HALT
