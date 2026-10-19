/* RT-Thread Nano configuration for the bw-board emulated RISC-V SoC. */
#ifndef RTCONFIG_H__
#define RTCONFIG_H__

#define RT_THREAD_PRIORITY_MAX          32
#define RT_TICK_PER_SECOND              1000
#define RT_ALIGN_SIZE                   4
#define RT_NAME_MAX                     8
#define RT_USING_OVERFLOW_CHECK
#define RT_USING_HOOK
#define IDLE_THREAD_STACK_SIZE          256

/* kservice / console */
#define RT_USING_CONSOLE
#define RT_CONSOLEBUF_SIZE              256

/* dynamic heap (mem.c small-memory allocator, used as the system heap) */
#define RT_USING_HEAP
#define RT_USING_SMALL_MEM
#define RT_USING_SMALL_MEM_AS_HEAP

/* IPC — semaphore/mutex (thread blocking primitives) */
#define RT_USING_SEMAPHORE
#define RT_USING_MUTEX

/* soft timers off: rt_system_timer_thread_init becomes a no-op */
#define RT_USING_TIMER_SOFT             0

/* user main(): a "main" thread calls main() */
#define RT_USING_USER_MAIN
#define RT_MAIN_THREAD_STACK_SIZE       1024
#define RT_MAIN_THREAD_PRIORITY         10

#endif
