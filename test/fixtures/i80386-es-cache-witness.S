.code16
.section .text
.global _start
.global witness_start
.global after_second_load
.global gdt
.global selector_slot
_start:
  cli
  xorw %ax,%ax
  movw %ax,%ds
  movw %ax,%ss
  movw $0x7000,%sp
  movb $0xa1,0x9000
  movb $0xb2,0xa000
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
witness_start:
  movw selector_slot,%ax
  movw %ax,%es
  movb gdt+29,%al         # descriptor 3 access byte, initially 92
  outb %al,$0xe9          # expected 93: CPU set Accessed
  movb $0xa0,gdt+27      # change descriptor 3 base 9000 -> a000
  movb %es:0,%al         # cache still points at 9000
  outb %al,$0xe9          # expected a1
  movw selector_slot,%ax
  movw %ax,%es            # reload same selector from modified GDT
after_second_load:
  movb %es:0,%al         # cache now points at a000
  outb %al,$0xe9          # expected b2
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
  .quad 0x00009a000000ffff # 16-bit code, base zero
  .quad 0x000092000000ffff # 16-bit data, base zero
  .quad 0x000092009000ffff # ES data, base 9000
gdt_end:
gdt_ptr:
  .word gdt_end-gdt-1
  .long gdt
selector_slot:
  .word 0x18
.org 510
.word 0xaa55
