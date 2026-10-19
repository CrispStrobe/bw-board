/* SPDX-License-Identifier: MIT
 * Active Cortex-M0 workload, no WFI or delay-loop fast forwarding.
 * RAM-only and GPIO variants share arithmetic and RAM receipt writes.
 */
.syntax unified
.cpu cortex-m0
.thumb
.section .vectors,"a",%progbits
.word 0x20001000
.word reset
.section .text,"ax",%progbits
.global reset
.thumb_func
reset:
    ldr r4, =0x20000000
    movs r0, #0
    str r0, [r4, #0]
    str r0, [r4, #4]
    str r0, [r4, #8]
    str r0, [r4, #12]
    movs r3, #255
#ifdef BW_F0_GPIO
    ldr r5, =0x48000000
    ldr r6, =0x40021014
    ldr r2, =0x00020000
    str r2, [r6]             /* RCC GPIOA enable */
    movs r2, #1
    str r2, [r5]             /* PA0 output, PA1 input */
#endif
loop:
    ldr r0, [r4, #0]
    adds r0, #1
    str r0, [r4, #0]
    mov r2, r0
    eors r2, r3
    str r2, [r4, #4]
#ifdef BW_F0_GPIO
    ldr r1, [r5, #16]        /* GPIO IDR: actual held PA1 */
    movs r2, #2
    ands r1, r2
    str r1, [r4, #8]
    cmp r1, #0
    beq clear
    movs r2, #1
    b write
clear:
    ldr r2, =0x00010000
write:
    str r2, [r5, #24]        /* BSRR drives PA0 */
#endif
    ldr r1, [r4, #4]
    eors r1, r3
    str r1, [r4, #12]
    b loop
.ltorg
