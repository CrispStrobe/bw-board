.code16
.section .text
.global _start
.global setup, protected_entry, pic_init, pit_init, rep_fill, zero_rep
.global ordinary_fault_store, rep_one, pf_handler, cr3_reload, iret_retry
.global shadow_successor, after_shadow, irq_handler, irq_eoi
.global final_marker, terminal_hlt, terminal_loop

// Free CPU3 quantum proof. BIOS disk service finishes before owned setup.
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
  movb $0,0x0524            # delivered #PF count
  movb $0,0x0530            # STI successor marker
  movb $0,0x0534            # delivered IRQ count

  // Identity-map the first MiB through ordinary 4 KiB page tables.
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
  movl $0x5002,0xa014     # page 5 and page 6 start nonpresent
  movl $0x6002,0xa018

  // Protected-mode 32-bit gates; code/data remain 16-bit selectors.
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
  ljmp $8,$protected_entry
protected_entry:
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

  // A single Node-owned I8259 and I8254. The PIT one-shot expires during
  // successful REP progress while CLI blocks delivery, before either #PF.
pic_init:
  movb $0x13,%al
  outb %al,$0x20
  movb $0x20,%al
  outb %al,$0x21
  movb $0x01,%al
  outb %al,$0x21
  movb $0xfe,%al
  outb %al,$0x21
pit_init:
  movb $0x30,%al
  outb %al,$0x43
  movb $0x80,%al
  outb %al,$0x40
  movb $0x00,%al
  outb %al,$0x40

  // 1024 successful page-4 stores, one failed page-5 element, then four
  // successful page-5 stores after the handler maps its PTE and IRETs.
  movl $0x4000,%edi
  movl $1028,%ecx
  movl $0x11223344,%eax
  cmpl $0x11223344,%eax
rep_fill:
  rep stosl
  cmpl $0,%ecx
  jne fail
  cmpl $0x5010,%edi
  jne fail
  cmpl $0x11223344,0x4000
  jne fail
  cmpl $0x11223344,0x4ffc
  jne fail
  cmpl $0x11223344,0x500c
  jne fail
  cmpb $1,0x0524
  jne fail
  cmpb $0,0x0534
  jne fail

  // This zero-count REP must earn one successful ordinary quantum without
  // touching nonpresent page 6 or consuming its later ordinary #PF.
  movl $0x6000,%edi
  xorl %ecx,%ecx
zero_rep:
  rep stosl
  cmpb $1,0x0524
  jne fail
  cmpl $0x6002,0xa018
  jne fail

  // A separate ordinary failed store earns no functional clock quantum.
  xorl %eax,%eax
  cmpl $0,%eax
ordinary_fault_store:
  movl $0x55667788,0x6000
  cmpl $0x55667788,0x6000
  jne fail
  cmpb $2,0x0524
  jne fail
  cmpl $0x5000,0x0520
  jne fail
  cmpl $0x6000,0x0528
  jne fail

  // One final-element REP callback, with no outer-completion double charge.
  movl $0x6004,%edi
  movl $1,%ecx
  movl $0x99aabbcc,%eax
  cmpl $0x99aabbcc,%eax
rep_one:
  rep stosl
  cmpl $0,%ecx
  jne fail
  cmpl $0x6008,%edi
  jne fail
  cmpl $0x99aabbcc,0x6004
  jne fail

  // The pending real PIC interrupt cannot enter until this successor retires.
  xorl %eax,%eax
  cmpl $0,%eax
  sti
shadow_successor:
  movb $1,0x0530
after_shadow:
  cmpb $1,0x0534
  jne fail
final_marker:
  movb $'B',%al
  outb %al,$0xe9
  movb $'Q',%al
  outb %al,$0xe9
  movb $'N',%al
  outb %al,$0xe9
  movb $'T',%al
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

pf_handler:
  // Same-ring 32-bit #PF gate: error/EIP/CS/EFLAGS at SP..SP+12.
  movw %sp,%bp
  cmpl $2,0(%bp)
  jne fail
  cmpw $8,8(%bp)
  jne fail
  // REP STOSL retries with the original EAX data value. Use EBX as handler
  // scratch so neither EAX nor ECX/EDI progress is changed by either #PF.
  movl %cr2,%ebx
  cmpb $0,0x0524
  je first_pf
  cmpb $1,0x0524
  jne fail
  cmpl $0x6000,%ebx
  jne fail
  cmpl $ordinary_fault_store,4(%bp)
  jne fail
  movl %ebx,0x0528
  movb $2,0x0524
  movl $0x6003,0xa018
  jmp repaired
first_pf:
  cmpl $0x5000,%ebx
  jne fail
  cmpl $rep_fill,4(%bp)
  jne fail
  movl %ebx,0x0520
  movb $1,0x0524
  movl $0x5003,0xa014
repaired:
  movl %cr3,%ebx
cr3_reload:
  movl %ebx,%cr3       # original 386 has no INVLPG
  addw $4,%sp          # discard #PF error dword
iret_retry:
  iretl

irq_handler:
  movw %sp,%bp
  cmpb $2,0x0524
  jne fail
  cmpb $1,0x0530
  jne fail
  cmpb $0,0x0534
  jne fail
  cmpl $after_shadow,0(%bp)
  jne fail
  cmpw $8,4(%bp)
  jne fail
  movl 0(%bp),%eax
  movl %eax,0x0540
  movl 4(%bp),%eax
  movl %eax,0x0544
  movl 8(%bp),%eax
  movl %eax,0x0548
  andl $0x00037fd7,%eax
  cmpl $0x00000246,%eax
  jne fail
  movb $1,0x0534
irq_eoi:
  movb $0x20,%al
  outb %al,$0x20
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
