#ifndef BW_CPU3_NATIVE_RAM_COHERENCE_RUNTIME_H
#define BW_CPU3_NATIVE_RAM_COHERENCE_RUNTIME_H
#include "bw_slice_abi.h"
#if !defined(BX_USE_IDLE_HACK) || BX_USE_IDLE_HACK != 0
#error Native device-event slice requires BX_USE_IDLE_HACK=0
#endif

class BX_CPU_C;
extern bool bw_slice_active;
extern bool bw_slice_port_pending;
extern bool bw_slice_rep_incomplete;
extern bool bw_slice_fault_pending;
extern bool bw_slice_irq_pending;

void bw_slice_before_fetch(BX_CPU_C *cpu);
void bw_slice_activate(BX_CPU_C *cpu);
void bw_slice_note_attempt(unsigned length);
void bw_slice_note_prefetch(unsigned long long address);
void bw_slice_note_completed(void);
void bw_slice_note_rep_iteration(void);
void bw_slice_note_successful_rep_iteration(void);
bool bw_slice_rep_budget_exhausted(void);
void bw_slice_rep_pre_iteration(void);
bool bw_slice_ticks_reached(void);
bool bw_slice_should_yield(void);
void bw_slice_note_halt(void);
unsigned bw_slice_ack_irq(void);
void bw_slice_note_irq(unsigned vector);
void bw_slice_note_fault(unsigned vector, unsigned error_code);
void bw_slice_note_fault_delivered(void);
void bw_slice_pagewalk_set(unsigned kind);
void bw_slice_tick(unsigned count);
void bw_slice_fail(const char *kind);
void bw_slice_read(unsigned long long address, unsigned length, void *data);
void bw_slice_write(unsigned long long address, unsigned length, const void *data);
const unsigned char *bw_slice_execute_page(unsigned long long address);
unsigned bw_slice_port_in(unsigned port, unsigned width);
void bw_slice_port_out(unsigned port, unsigned value, unsigned width);
void bw_slice_driver(void);
#endif
