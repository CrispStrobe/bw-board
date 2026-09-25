// Sv32 walks and page faults, from S and U mode:
//  - a 4 MiB superpage (identity over the image), 4 KiB pages under a
//    second-level table, and a misaligned superpage (PPN[0] != 0) → fault;
//  - S touching a U page without / with sstatus.SUM; S fetching a U page;
//  - an execute-only page: load faults, then loads with sstatus.MXR;
//  - a read-only page: store faults; an invalid PTE; W-without-R (reserved);
//  - A/D: with menvcfg.ADUE clear a clear A (or D on a store) faults
//    (Svade); set, the walk updates the PTE (Svadu) — the PTE is read back;
//  - U mode: runs from a U code page, loads its U data page, faults on a
//    supervisor page, then ecalls out.
// Page faults are not delegated: M's handler records mcause/mtval, and
// resumes at the address in s11 (set before each faulting access).
#include "common.h"
#define V 1
#define R 2
#define W 4
#define X 8
#define U 0x10
#define A 0x40
#define D 0x80
#define PTE(pa, fl) ((((pa) >> 12) << 10) | (fl))

    .text
    .globl _start
_start:
    la t0, mtrap
    csrw mtvec, t0
    // root[0x200] = superpage identity at 0x80000000 (RWX, A, D)
    la s0, pt_root
    li t0, PTE(0x80000000, V|R|W|X|A|D)
    li t1, 0x200 * 4
    add t1, s0, t1
    sw t0, 0(t1)
    // root[0x001] = misaligned superpage (PPN[0] = 1)
    li t0, (1 << 10) | V|R|W|A|D
    sw t0, 4(s0)
    // root[0x100] → pt_l0
    la s1, pt_l0
    srli t0, s1, 12
    slli t0, t0, 10
    ori t0, t0, V
    li t1, 0x100 * 4
    add t1, s0, t1
    sw t0, 0(t1)
    // pt_l0[0] = U data page, RW, A=1 D=0 (A set, so the SUM checks below
    // are the only reason an S load of it can fault)
    la t2, pg_u
    srli t0, t2, 12
    slli t0, t0, 10
    ori t0, t0, V|R|W|U|A
    sw t0, 0(s1)
    // pt_l0[1] = supervisor execute-only page (over pg_u too), A
    ori t0, t0, 0
    srli t0, t2, 12
    slli t0, t0, 10
    ori t0, t0, V|X|A
    sw t0, 4(s1)
    // pt_l0[2] = invalid; pt_l0[3] = U code page (R X U A)
    sw zero, 8(s1)
    la t2, ucode
    srli t0, t2, 12
    slli t0, t0, 10
    ori t0, t0, V|R|X|U|A
    sw t0, 12(s1)
    // pt_l0[4] = read-only supervisor page, A D; pt_l0[5] = W without R
    la t2, pg_u
    srli t0, t2, 12
    slli t0, t0, 10
    ori t3, t0, V|R|A|D
    sw t3, 16(s1)
    ori t3, t0, V|W|A|D
    sw t3, 20(s1)
    // satp = Sv32 | root PPN
    srli t0, s0, 12
    li t1, 1 << 31
    or t0, t0, t1
    csrw satp, t0
    sfence.vma
    // mret to S
    li t0, 3 << 11
    csrc mstatus, t0
    li t0, 1 << 11
    csrs mstatus, t0
    la t0, s_code
    csrw mepc, t0
    mret

s_code:
    li s2, 0x40000000
    // S load of a U page, SUM=0 → load page fault
    la s11, 1f
    lw a0, 0(s2)
1:  li t0, 1 << 18
    csrs sstatus, t0                 // SUM = 1
    lw a0, 0(s2)                     // now allowed
    // D clear, ADUE clear (Svade) → store page fault
    li t0, 0x5a5a
    la s11, 1f
    sw t0, 0(s2)
1:  ecall                            // M sets menvcfgh.ADUE (a7 unused)
    sw t0, 0(s2)                     // Svadu: the walk sets D
    lw a1, 0(s1)                     // read back the PTE (through the identity superpage)
    // S fetch of a U page, even with SUM → instruction page fault
    li t0, 0x40003000
    la s11, 1f
    jalr t0
1:  // execute-only page: load faults, then MXR
    li s3, 0x40001000
    la s11, 1f
    lw a2, 0(s3)
1:  li t0, 1 << 19
    csrs sstatus, t0
    lw a2, 0(s3)
    // store to read-only page → store fault; W-without-R → fault
    li s4, 0x40004000
    la s11, 1f
    sw a2, 0(s4)
1:  li s5, 0x40005000
    la s11, 1f
    lw a3, 0(s5)
1:  // invalid PTE, misaligned superpage
    li s6, 0x40002000
    la s11, 1f
    lw a3, 0(s6)
1:  li s7, 0x00400000
    la s11, 1f
    lw a3, 0(s7)
1:  // byte/half accesses through a page, and a store to a page A/D set
    lb a4, 3(s2)
    lhu a5, 2(s2)
    sh a5, 6(s2)
    // → U mode at the U code page
    li t0, 1 << 8
    csrc sstatus, t0
    li t0, 0x40003000
    csrw sepc, t0
    sret

mtrap:
    csrr t0, mcause
    li t1, 9
    beq t0, t1, m_ecall_s
    li t1, 8
    beq t0, t1, m_done               // U ecall: finished
    csrr s8, mtval
    add s9, s9, t0                    // running checksum of causes
    csrw mepc, s11
    mret
m_ecall_s:
    li t1, 1 << 29
    csrs 0x31a, t1                    // menvcfgh.ADUE
    csrr t1, mepc
    addi t1, t1, 4
    csrw mepc, t1
    mret
m_done:
    HALT

    .section .text.ucode,"ax",@progbits
    .align 12
ucode:
    li t0, 0x40000000
    lw a0, 0(t0)                     // U page: fine
    sw a0, 4(t0)
    la s11, ucode_resume
    la t2, ucode
    sub s11, s11, t2
    li t2, 0x40003000
    add s11, s11, t2
    li t1, 0x80000000
    lw a1, 0(t1)                     // supervisor page from U → load fault
ucode_resume:
    ecall

    .data
    .align 12
pt_root: .skip 4096
pt_l0:   .skip 4096
pg_u:    .word 0x11223344, 0x55667788
         .skip 4088
