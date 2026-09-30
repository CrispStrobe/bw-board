.code16
.section .text
.global _start
.global setup, rep_fill, faulting_store, pf_handler, cr3_reload, iret_retry
.global shadow_successor, after_shadow, irq_handler, after_hlt
.global terminal_hlt, after_terminal_hlt
_start:
  cli
  xorw %ax,%ax
  movw %ax,%ds
  movw %ax,%es
  movw $0x7e00,%bx
  movb $0x02,%ah
  movb $4,%al
  movb $0,%ch
  movb $2,%cl
  movb $0,%dh
  movb $0,%dl
  int $0x13
  jc disk_fail
  ljmp $0,$setup
disk_fail:
  movb $'F',%al
  outb %al,$0xe9
  hlt
.org 510
.word 0xaa55

setup:
  cli
  cld
  xorl %eax,%eax
  xorl %ebx,%ebx
  xorl %ecx,%ecx
  xorl %edx,%edx
  xorl %esi,%esi
  xorl %edi,%edi
  xorl %ebp,%ebp
  movw %ax,%ds
  movw %ax,%es
  movw %ax,%fs
  movw %ax,%gs
  movw %ax,%ss
  movl $0x7000,%esp

  // The host deadline cuts this REP before the first IRQ line is asserted.
  // Keep the fill separate from the page directory and page table below.
  movw $0xb000,%di
  movw $1024,%cx
rep_fill:
  rep stosl

  // Deterministic 4 KiB directory and 256 identity PTEs for the first MiB.
  // An ordinary LOOP keeps the one REP progress contract unambiguous.
  movw $0x9000,%di
  xorl %eax,%eax
  movw $1024,%cx
clear_directory:
  stosl
  loop clear_directory
  movw $0xa000,%di
  movl $3,%eax
  movw $256,%cx
pte_loop:
  stosl
  addl $0x1000,%eax
  loop pte_loop
  movl $0xa003,0x9000
  // Page 5 is the only nonpresent page; retain frame base and write bit.
  movl $0x5002,0xa014
  movl $0,0x0520
  movb $0,0x0524
  movb $0,0x0530
  movb $0,0x0534

  // Protected-mode IDT entries: vector 14 at 0x70 and vector 0x20 at 0x100.
  // Both gates use the same 16-bit code segment with 32-bit gate frames.
  movw $pf_handler,0x70
  movw $8,0x72
  movl $0x00008e00,0x74
  movw $irq_handler,0x100
  movw $8,0x102
  movl $0x00008e00,0x104
  lgdt gdt_ptr
  lidt idt_ptr
  movl %cr0,%eax
  orl $1,%eax
  movl %eax,%cr0
  ljmp $8,$pm
pm:
  movw $0x10,%ax
  movw %ax,%ds
  movw %ax,%es
  movw %ax,%ss
  movw $0x7000,%sp
  movl $0x9000,%eax
  movl %eax,%cr3
  movl %cr0,%eax
  orl $0x80000000,%eax
  movl %eax,%cr0
  // The fault frame's defined flags are independent of firmware CR0 flags.
  xorl %eax,%eax
  cmpl $0,%eax
faulting_store:
  movl $0x11223344,0x5000
  movl 0x5000,%eax
  cmpl $0x11223344,%eax
  jne fail
  cmpb $1,0x0524
  jne fail
  cmpl $0x5000,0x0520
  jne fail

  // First IRQ was asserted at the REP deadline but remained pending under CLI.
  // Set defined arithmetic flags again immediately before STI and its successor.
  xorl %eax,%eax
  cmpl $0,%eax
  sti
shadow_successor:
  movb $1,0x0530
after_shadow:
  cmpb $1,0x0534
  jne fail
  xorl %eax,%eax
  cmpl $0,%eax
  hlt
after_hlt:
  cmpb $2,0x0534
  jne fail
  movb $'B',%al
  outb %al,$0xe9
  movb $'P',%al
  outb %al,$0xe9
  movb $'E',%al
  outb %al,$0xe9
  movb $'V',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'1',%al
  outb %al,$0xe9
  cli
terminal_hlt:
  hlt
after_terminal_hlt:
  jmp after_terminal_hlt
fail:
  movb $'F',%al
  outb %al,$0xe9
  jmp after_terminal_hlt

pf_handler:
  // Same-ring 32-bit gate: error, fault EIP, CS, EFLAGS at SP..SP+12.
  movw %sp,%bp
  cmpl $2,0(%bp)
  jne fail
  cmpl $faulting_store,4(%bp)
  jne fail
  cmpw $8,8(%bp)
  jne fail
  movl 12(%bp),%eax
  andl $0x00037fd7,%eax
  cmpl $0x00010046,%eax
  jne fail
  movl %cr2,%eax
  cmpl $0x5000,%eax
  jne fail
  movl %eax,0x0520
  movb $1,0x0524
  movl $0x5003,0xa014
  movl %cr3,%eax
cr3_reload:
  movl %eax,%cr3
  addw $4,%sp
iret_retry:
  iretl

irq_handler:
  // The fault has completed and this same-ring IRQ has a three-dword frame.
  movw %sp,%bp
  cmpb $1,0x0524
  jne fail
  cmpl $0x5000,0x0520
  jne fail
  cmpl $0x11223344,0x5000
  jne fail
  cmpb $1,0x0530
  jne fail
  movl 0(%bp),%eax
  cmpb $0,0x0534
  jne second_irq
  cmpl $after_shadow,%eax
  jne fail
  movl %eax,0x0540
  movl 4(%bp),%eax
  movl %eax,0x0544
  cmpw $8,%ax
  jne fail
  movl 8(%bp),%eax
  movl %eax,0x0548
  andl $0x00037fd7,%eax
  cmpl $0x00000246,%eax
  jne fail
  movb $1,0x0534
  iretl
second_irq:
  cmpb $1,0x0534
  jne fail
  cmpl $after_hlt,%eax
  jne fail
  movl %eax,0x0550
  movl 4(%bp),%eax
  movl %eax,0x0554
  cmpw $8,%ax
  jne fail
  movl 8(%bp),%eax
  movl %eax,0x0558
  andl $0x00037fd7,%eax
  cmpl $0x00000246,%eax
  jne fail
  movb $2,0x0534
  iretl

.align 8
gdt:
  .quad 0
  .quad 0x00009a000000ffff
  .quad 0x000092000000ffff
gdt_end:
gdt_ptr: .word gdt_end-gdt-1
 .long gdt
idt_ptr: .word 0x03ff
 .long 0
.org 2560
