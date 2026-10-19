/* Freely authored, experimental CPU3 successful-quantum slice ABI. */
#ifndef BW_CPU3_NATIVE_DIRECT_BOARD_ABI_H
#define BW_CPU3_NATIVE_DIRECT_BOARD_ABI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bw_cpu3_combined_paging_ram_slice_reason {
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_BUDGET = 1,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_FAULT = 2,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_PORT = 3,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_HALT = 4,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_FAILURE = 5,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_IRQ_DELIVERED = 6,
  BW_CPU3_COMBINED_PAGING_RAM_SLICE_EVENT_DUE = 7
};

enum bw_cpu3_combined_paging_ram_kind {
  BW_CPU3_COMBINED_PAGING_RAM_RAM = 1,
  BW_CPU3_COMBINED_PAGING_RAM_ROM = 2,
  BW_CPU3_COMBINED_PAGING_RAM_MMIO = 3,
  BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED = 4
};

enum bw_cpu3_combined_paging_ram_effect {
  BW_CPU3_COMBINED_PAGING_RAM_RAM_READ = 1,
  BW_CPU3_COMBINED_PAGING_RAM_RAM_COMMIT = 2,
  BW_CPU3_COMBINED_PAGING_RAM_ROM_READ = 3,
  BW_CPU3_COMBINED_PAGING_RAM_ROM_IGNORED = 4,
  BW_CPU3_COMBINED_PAGING_RAM_MMIO_READ = 5,
  BW_CPU3_COMBINED_PAGING_RAM_MMIO_WRITE = 6,
  BW_CPU3_COMBINED_PAGING_RAM_OPEN_BUS = 7,
  BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED_IGNORED = 8
};

enum bw_cpu3_combined_paging_ram_work_kind {
  BW_CPU3_COMBINED_PAGING_RAM_ORDINARY = 0,
  BW_CPU3_COMBINED_PAGING_RAM_REP_ELEMENT = 1
};

typedef struct bw_cpu3_combined_paging_ram_byte_result {
  uint8_t kind;
  uint8_t effect;
} bw_cpu3_combined_paging_ram_byte_result;

typedef struct bw_cpu3_combined_paging_ram_host_callbacks {
  void *context;
  /* Raw addresses are supplied unchanged (fixed A20 ON); the host returns
     decoded address after actual board ROM-alias decode. A callback prevalidates the whole span before effects.
     Each byte gets an explicit decode kind and observed effect. */
  int (*read_physical)(void *, uint32_t, uint8_t *, uint32_t, uint32_t *,
                       bw_cpu3_combined_paging_ram_byte_result *);
  int (*write_physical)(void *, uint32_t, const uint8_t *, uint32_t, uint32_t *,
                        bw_cpu3_combined_paging_ram_byte_result *);
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
} bw_cpu3_combined_paging_ram_host_callbacks;

typedef struct bw_cpu3_combined_paging_ram_slice_result {
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
} bw_cpu3_combined_paging_ram_slice_result;

/* Native deadline is only an execution safety bound, not a PIT horizon.
   UINT64_MAX disables it. A due-now return performs no CPU work; the caller
   must consume or advance it before invoking resume again. */
int bw_cpu3_combined_paging_ram_resume(uint32_t max_native_ticks,
                   uint32_t max_successful_quanta, uint64_t native_deadline,
                   const bw_cpu3_combined_paging_ram_host_callbacks *callbacks,
                   bw_cpu3_combined_paging_ram_slice_result *result);
/* Line transitions are legal only between resume calls. The PIC supplies the
   vector at the eligible acknowledge callback, not at line assertion. */
int bw_cpu3_combined_paging_ram_set_irq_line(int asserted);
#ifdef __cplusplus
}
#endif
/* Direct calls use borrowed spans and persistent native execution buffers. */
#ifdef __cplusplus
extern "C" {
#endif
#define BW_DIRECT_ABI_VERSION 2
#define BW_DIRECT_ROM_BYTES 65536
#define BW_DIRECT_PAGE_BYTES 4096
enum bw_direct_scalar_operation { BW_DIRECT_TICK=1, BW_DIRECT_QUANTUM=2, BW_DIRECT_PIO_OUT=3, BW_DIRECT_ACK=4 };
typedef struct bw_direct_metadata { uint32_t decoded,kind,effect,generation,mapping_epoch,board_a20; } bw_direct_metadata;
typedef struct bw_direct_page_metadata { uint32_t decoded,kind,generation,mapping_epoch,board_a20; char sha256[65]; } bw_direct_page_metadata;
typedef struct bw_direct_callbacks {
 void *context;
 int (*memory)(void *,uint32_t raw,uint32_t length,const uint8_t *operand,uint8_t *observed,bw_direct_metadata *);
 int (*page)(void *,uint32_t raw,uint8_t *bytes,bw_direct_page_metadata *);
 int (*scalar)(void *,uint32_t operation,uint32_t arg0,uint32_t arg1,uint32_t arg2,uint32_t *value,uint32_t *a20,uint32_t *epoch);
} bw_direct_callbacks;
typedef struct bw_direct_snapshot {
 uint32_t state[20],extra[20],segments[6][15],system[2][15],debug[6];
 uint64_t native_ticks,successful_quanta;
 /* Direct snapshot v2: source-maintained counters, never host-derived. */
 uint64_t callback_counts[5],fallback_counts[5],execution_counts[8];
 uint32_t mapping_epoch,board_a20,active;
} bw_direct_snapshot;
/* Synchronous initializing-thread calls; one initialization lifetime/loaded image. */
int bw_direct_initialize(const char *configuration,const uint8_t *rom,uint32_t length,const bw_direct_callbacks *,int capture);
int bw_direct_resume(uint32_t max_native_ticks,uint32_t max_quanta,uint64_t deadline,bw_cpu3_combined_paging_ram_slice_result *);
int bw_direct_set_irq_line(int asserted);
int bw_direct_inspect(bw_direct_snapshot *);
int bw_direct_close(void);
#ifdef __cplusplus
}
#endif
#endif
