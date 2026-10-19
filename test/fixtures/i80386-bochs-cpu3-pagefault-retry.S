.code16
.section .text
.global _start
.global setup, faulting_store, pf_handler, cr3_reload, iret_retry
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
  movb $'E',%al
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
  movb $'B',%al
  outb %al,$0xe9
  // Identity map the first MiB with ordinary 4 KiB PTEs.
  movw $0x9000,%di
  xorl %eax,%eax
  movw $1024,%cx
  rep stosl
  movw $0xa000,%di
  movl $3,%eax
  movw $256,%cx
pte_loop:
  stosl
  addl $0x1000,%eax
  loop pte_loop
  movl $0xa003,0x9000
  // Start with page 5 not present; retain its frame address and R/W bit.
  movl $0x5002,0xa014
  movl $0,0x0520
  // BIOS is finished. Reuse its vector-14 IVT slot as a 386 interrupt gate.
  movw $pf_handler,0x70
  movw $8,0x72
  movl $0x00008e00,0x74
  lgdt gdt_ptr
  // Make the native IDTR match the architectural reset shape explicitly.
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
  // Set every defined arithmetic flag before the fault frame is saved.
  xorl %eax,%eax
  cmpl $0,%eax
faulting_store:
  movl $0x11223344,0x5000
  movl 0x5000,%eax
  cmpl $0x11223344,%eax
  jne fail
  movb $'H',%al
  outb %al,$0xe9
  movb $'P',%al
  outb %al,$0xe9
  movb $'G',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'4',%al
  outb %al,$0xe9
done: jmp done
fail:
  movb $'F',%al
  outb %al,$0xe9
  jmp done

pf_handler:
  // A same-ring 386 gate on a 16-bit stack pushed four dwords:
  // error, fault EIP, CS, EFLAGS from SP through SP+12.
  movw %sp,%bp
  movl 0(%bp),%eax
  cmpl $2,%eax
  jne fail
  movl 4(%bp),%eax
  cmpl $faulting_store,%eax
  jne fail
  movw 8(%bp),%ax
  cmpw $8,%ax
  jne fail
  movl 12(%bp),%eax
  testl $0x10000,%eax
  jz fail
  movl %cr2,%eax
  cmpl $0x5000,%eax
  jne fail
  movl %eax,0x0520
  movl 0x0520,%eax
  cmpl $0x5000,%eax
  jne fail
  movl $0x5003,0xa014
  movl %cr3,%eax
cr3_reload:
  movl %eax,%cr3
  addw $4,%sp
iret_retry:
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
