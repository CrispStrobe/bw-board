/* SPDX-License-Identifier: MIT
 * Free bounded real-mode cold-reset ROM; no BIOS or media dependency.
 */
.intel_syntax noprefix
.code16
.section .text
.org 0x100, 0xff
.global cold_start, cold_halt_end
cold_start:
 cli
 xor ax, ax
 mov ds, ax
 mov es, ax
 mov ss, ax
 mov sp, 0x9000
 /* Preserve raw reset differences as guest-produced RAM, before normalization. */
 mov dword ptr [0x510], edx
 mov eax, cr0
 mov dword ptr [0x514], eax
 mov eax, 0
 mov edx, 0x12345678
 mov word ptr [0x500], 0x5aa5
 mov ax, word ptr [0x500]
 mov ax, 0xf000
 mov es, ax
 mov byte ptr es:[0x200], 0
 mov al, byte ptr es:[0x200]
 mov byte ptr [0x502], al
 mov ax, 0xc000
 mov es, ax
 mov al, byte ptr es:[0]
 mov byte ptr [0x503], al
 mov byte ptr es:[0], 0x12
 mov al, byte ptr es:[0]
 mov byte ptr [0x504], al
 mov ax, 0
 mov es, ax
 mov bx, 0x1357
 mov cx, 0x2468
 mov si, 0x369c
 mov di, 0x4567
 mov bp, 0x5678
 mov al, 'C'
 out 0xe9, al
 mov al, 'R'
 out 0xe9, al
 mov al, 'S'
 out 0xe9, al
 mov al, 'T'
 out 0xe9, al
 mov al, '0'
 out 0xe9, al
 mov al, '0'
 out 0xe9, al
 mov al, '1'
 out 0xe9, al
 cli
 hlt
cold_halt_end:
.org 0x200, 0xff
.byte 0xa7
.org 0xfff0, 0xff
.byte 0xea, 0x00, 0x01, 0x00, 0xf0 /* JMP F000:0100 */
.org 0x10000, 0xff
