/*
 * Board layer for RT-Thread Nano on the bw-board emulated RISC-V SoC
 * (RV32IMA + SiFive CLINT + NS16550 UART). RT-Thread's RISC-V port (libcpu +
 * e310/interrupt_gcc.S) supplies the context switch and trap_entry; the BSP must
 * supply the trap dispatch (handle_trap), the tick source (CLINT mtimecmp), the
 * console, and board init.
 */
#include <rthw.h>
#include <rtthread.h>

/* NS16550 UART at 0x10000000 (byte registers). */
#define UART_THR (*(volatile unsigned char *)0x10000000UL)
#define UART_LSR (*(volatile unsigned char *)0x10000005UL)
#define LSR_THRE 0x20

/* SiFive CLINT — mtime at 0x0200BFF8, mtimecmp at 0x02004000 (hart 0). */
#define MTIME_LO    (*(volatile rt_uint32_t *)0x0200BFF8UL)
#define MTIME_HI    (*(volatile rt_uint32_t *)0x0200BFFCUL)
#define MTIMECMP_LO (*(volatile rt_uint32_t *)0x02004000UL)
#define MTIMECMP_HI (*(volatile rt_uint32_t *)0x02004004UL)

/* The machine advances mtime by one per retired instruction, so a "second" is
 * 1,000,000 instructions; at 1000 ticks/s that is 1000 instructions per tick. */
#define TICKS_INCREMENT (1000000UL / RT_TICK_PER_SECOND)

extern void trap_entry(void);
extern char heap_start[], heap_end[];   /* from the linker script */

/* Schedule the next tick: read the 64-bit mtime, add the increment, write
 * mtimecmp high-first (the SiFive idiom that avoids a spurious compare match
 * mid-update). Writing mtimecmp also lowers the pending MTIP line. */
static void tick_reload(void)
{
    rt_uint64_t now  = ((rt_uint64_t)MTIME_HI << 32) | MTIME_LO;
    rt_uint64_t next = now + TICKS_INCREMENT;
    MTIMECMP_HI = 0xffffffffUL;
    MTIMECMP_LO = (rt_uint32_t)next;
    MTIMECMP_HI = (rt_uint32_t)(next >> 32);
}

/* Called by trap_entry (a0=mcause, a1=mepc, a2=stack). Only the machine timer
 * interrupt is expected; a synchronous exception is a fault we stop on. */
void handle_trap(rt_ubase_t mcause, rt_ubase_t mepc, rt_ubase_t *sp)
{
    (void)sp;
    if ((rt_base_t)mcause < 0)                    /* interrupt: high bit set */
    {
        if ((mcause & 0x7fffffffUL) == 7)         /* machine timer */
        {
            tick_reload();
            rt_tick_increase();
        }
    }
    else                                          /* synchronous exception */
    {
        rt_kprintf("\nEXC mcause=%p mepc=%p\n", (void *)mcause, (void *)mepc);
        while (1) { }
    }
}

/* rt_kprintf / rt_hw_console_output sink. */
void rt_hw_console_output(const char *str)
{
    while (*str)
    {
        if (*str == '\n')
        {
            while (!(UART_LSR & LSR_THRE)) { }
            UART_THR = '\r';
        }
        while (!(UART_LSR & LSR_THRE)) { }
        UART_THR = *str++;
    }
}

void rt_hw_board_init(void)
{
    /* install RT-Thread's trap handler (direct mode) */
    __asm volatile ("csrw mtvec, %0" :: "r"(trap_entry));
    /* arm the tick and enable the machine timer interrupt (mie.MTIE) */
    tick_reload();
    __asm volatile ("csrs mie, %0" :: "r"(1 << 7));
    /* the system heap lives between .bss and the startup stack */
    rt_system_heap_init((void *)heap_start, (void *)heap_end);
}

/* rt_hw_us_delay is referenced by the kernel's weak-less builds; a spin is fine
 * for this emulated demo (no wall-clock semantics). */
void rt_hw_us_delay(rt_uint32_t us)
{
    volatile rt_uint32_t n = us * 4;
    while (n--) { }
}
