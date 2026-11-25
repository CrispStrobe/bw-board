/* SPDX-License-Identifier: MIT
 * Brickwright integration guest for the pinned, unmodified STC15lib headers.
 * P0/P2 publish a polled ADC result; P3.7 marks completion. ADRJ=0 only.
 */
#include <adc.h>

void main(void)
{
    uint16_t result;
    P3 = 0x02;
    pin_port_input_only_init(P1);
    pin_push_pull_init(P1, 0);
    P10 = 0;
    pin_open_drain_init(P3, 1);
    P31 = 1;
    adc_init_input_only(6, false, ADC_SPEED_90);
    adc_read_sync(&result);
    P0 = result & 0xff;
    P2 = result >> 8;
    P37 = 1;
    while (1) {}
}
