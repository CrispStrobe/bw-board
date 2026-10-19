/*
 * RT-Thread Nano demo: main() runs as the "main" thread (priority 10). It
 * spawns a lower-priority "wrk" thread (priority 12) and the two interleave via
 * the tick:
 *   - main prints 'H', then rt_thread_mdelay(5) — blocks five ticks,
 *   - wrk prints 'L' every tick while main is blocked,
 *   - when main's delay expires it PREEMPTS wrk (higher priority) and prints the
 *     next 'H'.
 * After five H's main prints DONE and returns (the main thread exits); wrk keeps
 * running. The interleaved H/L output is the proof of preemptive multitasking on
 * this machine — same shape as the FreeRTOS demo, a second independent RTOS.
 */
#include <rtthread.h>

static void wrk_entry(void *parameter)
{
    (void)parameter;
    for (;;)
    {
        rt_kprintf("L");
        rt_thread_mdelay(1);
    }
}

int main(void)
{
    rt_thread_t wrk = rt_thread_create("wrk", wrk_entry, RT_NULL, 512, 12, 10);
    if (wrk != RT_NULL) rt_thread_startup(wrk);

    for (int i = 0; i < 5; i++)
    {
        rt_kprintf("H");
        rt_thread_mdelay(5);
    }
    rt_kprintf("\nDONE\n");
    return 0;
}
