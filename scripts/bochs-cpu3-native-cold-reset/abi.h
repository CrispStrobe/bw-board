/* Freely authored, experimental CPU3 successful-quantum slice ABI. */
#ifndef BW_CPU3_NATIVE_COLD_RESET_ABI_H
#define BW_CPU3_NATIVE_COLD_RESET_ABI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bw_cpu3_cold_reset_slice_reason {
  BW_CPU3_COLD_RESET_SLICE_BUDGET = 1,
  BW_CPU3_COLD_RESET_SLICE_FAULT = 2,
  BW_CPU3_COLD_RESET_SLICE_PORT = 3,
  BW_CPU3_COLD_RESET_SLICE_HALT = 4,
  BW_CPU3_COLD_RESET_SLICE_FAILURE = 5,
  BW_CPU3_COLD_RESET_SLICE_IRQ_DELIVERED = 6,
  BW_CPU3_COLD_RESET_SLICE_EVENT_DUE = 7
};

enum bw_cpu3_cold_reset_kind {
  BW_CPU3_COLD_RESET_RAM = 1,
  BW_CPU3_COLD_RESET_ROM = 2,
  BW_CPU3_COLD_RESET_MMIO = 3,
  BW_CPU3_COLD_RESET_UNMAPPED = 4
};

enum bw_cpu3_cold_reset_effect {
  BW_CPU3_COLD_RESET_RAM_READ = 1,
  BW_CPU3_COLD_RESET_RAM_COMMIT = 2,
  BW_CPU3_COLD_RESET_ROM_READ = 3,
  BW_CPU3_COLD_RESET_ROM_IGNORED = 4,
  BW_CPU3_COLD_RESET_MMIO_READ = 5,
  BW_CPU3_COLD_RESET_MMIO_WRITE = 6,
  BW_CPU3_COLD_RESET_OPEN_BUS = 7,
  BW_CPU3_COLD_RESET_UNMAPPED_IGNORED = 8
};

enum bw_cpu3_cold_reset_work_kind {
  BW_CPU3_COLD_RESET_ORDINARY = 0,
  BW_CPU3_COLD_RESET_REP_ELEMENT = 1
};

typedef struct bw_cpu3_cold_reset_byte_result {
  uint8_t kind;
  uint8_t effect;
} bw_cpu3_cold_reset_byte_result;

typedef struct bw_cpu3_cold_reset_host_callbacks {
  void *context;
  /* Raw addresses are supplied unchanged (fixed A20 ON); the host returns
     decoded address after actual board ROM-alias decode. A callback prevalidates the whole span before effects.
     Each byte gets an explicit decode kind and observed effect. */
  int (*read_physical)(void *, uint32_t, uint8_t *, uint32_t, uint32_t *,
                       bw_cpu3_cold_reset_byte_result *);
  int (*write_physical)(void *, uint32_t, const uint8_t *, uint32_t, uint32_t *,
                        bw_cpu3_cold_reset_byte_result *);
  const uint8_t *(*execute_page)(void *, uint32_t, uint32_t *, uint8_t *);
  int (*port_in)(void *, uint16_t, uint32_t, uint32_t *);
  int (*port_out)(void *, uint16_t, uint32_t, uint32_t);
  /* Native Bochs tick is an execution-ledger event, never a PIT clock. */
  int (*native_tick)(void *, uint32_t);
  /* One completed ordinary instruction (kind 0, including zero-count REP) or
     one completed REP element (kind 1). The
     host advances six functional board clocks and reports an actual device
     transition. It may not mutate the CPU's IRQ line during this callback. */
  int (*successful_quantum)(void *, uint32_t, uint32_t *);
  /* Called only from Bochs' eligible InterruptAcknowledge path. */
  int (*ack_irq)(void *, uint8_t *);
} bw_cpu3_cold_reset_host_callbacks;

typedef struct bw_cpu3_cold_reset_slice_result {
  uint32_t reason;
  uint32_t requested_native_ticks;
  uint32_t effective_native_ticks;
  uint32_t charged_native_ticks;
  uint32_t requested_quanta;
  uint32_t charged_quanta;
  uint64_t total_native_ticks;
  uint64_t total_successful_quanta;
  uint64_t attempts;
  uint64_t completed;
  uint64_t rep_iterations;
  uint64_t rep_partial;
  uint64_t faults;
  uint64_t port_commits;
  uint64_t irq_deliveries;
  uint64_t halt_idle_cuts;
  uint16_t cs;
  uint32_t eip;
  uint32_t pending_fault;
  uint32_t fault_vector;
  uint32_t fault_error;
  uint32_t fault_cr2;
  uint32_t port_committed;
  uint32_t event_due;
  uint32_t pending_irq;
  uint32_t irq_delivered;
  uint32_t irq_vector;
  uint32_t if_flag;
  uint32_t activity_state;
  uint32_t pending_event;
} bw_cpu3_cold_reset_slice_result;

/* Native deadline is only an execution safety bound, not a PIT horizon.
   UINT64_MAX disables it. A due-now return performs no CPU work; the caller
   must consume or advance it before invoking resume again. */
int bw_cpu3_cold_reset_resume(uint32_t max_native_ticks,
                   uint32_t max_successful_quanta, uint64_t native_deadline,
                   const bw_cpu3_cold_reset_host_callbacks *callbacks,
                   bw_cpu3_cold_reset_slice_result *result);
/* Line transitions are legal only between resume calls. The PIC supplies the
   vector at the eligible acknowledge callback, not at line assertion. */
int bw_cpu3_cold_reset_set_irq_line(int asserted);
#ifdef __cplusplus
}
#endif
#endif
