/* F030 clock bring-up exactly as generated programs run it (RM0360 6.2.3),
 * then a PA0 toggle. RAM receipt at 0x20000000: stage, toggles.
 * Original MIT test guest for bw-board. */
    .syntax unified
    .cpu cortex-m0
    .thumb
    .section .vectors, "a"
    .word 0x20002000
    .word reset + 1
    .text
    .thumb_func
reset:
    ldr r7, =0x20000000
    movs r0, #1
    str r0, [r7]              /* stage 1: running */
    ldr r1, =0x40022000       /* FLASH_ACR = LATENCY 1 | PRFTBE */
    movs r0, #0x11
    str r0, [r1]
    ldr r1, =0x40021000       /* RCC base */
    ldr r0, [r1, #4]          /* CFGR: PLLSRC = HSI/2, PLLMUL x12 */
    ldr r2, =0x003D0000
    bics r0, r2
    ldr r2, =0x00280000
    orrs r0, r2
    str r0, [r1, #4]
    ldr r0, [r1]              /* CR |= PLLON */
    ldr r2, =0x01000000
    orrs r0, r2
    str r0, [r1]
    movs r0, #2
    str r0, [r7]              /* stage 2: waiting for PLLRDY */
    ldr r2, =0x02000000
1:  ldr r0, [r1]
    tst r0, r2
    beq 1b
    ldr r0, [r1, #4]          /* SW = PLL */
    movs r2, #3
    bics r0, r2
    movs r2, #2
    orrs r0, r2
    str r0, [r1, #4]
    movs r0, #3
    str r0, [r7]              /* stage 3: waiting for SWS = PLL */
2:  ldr r0, [r1, #4]
    lsrs r0, r0, #2
    movs r2, #3
    ands r0, r2
    cmp r0, #2
    bne 2b
    ldr r0, [r1, #0x14]       /* AHBENR |= IOPAEN */
    ldr r2, =0x00020000
    orrs r0, r2
    str r0, [r1, #0x14]
    ldr r3, =0x48000000       /* GPIOA MODER: PA0 output */
    ldr r0, [r3]
    movs r2, #3
    bics r0, r2
    movs r2, #1
    orrs r0, r2
    str r0, [r3]
    movs r0, #4
    str r0, [r7]              /* stage 4: clock up, toggling */
    movs r4, #0
3:  ldr r0, [r3, #0x14]       /* ODR ^= 1 */
    movs r2, #1
    eors r0, r2
    str r0, [r3, #0x14]
    adds r4, r4, #1
    str r4, [r7, #4]
    b 3b
    .ltorg
