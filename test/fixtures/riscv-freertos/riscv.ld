/*
 * Linker script for the FreeRTOS demo on the bw-board RISC-V machine.
 * RAM is a single flat region at 0x0 (the machine resets pc to 0 and its RAM is
 * 0-based; the CLINT/PLIC/UART live above it in separate MMIO device ranges).
 */
OUTPUT_ARCH( "riscv" )
ENTRY( _start )

MEMORY
{
    RAM (rwx) : ORIGIN = 0x00000000, LENGTH = 1M
}

__stack_size = 4K;

SECTIONS
{
    .text : {
        KEEP(*(.init))
        *(.text .text.*)
        *(.rodata .rodata.*)
        *(.srodata .srodata.*)
        . = ALIGN(4);
    } > RAM

    . = ALIGN(8);
    /* Global pointer: mid-way through the small-data window for +/-2K reach. */
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
        . = ALIGN(4);
        __bss_end = .;
    } > RAM

    . = ALIGN(16);
    . = . + __stack_size;
    __stack_top = .;

    _end = .;
}
