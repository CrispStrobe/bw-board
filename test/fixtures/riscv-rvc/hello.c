/* A clang program built WITH the compressed ISA (rv32imac) — its .text is full
 * of 16-bit C instructions, so booting it exercises the RVC decompressor. It
 * prints via the NS16550 UART and exits through the ecall ABI. */
volatile unsigned char *const UART = (unsigned char *)0x10000000;
static void putc_(char c) { UART[0] = c; }
static void puts_(const char *s) { while (*s) putc_(*s++); }
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }   /* calls -> C.JAL/RET */
void _start(void) {
    puts_("RVC works: compressed instructions decoded.\n");
    int f = fib(10);                                              /* 55 */
    putc_('f'); putc_('i'); putc_('b'); putc_('='); putc_('0' + f / 10); putc_('0' + f % 10); putc_('\n');
    register long a7 asm("a7") = 93, a0 asm("a0") = 0;            /* exit */
    asm volatile("ecall" :: "r"(a7), "r"(a0));
    for (;;) { }
}
