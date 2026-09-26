/* CoreMark port for the bw-board RISC-V benchmark kit: bare rv32, fixed
 * ITERATIONS (no self-calibration, so every simulator runs the same work),
 * time from the `cycle` CSR, output through the runtime's printf. */
#ifndef CORE_PORTME_H
#define CORE_PORTME_H
#include <stddef.h>
#define HAS_FLOAT 0
#define HAS_TIME_H 0
#define USE_CLOCK 0
#define HAS_STDIO 0
#define HAS_PRINTF 1
#define MAIN_HAS_NOARGC 1
#define MAIN_HAS_NORETURN 0
#define SEED_METHOD SEED_VOLATILE
#define MEM_METHOD MEM_STATIC
#define MULTITHREAD 1
#define USE_PTHREAD 0
#define USE_FORK 0
#define USE_SOCKET 0
#ifndef COMPILER_VERSION
#define COMPILER_VERSION __VERSION__
#endif
#ifndef COMPILER_FLAGS
#define COMPILER_FLAGS "-O2"
#endif
#define MEM_LOCATION "STATIC"
typedef signed short ee_s16;
typedef unsigned short ee_u16;
typedef signed int ee_s32;
typedef double ee_f32;
typedef unsigned char ee_u8;
typedef unsigned int ee_u32;
typedef ee_u32 ee_ptr_int;
typedef size_t ee_size_t;
typedef ee_u32 CORE_TICKS;
#define align_mem(x) (void *)(4 + (((ee_ptr_int)(x)-1) & ~3))
#define NULL_PTR ((void *)0)
typedef struct CORE_PORTABLE_S { ee_u8 portable_id; } core_portable;
void portable_init(core_portable *p, int *argc, char *argv[]);
void portable_fini(core_portable *p);
extern ee_u32 default_num_contexts;
int printf(const char *fmt, ...);
#define ee_printf printf
#endif
