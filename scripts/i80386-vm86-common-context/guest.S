/* MIT-authored strict-386 VM86 common-context guest (boot sector + two stage-2 sectors).
 *
 * Real mode -> protected mode (CPL0) -> IRETD into VM86 -> INT 40h through a
 * DPL3 32-bit interrupt gate onto the TSS1 SS0:ESP0 stack -> IRETD back to
 * VM86 -> INT 41h through a DPL3 task gate into TSS2. Every observation is
 * emitted by CPL0 code on port E9 as raw bytes: the whole GDT, both TSS images
 * and selected stack/RAM words. All code/data descriptors other than the boot
 * selectors start with the accessed bit CLEAR, so the INT-gate CS load (0x28)
 * and the task-switch CS/data loads (0x30/0x38) must write descriptor RAM.
 * Interrupts stay disabled throughout; VM86 code performs no I/O.
 */
        .set IDT,      0x1000
        .set TSS1,     0x2000
        .set TSS2,     0x2100
        .set STACK0,   0x9000
        .set ESP0,     0x8800
        .set STACK2,   0xa000

        .code16
        .globl _start
_start:
        cli
        cld
        xor     %ax, %ax
        mov     %ax, %ds
        mov     %ax, %ss
        mov     $0x7c00, %sp
        /* Sector 2 is preloaded by a harness without disk BIOS; otherwise read it. */
        cmpl    $0x32434d56, stage2_magic
        je      1f
        mov     %ax, %es
        mov     $0x0202, %ax            /* read two sectors */
        mov     $0x7e00, %bx
        mov     $0x0002, %cx            /* cylinder 0, sector 2 */
        xor     %dh, %dh                /* head 0, DL = BIOS boot drive */
        int     $0x13
        jc      .
        cmpl    $0x32434d56, stage2_magic
        jne     .
1:      jmp     stage2

        .org 510
        .word 0xaa55
stage2_magic:
        .ascii "VMC2"
stage2:
        lgdt    gdtr
        mov     %cr0, %eax
        or      $1, %al
        mov     %eax, %cr0
        ljmp    $0x08, $pm32

        .code32
pm32:
        mov     $0x10, %ax
        mov     %ax, %ds
        mov     %ax, %es
        mov     %ax, %ss
        mov     %ax, %fs
        mov     %ax, %gs
        mov     $STACK0, %esp
        xor     %eax, %eax
        mov     %eax, %cr3
        mov     $IDT, %edi
        mov     $((TSS2 + 0x100 - IDT) / 4), %ecx
        rep stosl
        /* IDT[40h]: 32-bit interrupt gate, DPL3, 0x28:h40 */
        movl    $(0x00280000 + h40), IDT + 0x40 * 8
        movl    $0x0000ee00, IDT + 0x40 * 8 + 4
        /* IDT[41h]: task gate, DPL3, TSS2 selector 0x20 */
        movl    $0x00200000, IDT + 0x41 * 8
        movl    $0x0000e500, IDT + 0x41 * 8 + 4
        lidt    idtr
        movl    $ESP0, TSS1 + 0x04
        movw    $0x10, TSS1 + 0x08
        movw    $0x68, TSS1 + 0x66
        movl    $task2, TSS2 + 0x20
        movl    $0x00000002, TSS2 + 0x24
        movl    $0xa5a50000, TSS2 + 0x28
        movl    $STACK2, TSS2 + 0x38
        movw    $0x38, TSS2 + 0x48
        movw    $0x30, TSS2 + 0x4c
        movw    $0x38, TSS2 + 0x50
        movw    $0x38, TSS2 + 0x54
        movw    $0x38, TSS2 + 0x58
        movw    $0x38, TSS2 + 0x5c
        movw    $0x68, TSS2 + 0x66
        mov     $0x18, %ax
        ltr     %ax
        mov     $start_tag, %esi
        call    out4
        mov     $tag_p0, %esi
        call    dump_tables
        /* VM86 entry frame */
        push    $0x0700                 /* GS */
        push    $0x0500                 /* FS */
        push    $0x0300                 /* DS */
        push    $0x0400                 /* ES */
        push    $0x0600                 /* SS */
        push    $0x0100                 /* ESP */
        push    $0x00023002             /* EFLAGS: VM, IOPL3, IF=0 */
        push    $0                      /* CS */
        push    $vm86                   /* EIP */
        mov     $0x11110000, %eax
        mov     $0x22222222, %ebx
        mov     $0x33333333, %ecx
        mov     $0x44444444, %edx
        mov     $0x66666666, %ebp
        mov     $0x77777777, %esi
        mov     $0x88888888, %edi
        iretl

        .code16
vm86:
        mov     $0x1234, %ax
        pushw   $0xbeef
        movw    $0xcafe, 0x10
        int     $0x40
        .globl vm86_after40
vm86_after40:
        mov     $0x5678, %bx
        int     $0x41
        .globl vm86_after41
vm86_after41:
        hlt

        .code32
/* CPL0 handler entered from VM86: DS/ES/FS/GS hold null selectors. */
h40:
        pushal
        pushfl
        xor     %eax, %eax
        mov     %ds, %ax
        push    %eax
        mov     %es, %ax
        push    %eax
        mov     %fs, %ax
        push    %eax
        mov     %gs, %ax
        push    %eax
        mov     $0x10, %ax
        mov     %ax, %ds
        mov     %ax, %es
        mov     $tag_h40, %esi
        call    dump_tables
        mov     %esp, %esi
        mov     $88, %ecx
        call    outn
        mov     $0x60fe, %esi
        mov     $2, %ecx
        call    outn
        mov     $0x3010, %esi
        mov     $2, %ecx
        call    outn
        add     $16, %esp
        popfl
        popal
        iretl

/* Nested task entered through the task gate; flat 0x30 code, 0x38 data. */
        .globl task2
task2:
        pushal
        pushfl
        mov     $tag_t41, %esi
        call    dump_tables
        mov     %esp, %esi
        mov     $36, %ecx
        call    outn
        mov     $end_tag, %esi
        call    out4
1:      hlt
        jmp     1b

/* esi = 4-byte tag; then GDT, TSS1, TSS2 */
dump_tables:
        call    out4
        mov     $gdt, %esi
        mov     $(gdt_end - gdt), %ecx
        call    outn
        mov     $TSS1, %esi
        mov     $0x68, %ecx
        call    outn
        mov     $TSS2, %esi
        mov     $0x68, %ecx
        jmp     outn
out4:
        mov     $4, %ecx
outn:
        mov     $0xe9, %dx
        rep outsb
        ret

start_tag: .ascii "VMCC"
tag_p0:    .ascii "P0__"
tag_h40:   .ascii "H40_"
tag_t41:   .ascii "T41_"
end_tag:   .ascii "END!"

        .p2align 3
        .globl gdt
gdt:
        .quad 0
        .quad 0x00cf9a000000ffff        /* 0x08 boot code32, A clear */
        .quad 0x00cf92000000ffff        /* 0x10 boot data32, A clear */
        .word 0x0067, TSS1, 0x8900, 0x0000  /* 0x18 TSS1 available */
        .word 0x0067, TSS2, 0x8900, 0x0000  /* 0x20 TSS2 available */
        .quad 0x00cf9a000000ffff        /* 0x28 INT-gate handler code32, A clear */
        .quad 0x00cf9a000000ffff        /* 0x30 task2 code32, A clear */
        .quad 0x00cf92000000ffff        /* 0x38 task2 data32, A clear */
gdt_end:
gdtr:   .word gdt_end - gdt - 1
        .long gdt
idtr:   .word 0x41 * 8 + 7
        .long IDT

        .org 1536
