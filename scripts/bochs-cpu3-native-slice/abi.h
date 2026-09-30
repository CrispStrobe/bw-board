/* Freely authored, experimental CPU3 functional slice ABI. */
#ifndef BW_CPU3_NATIVE_SLICE_ABI_H
#define BW_CPU3_NATIVE_SLICE_ABI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bw_cpu3_slice_reason {
  BW_CPU3_SLICE_BUDGET = 1,
  BW_CPU3_SLICE_FAULT = 2,
  BW_CPU3_SLICE_PORT = 3,
  BW_CPU3_SLICE_HALT = 4,
  BW_CPU3_SLICE_FAILURE = 5
};

typedef struct bw_cpu3_host_callbacks {
  void *context;
  int (*read_physical)(void *, uint32_t, uint8_t *, uint32_t);
  int (*write_physical)(void *, uint32_t, const uint8_t *, uint32_t);
  const uint8_t *(*execute_page)(void *, uint32_t);
  int (*port_in)(void *, uint16_t, uint32_t, uint32_t *);
  int (*port_out)(void *, uint16_t, uint32_t, uint32_t);
  int (*tick)(void *, uint32_t);
} bw_cpu3_host_callbacks;

typedef struct bw_cpu3_slice_result {
  uint32_t reason;
  uint32_t requested_ticks;
  uint32_t charged_ticks;
  uint64_t attempts;
  uint64_t completed;
  uint64_t rep_iterations;
  uint64_t rep_partial;
  uint64_t faults;
  uint64_t port_commits;
  uint16_t cs;
  uint32_t eip;
  uint32_t pending_fault;
  uint32_t port_committed;
} bw_cpu3_slice_result;

/* A caller may invoke this repeatedly after the owned post-BIOS activation. */
int bw_cpu3_resume(uint32_t max_ticks,
                   const bw_cpu3_host_callbacks *callbacks,
                   bw_cpu3_slice_result *result);

#ifdef __cplusplus
}
#endif
#endif
