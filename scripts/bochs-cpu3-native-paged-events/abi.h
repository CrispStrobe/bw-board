/* Freely authored, experimental CPU3 paged-event slice ABI. */
#ifndef BW_CPU3_NATIVE_PAGED_EVENTS_ABI_H
#define BW_CPU3_NATIVE_PAGED_EVENTS_ABI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bw_cpu3_paged_events_slice_reason {
  BW_CPU3_PAGED_EVENTS_SLICE_BUDGET = 1,
  BW_CPU3_PAGED_EVENTS_SLICE_FAULT = 2,
  BW_CPU3_PAGED_EVENTS_SLICE_PORT = 3,
  BW_CPU3_PAGED_EVENTS_SLICE_HALT = 4,
  BW_CPU3_PAGED_EVENTS_SLICE_FAILURE = 5,
  BW_CPU3_PAGED_EVENTS_SLICE_IRQ_DELIVERED = 6,
  BW_CPU3_PAGED_EVENTS_SLICE_EVENT_DUE = 7
};

typedef struct bw_cpu3_paged_events_host_callbacks {
  void *context;
  int (*read_physical)(void *, uint32_t, uint8_t *, uint32_t);
  int (*write_physical)(void *, uint32_t, const uint8_t *, uint32_t);
  const uint8_t *(*execute_page)(void *, uint32_t);
  int (*port_in)(void *, uint16_t, uint32_t, uint32_t *);
  int (*port_out)(void *, uint16_t, uint32_t, uint32_t);
  int (*tick)(void *, uint32_t);
  /* Called only from Bochs' eligible InterruptAcknowledge path. */
  int (*ack_irq)(void *, uint8_t *);
} bw_cpu3_paged_events_host_callbacks;

typedef struct bw_cpu3_paged_events_slice_result {
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
} bw_cpu3_paged_events_slice_result;

/* Deadline is an absolute native tick; UINT64_MAX means no pending event.
   A due-now return performs no CPU work. The caller must consume or advance
   that deadline before invoking resume again. */
int bw_cpu3_paged_events_resume(uint32_t max_ticks, uint64_t next_event_tick,
                   const bw_cpu3_paged_events_host_callbacks *callbacks,
                   bw_cpu3_paged_events_slice_result *result);
/* Host ownership starts only after the post-BIOS activation handoff. */
int bw_cpu3_paged_events_set_irq_line(int asserted, uint8_t vector);

#ifdef __cplusplus
}
#endif
#endif
