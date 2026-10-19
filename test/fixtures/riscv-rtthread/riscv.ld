/*
 * Linker script for the RT-Thread Nano demo on the bw-board RISC-V machine.
 * Flat RAM at 0x0 (the machine resets pc to 0). _start (.init) is placed first.
 * The system heap sits between .bss and the startup/ISR stack (_sp at RAM top).
 */
OUTPUT_ARCH( "riscv" )
ENTRY( _start )

MEMORY
{
    RAM (rwx) : ORIGIN = 0x00000000, LENGTH = 1M
}

__stack_size = 8K;

SECTIONS
{
    .text : {
        KEEP(*(.init))                 /* _start at 0x0 */
        *(.text.entry)                 /* RT-Thread trap_entry */
        *(.text .text.*)
        *(.rodata .rodata.*)
        *(.srodata .srodata.*)
        . = ALIGN(4);
    } > RAM

    . = ALIGN(8);
    __global_pointer$ = . + 0x800;

    .data : {
        *(.data .data.*)
        *(.sdata .sdata.*)
        . = ALIGN(4);
    } > RAM

    .bss (NOLOAD) : {
        __bss_start = .;
        *(.sbss .sbss.*)
        *(.bss .bss.*)
        *(COMMON)
        . = ALIGN(8);
        __bss_end = .;
    } > RAM

    /* system heap: from here up to the reserved startup/ISR stack */
    . = ALIGN(8);
    PROVIDE( heap_start = . );
    PROVIDE( heap_end   = ORIGIN(RAM) + LENGTH(RAM) - __stack_size );
    PROVIDE( _sp        = ORIGIN(RAM) + LENGTH(RAM) );

    _end = .;
}
