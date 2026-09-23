/*
 * A tiny supervisor-mode demo for the bw-board RISC-V machine — the smallest
 * thing that exercises the whole step-4 stack at once: M-mode start-up sets up
 * Sv32 paging and trap delegation, drops to S-mode (mret), and the S-mode code
 * runs *through the page table* and talks to the machine's SBI firmware to print
 * and shut down. Built rv32ima (no compressed ISA), so no RVC is needed.
 */

#define SBI_SET_TIMER        0
#define SBI_CONSOLE_PUTCHAR  1
#define SBI_SHUTDOWN         8

static long sbi_call(long eid, long fid, long a0, long a1) {
    register long r_a7 asm("a7") = eid;
    register long r_a6 asm("a6") = fid;
    register long r_a0 asm("a0") = a0;
    register long r_a1 asm("a1") = a1;
    asm volatile("ecall" : "+r"(r_a0), "+r"(r_a1) : "r"(r_a7), "r"(r_a6) : "memory");
    return r_a0;
}
static void sbi_putc(char c) { sbi_call(SBI_CONSOLE_PUTCHAR, 0, c, 0); }
static void sbi_puts(const char *s) { while (*s) sbi_putc(*s++); }

/* The root page table — 4 KiB aligned, in BSS (inside the mapped region). */
unsigned int root_pt[1024] __attribute__((aligned(4096)));

/* Runs in S-mode: every instruction fetch and data access here goes through the
 * Sv32 walk. Prove it by reading a current-privilege-only fact and using SBI. */
void s_main(void) {
    /* satp is an S-mode CSR — readable here only because we are in supervisor mode. */
    unsigned int satp;
    asm volatile("csrr %0, satp" : "=r"(satp));
    sbi_puts("Hello from S-mode with Sv32 paging, via SBI!\n");
    sbi_puts(satp & 0x80000000u ? "paging: ON\n" : "paging: off\n");
    sbi_puts("DONE\n");
    sbi_call(SBI_SHUTDOWN, 0, 0, 0);
    for (;;) { }
}

#define CSRW(name, val) asm volatile("csrw " name ", %0" :: "r"(val))
#define CSRR(name) ({ unsigned int __v; asm volatile("csrr %0, " name : "=r"(__v)); __v; })

/* Runs in M-mode at reset. */
void m_main(void) {
    /* Delegate all exceptions and the S-mode interrupts to S-mode. */
    CSRW("medeleg", 0xffffu);
    CSRW("mideleg", 0x222u);
    /* Identity-map the kernel's 4 MiB region (0x80000000) as an S-mode RWX
     * superpage: PPN = 0x80000, D|A|X|W|R|V = 0xCF. The SBI console needs no
     * device mapping (it is an ecall to the firmware, not an MMIO access). */
    root_pt[0x80000000u >> 22] = (0x80000u << 10) | 0xCFu;
    /* Enable Sv32 with this root table. */
    CSRW("satp", (1u << 31) | (((unsigned int) root_pt) >> 12));
    asm volatile("sfence.vma");
    /* Return to S-mode at s_main: MPP=S (01), MPIE=1. */
    unsigned int ms = CSRR("mstatus");
    ms = (ms & ~(3u << 11)) | (1u << 11) | (1u << 7);
    CSRW("mstatus", ms);
    CSRW("mepc", (unsigned int) s_main);
    asm volatile("mret");
    for (;;) { }
}
