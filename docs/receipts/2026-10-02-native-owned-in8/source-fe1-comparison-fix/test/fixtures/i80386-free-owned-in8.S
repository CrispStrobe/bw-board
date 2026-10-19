/* Separate source-only hot profile: no execution or throughput claim. */
/* SPDX-License-Identifier: MIT; free actual-board protected paging REP/PF/IRQ RAM-SMC/A20 guest. */
.code16
.section .text
.org 0x100,0xff
.global setup,protected_entry,rep_fill,zero_rep,ordinary_fault_store,rep_one
.global pf_handler,irq_handler,shadow_successor,after_shadow,terminal_hlt,halt_end
.global low_first,low_patch_call,off_high_first,off_low_before_write,off_low_after_write,off_high_after_write,on_high_first,on_high_patch_call
setup:
 cli
 cld
 xorw %ax,%ax
 movw %ax,%ds
 movw %ax,%es
 movw %ax,%ss
 movw $0x9000,%sp
 movl %edx,0x510
 /* IN8 witness: IRQs remain masked. Existing hot workload reprograms PIT later. */
 movb $0x34,%al
 outb %al,$0x43
 movb $0x34,%al
 outb %al,$0x40
 movb $0x12,%al
 outb %al,$0x40
 movb $0,%al
 outb %al,$0x43
 inb $0x40,%al
 movb %al,0x590
 inb $0x40,%al
 movb %al,0x591
 movl %cr0,%eax
 movl %eax,0x514
 /* Guest creates both executable RAM pages; high real-mode offset staysFFFF-bounded. */
 movl $0xcb1111bb,0x7000
 movw $0xffff,%ax
 movw %ax,%es
 movl $0xcb3333bb,%es:0x7010
 /* Sparse tables: all remaining backing starts zero in the actual board. */
 movl $0xa003,0x9000
 movl $3,0xa000
 movl $0x4003,0xa010
 movl $0x5002,0xa014
 movl $0x6002,0xa018
 movl $0x7003,0xa01c
 movl $0x107003,0xa41c
 movl $0x8003,0xa020
 movl $0x9003,0xa024
 movl $0xa003,0xa028
 movl $0xf0003,0xa3c0
 movw $pf_handler,0x70
 movw $8,0x72
 movl $0x8e00,0x74
 movw $irq_handler,0x100
 movw $8,0x102
 movl $0x8e00,0x104
 movl $0x0000ffff,0x608
 movl $0x00009a0f,0x60c
 movl $0x0000ffff,0x610
 movl $0x00009200,0x614
 movl $0xffff,0x618
 movl $0x9a00,0x61c
 movl $0xffff,0x620
 movl $0x9a10,0x624
 movl $0xffff,0x628
 movl $0x9210,0x62c
 lgdt %cs:gdt_ptr
 lidt %cs:idt_ptr
 movl $0x11,%eax
 movl %eax,%cr0
 ljmp $8,$protected_entry
protected_entry:
 movw $0x10,%ax
 movw %ax,%ds
 movw %ax,%es
 movw %ax,%ss
 movw $0x9000,%sp
 movl $0x9000,%eax
 movl %eax,%cr3
 movl $0x80000011,%eax
 movl %eax,%cr0
low_first:
 lcall $0x18,$0x7000
 movw %bx,0x560
 movw $0x2222,0x7001
low_patch_call:
 lcall $0x18,$0x7000
 movw %bx,0x562
 /* Actual configured master/slave cascade, no injected line. */
 movb $0x11,%al
 outb %al,$0x20
 outb %al,$0xa0
 movb $0x20,%al
 outb %al,$0x21
 movb $0x28,%al
 outb %al,$0xa1
 movb $4,%al
 outb %al,$0x21
 movb $2,%al
 outb %al,$0xa1
 movb $1,%al
 outb %al,$0x21
 outb %al,$0xa1
 movb $0xff,%al
 outb %al,$0xa1
 movb $0xfe,%al
 outb %al,$0x21
 movb $0x30,%al
 outb %al,$0x43
 movb $6,%al
 outb %al,$0x40
 movb $0,%al
 outb %al,$0x40
 movw $0x4ff8,%di
 movw $4,%cx
 movl $0x11223344,%eax
rep_fill:
 rep stosl
 movw $0x6000,%di
 xorw %cx,%cx
zero_rep:
 rep stosl
ordinary_fault_store:
 movl $0x55667788,0x6000
 movw $0x6004,%di
 movw $1,%cx
 movl $0x99aabbcc,%eax
rep_one:
 rep stosl
 sti
shadow_successor:
 movb $1,0x530
after_shadow:
 cli
 movw $0x28,%ax
 movw %ax,%es
 movb $0xd1,%al
 outb %al,$0x64
 movb $1,%al
 outb %al,$0x60
 off_high_first:
 lcall $0x20,$0x7000
 movw %bx,0x564
 off_low_before_write:
 lcall $0x18,$0x7000
 movw %bx,0x566
 movw $0x5555,%es:0x7001
 off_low_after_write:
 lcall $0x18,$0x7000
 movw %bx,0x568
 off_high_after_write:
 lcall $0x20,$0x7000
 movw %bx,0x56a
 movb $0xd1,%al
 outb %al,$0x64
 movb $3,%al
 outb %al,$0x60
 on_high_first:
 lcall $0x20,$0x7000
 movw %bx,0x56c
 movw $0x4444,%es:0x7001
 on_high_patch_call:
 lcall $0x20,$0x7000
 movw %bx,0x56e
 hot_profile_start:
 cli
 movb $0xff,%al
 outb %al,$0x21
 movl $20000,%ecx
 xorl %eax,%eax
 movl $1,%ebx
hot_register_loop:
 addl %ebx,%eax
 incl %ebx
 decl %ecx
 jnz hot_register_loop
hot_register_end:
 movl %eax,0x580
 movl %ebx,0x584
 movl $0,0x588
 movl $4096,%ecx
hot_memory_loop:
 movl 0x588,%eax
 addl $1,%eax
 movl %eax,0x588
 decl %ecx
 jnz hot_memory_loop
hot_memory_end:
 movb $'R',%al
 outb %al,$0xe9
 movb $'P',%al
 outb %al,$0xe9
 movb $'G',%al
 outb %al,$0xe9
 movb $'H',%al
 outb %al,$0xe9
 movb $'0',%al
 outb %al,$0xe9
 movb $'0',%al
 outb %al,$0xe9
 movb $'1',%al
 outb %al,$0xe9
terminal_hlt:
 hlt
halt_end:
 jmp halt_end
pf_handler:
 movw %sp,%bp
 movl %cr2,%ebx
 cmpb $0,0x524
 jne second_pf
 movl %ebx,0x520
 movl $0x5003,0xa014
 jmp repaired
second_pf:
 movl %ebx,0x528
 movl $0x6003,0xa018
repaired:
 incb 0x524
 movl %cr3,%ebx
 movl %ebx,%cr3
 addw $4,%sp
 iretl
irq_handler:
 movw %sp,%bp
 movl 0(%bp),%ebx
 movl %ebx,0x540
 movl 4(%bp),%ebx
 movl %ebx,0x544
 movl 8(%bp),%ebx
 movl %ebx,0x548
 incb 0x534
 movb $0x20,%al
 outb %al,$0x20
 iretl
.align 8
gdt:
 .quad 0
 .quad 0x00009a0f0000ffff
 .quad 0x000092000000ffff
 .quad 0x00009a000000ffff
 .quad 0x00009a100000ffff
 .quad 0x000092100000ffff
gdt_end:
gdt_ptr: .word gdt_end-gdt-1
 .long 0x600
idt_ptr: .word 0x3ff
 .long 0
.org 0xfff0,0xff
.byte 0xea,0x00,0x01,0x00,0xf0
.org 0x10000,0xff
