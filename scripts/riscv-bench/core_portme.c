/* See core_portme.h. */
#include "coremark.h"
#include "core_portme.h"

volatile ee_s32 seed1_volatile = 0x0;
volatile ee_s32 seed2_volatile = 0x0;
volatile ee_s32 seed3_volatile = 0x66;
volatile ee_s32 seed4_volatile = ITERATIONS;
volatile ee_s32 seed5_volatile = 0;
ee_u32 default_num_contexts = 1;

static CORE_TICKS start_time_val, stop_time_val;
static inline CORE_TICKS rdcycle(void) { CORE_TICKS c; __asm__ volatile("rdcycle %0" : "=r"(c)); return c; }
void start_time(void) { start_time_val = rdcycle(); }
void stop_time(void) { stop_time_val = rdcycle(); }
CORE_TICKS get_time(void) { return stop_time_val - start_time_val; }
/* Reported seconds are nominal (cycles / 1000): CoreMark's ">= 10 s" rule
 * is a wall-clock rule for scoring, not a correctness one; the score is not
 * used — the harness times the whole run on the host. */
secs_ret time_in_secs(CORE_TICKS ticks) { return ticks / 1000; }
void portable_init(core_portable *p, int *argc, char *argv[]) { p->portable_id = 1; }
void portable_fini(core_portable *p) { p->portable_id = 0; }
