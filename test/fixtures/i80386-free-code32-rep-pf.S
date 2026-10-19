/* SPDX-License-Identifier: MIT; owned code32 paging/REP fault-restart guest. */
.code16
.section .text
.org 0x100,0xff
.global setup,protected_entry,rep_fill,pf_handler,terminal_hlt
setup:
 cli
 cld
 xorw %ax,%ax
 movw %ax,%ds
 movw %ax,%es
 movw %ax,%ss
 movw $0x9000,%sp
 /* Identity pages 0..4, initially absent page 5, stack page 8, ROM page F0. */
 movl $0xa003,0x9000
 movl $3,0xa000
 movl $0x1003,0xa004
 movl $0x2003,0xa008
 movl $0x3003,0xa00c
 movl $0x4003,0xa010
 movl $0x5002,0xa014
 movl $0x8003,0xa020
 movl $0xa003,0xa028
 movl $0xf0003,0xa3c0
 movw $pf_handler,0x70
 movw $8,0x72
 movl $0x8e00,0x74
 movl $0x00cf9a0f,0x60c
 movl $0x00cf9200,0x614
 lgdt %cs:gdt_ptr
 lidt %cs:idt_ptr
 movl $0x11,%eax
 movl %eax,%cr0
 ljmp $8,$protected_entry
.code32
protected_entry:
 movw $0x10,%ax
 movw %ax,%ds
 movw %ax,%es
 movw %ax,%ss
 movl $0x9000,%esp
 movl $0x9000,%eax
 movl %eax,%cr3
 movl $0x80000011,%eax
 movl %eax,%cr0
 movl $0x4ff8,%edi
 movl $4,%ecx
 movl $0x11223344,%eax
rep_fill:
 rep stosl
 movl $0x9000,%esp
 movl $0x4ff8,%esi
 movl $4,%ecx
 movl $0x4ff8,%edi
 /* Report the final tuple through debugcon after real readback. */
 movl 0x4ff8,%eax
 cmpl $0x11223344,%eax
 jne fail
 movl 0x4ffc,%eax
 cmpl $0x11223344,%eax
 jne fail
 movl 0x5000,%eax
 cmpl $0x11223344,%eax
 jne fail
 movl 0x5004,%eax
 cmpl $0x11223344,%eax
 jne fail
 movb $'P',%al
 outb %al,$0xe9
 movb $'3',%al
 outb %al,$0xe9
 movb $'2',%al
 outb %al,$0xe9
 movb $'O',%al
 outb %al,$0xe9
 movb $'K',%al
 outb %al,$0xe9
 movb $0,%al
 outb %al,$0xf4
 jmp terminal_hlt
fail:
 movb $'F',%al
 outb %al,$0xe9
terminal_hlt:
 hlt
 jmp terminal_hlt
pf_handler:
 movl %cr2,%ebx
 movl %ebx,0x520
 movl %ecx,0x524
 movl %edi,0x528
 movl %esi,0x52c
 incl 0x530
 movl $0x5003,0xa014
 movl %cr3,%ebx
 movl %ebx,%cr3
 addl $4,%esp
 iretl
.code16
.align 8
gdt:
 .quad 0
 .quad 0x00cf9a0f0000ffff
 .quad 0x00cf92000000ffff
gdt_end:
gdt_ptr: .word gdt_end-gdt-1
 .long 0x600
idt_ptr: .word 0x3ff
 .long 0
.org 0xfff0,0xff
.byte 0xea,0x00,0x01,0x00,0xf0
.org 0x10000,0xff
