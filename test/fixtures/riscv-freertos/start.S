# Reset entry for the FreeRTOS demo on the bw-board RISC-V machine.
# The machine resets to pc=0, so _start is linked at 0x0. It sets up the global
# and stack pointers, zeroes .bss, then calls main(). FreeRTOS installs mtvec
# itself (in xPortStartScheduler), so this stub does not touch traps.
    .section .init, "ax"
    .global _start
    .align 2
_start:
    .option push
    .option norelax
    la      gp, __global_pointer$      # gp for the linker-relaxed .sdata accesses
    .option pop
    la      sp, __stack_top            # initial (pre-scheduler) stack

    # zero .bss  [__bss_start, __bss_end)
    la      t0, __bss_start
    la      t1, __bss_end
1:  bgeu    t0, t1, 2f
    sw      zero, 0(t0)
    addi    t0, t0, 4
    j       1b
2:
    # Install the FreeRTOS trap handler (direct mode). The GCC/RISC-V port does
    # NOT set mtvec itself — the application startup must, before the scheduler
    # takes its first timer tick.
    la      t0, freertos_risc_v_trap_handler
    csrw    mtvec, t0

    call    main
3:  wfi                                 # main should never return
    j       3b
