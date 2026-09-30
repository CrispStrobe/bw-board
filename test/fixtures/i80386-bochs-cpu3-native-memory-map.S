.code16
.section .text
.global _start
.global setup, a20_seed_on, a20_alias_off, a20_restore_on
.global rom_probe, mmio_probe, open_bus_probe, table_init, protected_entry
.global high_table_seed, paging_gate_off, paged_store, paging_disable
.global final_marker, terminal_loop

// Freely authored CPU3 memory-map probe. BIOS disk loading ends before setup.
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
  jc fail_boot
  ljmp $0,$setup
fail_boot:
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

  // With the host 8042 A20 source held low, port 92 bit 1 owns this gate.
a20_seed_on:
  movb $2,%al
  outb %al,$0x92
  inb $0x92,%al
  testb $2,%al
  jz fail
  movw $0xffff,%ax
  movw %ax,%es
  movb $0x31,0x0500
  // FFFF:0510 is raw physical 0x100500.
  movb $0xa7,%es:0x0510
  cmpb $0x31,0x0500
  jne fail
  cmpb $0xa7,%es:0x0510
  jne fail

a20_alias_off:
  movb $0,%al
  outb %al,$0x92
  inb $0x92,%al
  testb $2,%al
  jnz fail
  cmpb $0x31,%es:0x0510
  jne fail
  movb $0x52,%es:0x0510
  cmpb $0x52,0x0500
  jne fail

a20_restore_on:
  movb $2,%al
  outb %al,$0x92
  cmpb $0xa7,%es:0x0510
  jne fail
  cmpb $0x52,0x0500
  jne fail

  // A0000 is one deterministic fake device register, not backing RAM.
mmio_probe:
  movw $0xa000,%ax
  movw %ax,%fs
  movb $0x5a,%fs:0
  movb %fs:0,%al
  movb %al,0x0561
  cmpb $0x5a,%al
  jne fail

  // D0000 is unmapped: a discarded write followed by open-bus FF.
open_bus_probe:
  movw $0xd000,%ax
  movw %ax,%gs
  movb $0x33,%gs:0
  movb %gs:0,%al
  movb %al,0x0562
  cmpb $0xff,%al
  jne fail

  // The runner derives F000:FFF0 from the pinned free 64-KiB BIOS image.
  // The guest only demands write-ignore/readback; it does not bake in a byte.
rom_probe:
  movw $0xf000,%ax
  movw %ax,%es
  movb %es:0xfff0,%bl
  movb %bl,0x0560
  movb $0x12,%es:0xfff0
  movb %es:0xfff0,%al
  movb %al,0x0563
  cmpb %bl,%al
  jne fail

  // Low backing for raw CR3 0x110000 and raw PTE base 0x111000 when A20=0.
  // Initialize with A20=1 so host transactions cannot accidentally alias.
table_init:
  movw $0x1000,%ax
  movw %ax,%es
  xorw %di,%di
  xorl %eax,%eax
  movw $1024,%cx
  rep stosl
  movl $0x00111003,%es:0
  movw $0x1100,%ax
  movw %ax,%es
  xorw %di,%di
  movl $3,%eax
  movw $256,%cx
pte_loop:
  stosl
  addl $0x1000,%eax
  loop pte_loop
  cmpw $0x5003,%es:0x0014
  jne fail

  lgdt gdt_ptr
  movl %cr0,%eax
  orl $1,%eax
  movl %eax,%cr0
  ljmp $8,$protected_entry

protected_entry:
  // Flat data for explicit high backing initialization.
  movw $0x10,%ax
  movw %ax,%ds
  movw %ax,%es
  // Keep the stack's 16-bit selector and low address.
  movw $0x18,%ax
  movw %ax,%ss
  movw $0x7000,%sp
high_table_seed:
  addr32 movl $0x00b02002,0x110000
  addr32 movl $0x00505002,0x111014
  addr32 cmpl $0x00b02002,0x110000
  jne fail
  addr32 cmpl $0x00505002,0x111014
  jne fail
  movl $0x110000,%eax
  movl %eax,%cr3

paging_gate_off:
  movb $0,%al
  outb %al,$0x92
  movl %cr0,%eax
  orl $0x80000000,%eax
  movl %eax,%cr0

paged_store:
  movl $0x11223344,0x5000
  cmpl $0x11223344,0x5000
  jne fail
  addr32 cmpl $0x00111023,0x10000
  jne fail
  addr32 cmpl $0x00005063,0x11014
  jne fail

paging_disable:
  movl %cr0,%eax
  andl $0x7fffffff,%eax
  movl %eax,%cr0
  jmp 1f
1:
  movb $2,%al
  outb %al,$0x92
  addr32 cmpl $0x00b02002,0x110000
  jne fail
  addr32 cmpl $0x00505002,0x111014
  jne fail

final_marker:
  movb $'B',%al
  outb %al,$0xe9
  movb $'M',%al
  outb %al,$0xe9
  movb $'A',%al
  outb %al,$0xe9
  movb $'P',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'0',%al
  outb %al,$0xe9
  movb $'1',%al
  outb %al,$0xe9
terminal_loop:
  jmp terminal_loop

fail:
  movb $'F',%al
  outb %al,$0xe9
  jmp terminal_loop

.align 8
gdt:
  .quad 0
  // 16-bit code, flat data including high sentinels, then 16-bit low stack.
  .quad 0x00009a000000ffff
  .quad 0x00cf92000000ffff
  .quad 0x000092000000ffff
gdt_ptr:
  .word 31
  .long gdt
