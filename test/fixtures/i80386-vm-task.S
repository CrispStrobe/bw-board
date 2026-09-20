.code16
.section .text
.global _start
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
  movb $'B',%al
  outb %al,$0xe9
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
  movw $0x18,%ax
  ltr %ax
  ljmp $0x20,$0
hang: jmp hang
handler:
  movb $'H',%al
  outb %al,$0xe9
  iret
vmcode:
  int $0x20
  movb $'V',%al
  outb %al,$0xe9
  outb %al,$0xf4
vmhang: jmp vmhang
.align 8
gdt:
  .quad 0
  .quad 0x00009a000000ffff
  .quad 0x000092000000ffff
  .word 0x67, oldtss
  .byte 0,0x89,0,0
  .word 0x67, vmtss
  .byte 0,0x89,0,0
  .word 0x67, handtss
  .byte 0,0x89,0,0
gdt_end:
gdt_ptr: .word gdt_end-gdt-1
 .long gdt
idt_ptr: .word 0x107
 .long idt
.align 16
oldtss: .space 0x68
vmtss:
 .word 0,0
 .space 0x18
 .long 0,vmcode,0x23202
 .long 0,0,0,0,0x6800,0,0,0
 .word 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0
 .word 0,0
handtss:
 .word 0,0
 .space 0x18
 .long 0,handler,2
 .long 0,0,0,0,0x6900,0,0,0
 .word 0x10,0, 8,0, 0x10,0, 0x10,0, 0,0, 0,0, 0,0
 .word 0,0
.align 8
idt:
 .space 0x100
 .word 0,0x28
 .byte 0,0xe5,0,0
.org 2560
