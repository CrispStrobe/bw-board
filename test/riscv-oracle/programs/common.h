// Shared scaffolding for the oracle programs: an M-mode entry, a tohost halt,
// and a data area the harness can read. Built with test/riscv-oracle/build-programs.sh.
#define HALT          \
    li t0, 1;         \
    la t1, tohost;    \
1:  sw t0, 0(t1);     \
    sw zero, 4(t1);   \
    j 1b

    .section .tohost,"aw",@progbits
    .align 6
    .globl tohost
tohost: .dword 0
    .align 6
    .globl fromhost
fromhost: .dword 0
