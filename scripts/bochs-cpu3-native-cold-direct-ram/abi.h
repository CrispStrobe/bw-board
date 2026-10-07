/* Experimental cold CPU3 direct-RAM profile. Actual guest qualification pending. */
#ifndef BW_CPU3_COLD_DIRECT_RAM_ABI_H
#define BW_CPU3_COLD_DIRECT_RAM_ABI_H
#include <stdint.h>

#define BW_COLD_DIRECT_RAM_ABI_VERSION 5u
#define BW_COLD_DIRECT_RAM_PROFILE "bw.cpu3.cold.direct-ram-rom-exec.v1"
/* The same DSO compiles this exact merged companion core; no second addon owns RAM. */
#define BW_COLD_DIRECT_RAM_CORE_SHA256 "27f4b7bafd79b0084d86a5bc59cb1a2526e26154b6d8b2bd4d75df90fa8ebe04"
#define BW_COLD_DIRECT_RAM_RAM_BYTES 0x180000u
#define BW_COLD_DIRECT_RAM_BOARD_BYTES 0x1000000u
#define BW_COLD_DIRECT_RAM_ROM_BYTES 0x10000u
#define BW_COLD_DIRECT_RAM_JOURNAL_CAPACITY 32u

enum bw_cold_direct_ram_status {
  BW_COLD_DIRECT_RAM_ACCEPTED = 1,
  BW_COLD_DIRECT_RAM_PRE_EFFECT_RETRY = 2,
  BW_COLD_DIRECT_RAM_POST_EFFECT_CODE_FENCE = 3
};
enum bw_cold_direct_ram_phase {
  BW_COLD_DIRECT_RAM_RUNNING = 1,
  BW_COLD_DIRECT_RAM_PAUSED = 2
};
enum bw_cold_direct_ram_boundary_kind {
  BW_COLD_DIRECT_RAM_INIT = 1,
  BW_COLD_DIRECT_RAM_ENTRY = 2,
  BW_COLD_DIRECT_RAM_MEMORY = 3,
  BW_COLD_DIRECT_RAM_PAGE = 4,
  BW_COLD_DIRECT_RAM_PRE_PIO = 5,
  BW_COLD_DIRECT_RAM_POST_PIO = 6,
  BW_COLD_DIRECT_RAM_PIC_ACK_FORBIDDEN = 7,
  BW_COLD_DIRECT_RAM_FAULT = 8,
  BW_COLD_DIRECT_RAM_IRQ = 9,
  BW_COLD_DIRECT_RAM_HLT = 10,
  BW_COLD_DIRECT_RAM_RETURN = 11,
  BW_COLD_DIRECT_RAM_PIO_IN = 12,
  BW_COLD_DIRECT_RAM_PIO_OUT = 13,
  BW_COLD_DIRECT_RAM_PAUSED_OBSERVER = 14,
  /* Source clock reason PAGE=4 flushes a tape before the separate page callback. */
  BW_COLD_DIRECT_RAM_PAGE_CLOCK = 15
};
/* Only CPU3 source globals may populate this after the existing clock transfer
   has validated its completed N/Q. JS never supplies these ledger fields.
   pending_writes is the CPU3 alias/publication ledger, which resets at its
   instruction boundary; it is independent of the owner's reconcile journal.
   The two owner sequence watermarks must come from the same-DSO bridge, never JS. */
typedef struct bw_cold_direct_ram_source_ledger {
  uint64_t n, q, effect, owner_committed_sequence, owner_acknowledged_sequence;
  uint32_t generation_before, pending_writes, mapping_epoch, board_a20;
} bw_cold_direct_ram_source_ledger;
typedef struct bw_cold_direct_ram_memory_reply {
  uint32_t status, decoded, kind, effect_kind, generation, mapping_epoch, board_a20;
  uint64_t effect, n, q, sequence;
  uint8_t observed[16];
} bw_cold_direct_ram_memory_reply;
typedef struct bw_cold_direct_ram_clock_ledger {
  uint64_t n,q;
  uint32_t debt,deadline,mapping_epoch,board_a20,in_resume;
} bw_cold_direct_ram_clock_ledger;

#ifdef __cplusplus
extern "C" {
#endif
/* Implemented by the owner in the same addon DSO, never by a JS callback. */
int bw_cold_direct_ram_memory(uint32_t raw,uint32_t length,const uint8_t *operand,
  const bw_cold_direct_ram_source_ledger *source,bw_cold_direct_ram_memory_reply *reply);
int bw_cold_direct_ram_reconcile_full(void);
int bw_cold_direct_ram_watermarks(uint64_t *committed,uint64_t *acknowledged);
int bw_cold_direct_ram_source_clock(bw_cold_direct_ram_clock_ledger *out);
#ifdef __cplusplus
}
#endif

#endif
