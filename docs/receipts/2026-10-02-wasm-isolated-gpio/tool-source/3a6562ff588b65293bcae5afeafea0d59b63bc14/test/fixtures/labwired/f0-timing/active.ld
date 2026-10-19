/* SPDX-License-Identifier: MIT */
ENTRY(reset)
SECTIONS {
    . = 0x08000000;
    .vectors : { KEEP(*(.vectors)) }
    . = 0x08000100;
    .text : { *(.text*) *(.rodata*) }
    /DISCARD/ : { *(.comment) }
}
