# M-mode reset entry for the S-mode demo. Linked at 0x80000000 (the machine's
# RAM base for supervisor images). Sets gp/sp, zeroes .bss (the page table lives
# there), then calls m_main, which sets up paging and drops to S-mode.
    .section .init, "ax"
    .global _start
    .align 2
_start:
    .option push
    .option norelax
    la      gp, __global_pointer$
    .option pop
    la      sp, __stack_top
    la      t0, __bss_start
    la      t1, __bss_end
1:  bgeu    t0, t1, 2f
    sw      zero, 0(t0)
    addi    t0, t0, 4
    j       1b
2:
    call    m_main
3:  wfi
    j       3b
