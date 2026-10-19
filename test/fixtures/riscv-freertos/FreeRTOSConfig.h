/*
 * FreeRTOS configuration for the bw-board emulated RISC-V SoC.
 *
 * The machine advances the CLINT `mtime` by one per retired instruction, so the
 * "clock" is measured in instructions. configCPU_CLOCK_HZ / configTICK_RATE_HZ =
 * 1000000 / 1000 = 1000 instructions per tick — frequent enough that vTaskDelay
 * resolves quickly in a bounded run, but coarse enough that the tick ISR does not
 * dominate, so a lower-priority task gets real cycles between ticks (visible as
 * interleaved output).
 *
 * The CLINT sits at the SiFive/QEMU-virt layout the machine wires by default:
 *   mtime    at 0x0200BFF8
 *   mtimecmp at 0x02004000
 */
#ifndef FREERTOS_CONFIG_H
#define FREERTOS_CONFIG_H

#define configUSE_PREEMPTION                    1
#define configUSE_IDLE_HOOK                      0
#define configUSE_TICK_HOOK                      0
#define configCPU_CLOCK_HZ                       1000000
#define configTICK_RATE_HZ                       1000
#define configMAX_PRIORITIES                     5
#define configMINIMAL_STACK_SIZE                 160          /* words */
#define configTOTAL_HEAP_SIZE                    (48 * 1024)
#define configMAX_TASK_NAME_LEN                  12
#define configUSE_16_BIT_TICKS                   0
#define configIDLE_SHOULD_YIELD                  1
#define configUSE_MUTEXES                        0
#define configUSE_RECURSIVE_MUTEXES             0
#define configUSE_COUNTING_SEMAPHORES            0
#define configUSE_TASK_NOTIFICATIONS             1
#define configUSE_TIMERS                         0
#define configUSE_CO_ROUTINES                    0
#define configSUPPORT_STATIC_ALLOCATION          0
#define configSUPPORT_DYNAMIC_ALLOCATION         1
#define configCHECK_FOR_STACK_OVERFLOW           2
#define configUSE_MALLOC_FAILED_HOOK             1
#define configQUEUE_REGISTRY_SIZE                0
#define configUSE_PORT_OPTIMISED_TASK_SELECTION  0

/* The SiFive CLINT the machine maps by default. */
#define configMTIME_BASE_ADDRESS                 0x0200BFF8UL
#define configMTIMECMP_BASE_ADDRESS              0x02004000UL

/* A dedicated interrupt stack (so the port does not borrow a task stack). */
#define configISR_STACK_SIZE_WORDS               512

/* Assertion: spin so a failure shows up as a hang (no DONE) rather than silence. */
#define configASSERT( x )   if( ( x ) == 0 ) { for( ;; ) { } }

/* Only the API this demo (and the kernel it links) actually calls. */
#define INCLUDE_vTaskPrioritySet                 0
#define INCLUDE_uxTaskPriorityGet                0
#define INCLUDE_vTaskDelete                      1
#define INCLUDE_vTaskSuspend                     1
#define INCLUDE_vTaskDelayUntil                  0
#define INCLUDE_vTaskDelay                       1
#define INCLUDE_xTaskGetSchedulerState           1
#define INCLUDE_xTaskGetCurrentTaskHandle        1

#endif /* FREERTOS_CONFIG_H */
