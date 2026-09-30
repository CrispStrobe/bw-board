/* Freely authored, experimental CPU3 host-device slice ABI. */
#ifndef BW_CPU3_NATIVE_DEVICE_EVENTS_ABI_H
#define BW_CPU3_NATIVE_DEVICE_EVENTS_ABI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bw_cpu3_device_events_slice_reason {
  BW_CPU3_DEVICE_EVENTS_SLICE_BUDGET = 1,
  BW_CPU3_DEVICE_EVENTS_SLICE_FAULT = 2,
  BW_CPU3_DEVICE_EVENTS_SLICE_PORT = 3,
  BW_CPU3_DEVICE_EVENTS_SLICE_HALT = 4,
  BW_CPU3_DEVICE_EVENTS_SLICE_FAILURE = 5,
  BW_CPU3_DEVICE_EVENTS_SLICE_IRQ_DELIVERED = 6,
  BW_CPU3_DEVICE_EVENTS_SLICE_EVENT_DUE = 7
};

enum bw_cpu3_device_events_kind {
  BW_CPU3_DEVICE_EVENTS_RAM = 1,
  BW_CPU3_DEVICE_EVENTS_ROM = 2,
  BW_CPU3_DEVICE_EVENTS_MMIO = 3,
  BW_CPU3_DEVICE_EVENTS_UNMAPPED = 4
};

enum bw_cpu3_device_events_effect {
  BW_CPU3_DEVICE_EVENTS_RAM_READ = 1,
  BW_CPU3_DEVICE_EVENTS_RAM_COMMIT = 2,
  BW_CPU3_DEVICE_EVENTS_ROM_READ = 3,
  BW_CPU3_DEVICE_EVENTS_ROM_IGNORED = 4,
  BW_CPU3_DEVICE_EVENTS_MMIO_READ = 5,
  BW_CPU3_DEVICE_EVENTS_MMIO_WRITE = 6,
  BW_CPU3_DEVICE_EVENTS_OPEN_BUS = 7,
  BW_CPU3_DEVICE_EVENTS_UNMAPPED_IGNORED = 8
};

typedef struct bw_cpu3_device_events_byte_result {
  uint8_t kind;
  uint8_t effect;
} bw_cpu3_device_events_byte_result;

typedef struct bw_cpu3_device_events_host_callbacks {
  void *context;
  /* raw/effective addresses are both supplied; the CPU wrapper applies the
     idempotent A20 gate. A callback prevalidates the whole span before effects.
     Each byte gets an explicit decode kind and observed effect. */
  int (*read_physical)(void *, uint32_t, uint32_t, uint8_t *, uint32_t,
                       bw_cpu3_device_events_byte_result *);
  int (*write_physical)(void *, uint32_t, uint32_t, const uint8_t *, uint32_t,
                        bw_cpu3_device_events_byte_result *);
  const uint8_t *(*execute_page)(void *, uint32_t, uint32_t, uint8_t *);
  int (*port_in)(void *, uint16_t, uint32_t, uint32_t *);
  int (*port_out)(void *, uint16_t, uint32_t, uint32_t);
  int (*tick)(void *, uint32_t);
  /* Called only from Bochs' eligible InterruptAcknowledge path. */
  int (*ack_irq)(void *, uint8_t *);
} bw_cpu3_device_events_host_callbacks;

typedef struct bw_cpu3_device_events_slice_result {
  uint32_t reason;
  uint32_t requested_ticks;
  uint32_t effective_ticks;
  uint32_t charged_ticks;
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
  uint32_t port_committed;
  uint32_t event_due;
  uint32_t pending_irq;
  uint32_t irq_delivered;
  uint32_t irq_vector;
  uint32_t if_flag;
  uint32_t activity_state;
  uint32_t pending_event;
} bw_cpu3_device_events_slice_result;

/* Deadline is an absolute native tick; UINT64_MAX means no pending event.
   A due-now return performs no CPU work. The caller must consume or advance
   that deadline before invoking resume again. */
int bw_cpu3_device_events_resume(uint32_t max_ticks, uint64_t next_event_tick,
                   const bw_cpu3_device_events_host_callbacks *callbacks,
                   bw_cpu3_device_events_slice_result *result);
/* Line transitions are legal only between resume calls. The PIC supplies the
   vector at the eligible acknowledge callback, not at line assertion. */
int bw_cpu3_device_events_set_irq_line(int asserted);
#ifdef __cplusplus
}
#endif
#endif
