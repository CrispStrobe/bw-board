/* SPDX-License-Identifier: MIT
 * Guest-created executable RAM, operand SMC, and actual 8042 A20 alias oracle.
 * No RAM is preseeded; every instruction byte below is written by this ROM.
 */
.intel_syntax noprefix
.code16
.section .text
.org 0x100, 0xff
.global ram_start, ram_halt_end
ram_start:
 cli
 xor ax, ax
 mov ds, ax
 mov es, ax
 mov ss, ax
 mov sp, 0x9000
 mov dword ptr [0x510], edx
 mov eax, cr0
 mov dword ptr [0x514], eax
 mov eax, 0
 mov edx, 0x12345678
 /* BB imm16 CB = MOV BX,imm16; RETF. Far calls serialize each entry. */
 mov dword ptr [0x7000], 0xcb1111bb
 mov ax, 0xffff
 mov es, ax
 mov dword ptr es:[0x7010], 0xcb3333bb
 .byte 0x9a,0x00,0x70,0x00,0x00 /* CALL 0000:7000 */
 mov word ptr [0x520], bx
 mov word ptr [0x7001], 0x2222
 .byte 0x9a,0x00,0x70,0x00,0x00
 mov word ptr [0x522], bx
 mov al, 0xd1
 out 0x64, al
 mov al, 0x01 /* keep reset bit high, lower the 8042 A20 source */
 out 0x60, al
 .byte 0x9a,0x10,0x70,0xff,0xff /* FFFF:7010 = raw 00107000 */
 mov word ptr [0x524], bx
 /* Admit LOW again in the same OFF mapping epoch as the raw HIGH alias. */
 .byte 0x9a,0x00,0x70,0x00,0x00
 mov word ptr [0x526], bx
 /* Both raw execute aliases are cached now. A raw high write aliases LOW. */
 mov word ptr es:[0x7011], 0x5555
 .byte 0x9a,0x00,0x70,0x00,0x00
 mov word ptr [0x528], bx
 .byte 0x9a,0x10,0x70,0xff,0xff
 mov word ptr [0x52a], bx
 mov al, 0xd1
 out 0x64, al
 mov al, 0x03
 out 0x60, al
 .byte 0x9a,0x10,0x70,0xff,0xff
 mov word ptr [0x52c], bx
 mov word ptr es:[0x7011], 0x4444
 .byte 0x9a,0x10,0x70,0xff,0xff
 mov word ptr [0x52e], bx
 mov al, 'R'
 out 0xe9, al
 mov al, 'A'
 out 0xe9, al
 mov al, 'M'
 out 0xe9, al
 mov al, 'A'
 out 0xe9, al
 mov al, '0'
 out 0xe9, al
 mov al, '0'
 out 0xe9, al
 mov al, '1'
 out 0xe9, al
 cli
 hlt
ram_halt_end:
.org 0xfff0, 0xff
.byte 0xea,0x00,0x01,0x00,0xf0
.org 0x10000,0xff
