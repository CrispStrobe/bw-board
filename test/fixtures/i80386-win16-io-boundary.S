.code16
.section .text
.global _start
.global trace_start
.global io_boundary
.global after_io
_start:
  cli
  xorw %ax,%ax
  movw %ax,%ds
  movw %ax,%ss
  movw $0x7000,%sp
  lgdt gdt_ptr
  movl %cr0,%eax
  orl $1,%eax
  movl %eax,%cr0
  ljmp $0x08,$protected16
protected16:
  movw $0x10,%ax
  movw %ax,%ds
  movw %ax,%ss
  movw $0x7000,%sp
  movw $0x21,%dx
  movb $0xa5,%al
  outb %al,%dx              # establish a deterministic PIC1 IMR value
trace_start:
  movw $1,%bx
  cmpw $1,%bx
  jz io_boundary           # taken; fallthrough emits a failure marker
  movb $'F',%al
  outb %al,$0xe9
  jmp done
io_boundary:
  inb %dx,%al              # one device read; future block must stop before it
after_io:
  outb %al,$0xe9           # independent QEMU observation: byte A5
  movb $'K',%al
  outb %al,$0xe9
  movb $1,%al
  outb %al,$0xf4
done:
  hlt
  jmp done
.align 8
gdt:
  .quad 0
  .quad 0x00009a000000ffff # 16-bit code, base zero, 64 KiB limit
  .quad 0x000092000000ffff # 16-bit data, base zero, 64 KiB limit
gdt_end:
gdt_ptr:
  .word gdt_end-gdt-1
  .long gdt
.org 510
.word 0xaa55
