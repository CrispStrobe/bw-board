.code16
.section .text
.global _start
.global setup, rep_fill, shadow_successor, after_shadow
.global irq_handler, after_hlt, terminal_hlt, after_terminal_hlt
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
  movw $0x9000,%di
  movw $1024,%cx
rep_fill:
  rep stosl

  // The host's first IRQ is already pending under CLI before this gate exists.
  // Install a 32-bit interrupt gate for vector 0x20 in the protected IDT.
  movw $irq_handler,0x100
  movw $8,0x102
  movl $0x00008e00,0x104
  movb $0,0x0530
  movb $0,0x0534
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
  // Normalize defined arithmetic flags before STI; MOV does not change them.
  xorl %eax,%eax
  cmpl $0,%eax
  sti
shadow_successor:
  movb $1,0x0530
after_shadow:
  cmpb $1,0x0534
  jne fail
  // First IRQ has returned. HLT with IF=1 and no line must idle for the host.
  xorl %eax,%eax
  cmpl $0,%eax
  hlt
after_hlt:
  cmpb $2,0x0534
  jne fail
  movb $'B',%al
  outb %al,$0xe9
  movb $'H',%al
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
  // A maskable line cannot wake this terminal IF=0 HLT.
  cli
terminal_hlt:
  hlt
after_terminal_hlt:
  jmp after_terminal_hlt
fail:
  movb $'F',%al
  outb %al,$0xe9
  jmp after_terminal_hlt

irq_handler:
  // A same-ring 32-bit gate on this 16-bit stack pushes three dwords:
  // saved EIP, CS, and EFLAGS at SP, SP+4, and SP+8, respectively.
  movw %sp,%bp
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
