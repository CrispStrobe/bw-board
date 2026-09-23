/* Link the S-mode demo at 0x80000000 (the supervisor RAM base), within a single
 * 4 MiB region so the identity superpage covers all of it. */
OUTPUT_ARCH( "riscv" )
ENTRY( _start )

MEMORY { RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 4M }
__stack_size = 8K;

SECTIONS
{
    .text : {
        KEEP(*(.init))
        *(.text .text.*) *(.rodata .rodata.*) *(.srodata .srodata.*)
        . = ALIGN(4);
    } > RAM
    . = ALIGN(8);
    __global_pointer$ = . + 0x800;
    .data : { *(.data .data.*) *(.sdata .sdata.*) . = ALIGN(4); } > RAM
    .bss (NOLOAD) : {
        __bss_start = .;
        *(.sbss .sbss.*) *(.bss .bss.*) *(COMMON)
        . = ALIGN(4096);          /* the root page table needs 4 KiB alignment */
        __bss_end = .;
    } > RAM
    . = ALIGN(16);
    . = . + __stack_size;
    __stack_top = .;
    _end = .;
}
