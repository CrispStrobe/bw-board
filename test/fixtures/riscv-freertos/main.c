/*
 * A minimal but real FreeRTOS demo for the bw-board emulated RISC-V SoC
 * (RV32IMA + SiFive CLINT + NS16550 UART). It proves preemptive multitasking on
 * our machine, not just that the kernel links:
 *
 *   - "hi"  (priority 2) prints 'H', then vTaskDelay()s — which blocks and yields
 *     via ecall (the FreeRTOS RISC-V context switch). Five iterations, then it
 *     prints "\nDONE\n" and suspends itself.
 *   - "lo"  (priority 1) never blocks: it spins incrementing a counter and emits
 *     an 'L' every so often. It only runs while "hi" is blocked, and is preempted
 *     the instant "hi"'s delay expires (the CLINT timer tick makes "hi" ready and
 *     the scheduler switches to the higher priority task).
 *
 * So an interleaving of H and L that ends in DONE demonstrates: the scheduler
 * started, the timer tick (CLINT/MTIME) drives vTaskDelay, ecall-based yield
 * reaches the trap handler, and a higher-priority task preempts a running lower
 * one. The boot test asserts exactly that.
 */
#include "FreeRTOS.h"
#include "task.h"

/* NS16550 UART at 0x10000000 (byte registers): THR at +0, LSR at +5. */
#define UART_BASE 0x10000000UL
#define UART_THR  (*(volatile unsigned char *)(UART_BASE + 0))
#define UART_LSR  (*(volatile unsigned char *)(UART_BASE + 5))
#define LSR_THRE  0x20

static void uart_putc(char c)
{
    while ((UART_LSR & LSR_THRE) == 0) { /* wait for the transmitter */ }
    UART_THR = (unsigned char)c;
}

static void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

static volatile unsigned long lo_counter = 0;

static void vHiTask(void *pv)
{
    (void)pv;
    for (int i = 0; i < 5; i++)
    {
        uart_putc('H');
        vTaskDelay(pdMS_TO_TICKS(5));    /* blocks -> yields; woken by the tick  */
    }
    uart_puts("\nDONE\n");
    vTaskSuspend(NULL);                   /* stop cleanly; the run is now bounded */
    for (;;) { }
}

static void vLoTask(void *pv)
{
    (void)pv;
    for (;;)
    {
        lo_counter++;
        if ((lo_counter & 0x1ff) == 0) uart_putc('L');   /* proof it kept running */
    }
}

int main(void)
{
    uart_puts("BOOT\n");
    xTaskCreate(vLoTask, "lo", configMINIMAL_STACK_SIZE, NULL, 1, NULL);
    xTaskCreate(vHiTask, "hi", configMINIMAL_STACK_SIZE, NULL, 2, NULL);
    vTaskStartScheduler();
    for (;;) { }                          /* only reached if the scheduler failed */
    return 0;
}

/* FreeRTOS hooks the config below asks for. */
void vApplicationMallocFailedHook(void) { uart_puts("MALLOC-FAIL\n"); for (;;) { } }
void vApplicationStackOverflowHook(TaskHandle_t t, char *n) { (void)t; (void)n; uart_puts("STACK-OVF\n"); for (;;) { } }
