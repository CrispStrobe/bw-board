/* SPDX-License-Identifier: MIT
 * A pin edge per Timer0 interrupt. Direct preload gives a 1024-count period;
 * it intentionally avoids STC15lib's ticks-to-preload convention.
 */
#include <gpio.h>
#include <timer0_mode0.h>

void timer0_isr(void) __interrupt(1)
{
    P10 = !P10;
    ++P2;
}

void main(void)
{
    P2 = 0;
    P10 = 0;
    pin_push_pull_init(P1, 0);
#ifdef TIMER_12T
    timer0_mode0_12T_init();
#else
    timer0_mode0_1T_init();
#endif
    timer0_mode0_direct_start(0xfc, 0x00);
    while (1) {}
}
