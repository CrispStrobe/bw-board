.code16
.section .text
.global _start
.global setup, pic_init, pit_init, protected_entry
.global shadow_successor, after_shadow, first_hlt, after_hlt
.global irq_handler, irq_eoi, final_marker, terminal_hlt, terminal_loop

// Free CPU3 device proof. BIOS disk boot ends before the owned setup at 7e00.
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
  jc boot_fail
  ljmp $0,$setup
boot_fail:
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
  movb $0,0x0530          # STI successor ran
  movb $0,0x0534          # delivered IRQ count

  # Protected-mode vector 20h is an 8-byte interrupt gate at IDT 100h.
  movw $irq_handler,0x0100
  movw $8,0x0102
  movl $0x00008e00,0x0104
  lgdt gdt_ptr
  lidt idt_ptr

  # Guest PIO programs the actual Node-owned single master I8259.
pic_init:
  movb $0x13,%al          # ICW1: initialize, single, ICW4 follows
  outb %al,$0x20
  movb $0x20,%al          # ICW2: vectors 20h..27h
  outb %al,$0x21
  movb $0x01,%al          # ICW4: 8086, manual EOI
  outb %al,$0x21
  movb $0xfe,%al          # OCW1: only IR0 unmasked
  outb %al,$0x21

  # Channel 0, LSB/MSB, mode 0 one-shot. Long enough to reach HLT first.
pit_init:
  movb $0x30,%al
  outb %al,$0x43
  movb $0x00,%al
  outb %al,$0x40
  movb $0x10,%al          # reload 1000h PIT crystal ticks
  outb %al,$0x40

  movl %cr0,%eax
  orl $1,%eax
  movl %eax,%cr0
  ljmp $8,$protected_entry
protected_entry:
  movw $0x10,%ax
  movw %ax,%ds
  movw %ax,%es
  movw %ax,%ss
  movw $0x7000,%sp
  xorl %eax,%eax
  cmpl $0,%eax
  sti
shadow_successor:
  movb $1,0x0530
after_shadow:
  cmpb $0,0x0534         # the first timer edge must occur later
  jne fail
first_hlt:
  hlt                    # host advances PIT with zero native CPU ticks
after_hlt:
  cmpb $1,0x0534
  jne fail
final_marker:
  movb $'B',%al
  outb %al,$0xe9
  movb $'D',%al
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
terminal_loop:
  jmp terminal_loop
fail:
  movb $'F',%al
  outb %al,$0xe9
  jmp terminal_loop

irq_handler:
  movw %sp,%bp
  cmpb $1,0x0530
  jne fail
  cmpb $0,0x0534
  jne fail
  movl 0(%bp),%eax
  cmpl $after_hlt,%eax
  jne fail
  movl %eax,0x0540       # saved EIP
  movl 4(%bp),%eax
  movl %eax,0x0544       # raw saved CS dword
  cmpw $8,%ax
  jne fail
  movl 8(%bp),%eax
  movl %eax,0x0548       # raw saved EFLAGS dword
  andl $0x00037fd7,%eax
  cmpl $0x00000246,%eax
  jne fail
  movb $1,0x0534
irq_eoi:
  movb $0x20,%al
  outb %al,$0x20         # actual I8259 non-specific EOI
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
