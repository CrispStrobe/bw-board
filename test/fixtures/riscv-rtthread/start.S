# Reset entry for the RT-Thread Nano demo on the bw-board RISC-V machine.
# The machine resets to pc=0, so _start is linked first. It sets gp/sp, zeroes
# .bss, then calls RT-Thread's entry() (which runs rtthread_startup()). mtvec is
# installed later by rt_hw_board_init(); RT-Thread's own trap_entry is the handler.
    .section .init, "ax"
    .global _start
    .align 2
_start:
    .option push
    .option norelax
    la      gp, __global_pointer$
    .option pop
    la      sp, _sp                    # startup / ISR stack

    la      t0, __bss_start
    la      t1, __bss_end
1:  bgeu    t0, t1, 2f
    sw      zero, 0(t0)
    addi    t0, t0, 4
    j       1b
2:
    call    entry                      # RT-Thread entry() -> rtthread_startup()
3:  wfi
    j       3b
