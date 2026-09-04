/**
 * build-keyboard-demo.mjs — emit rom/keyboard-demo.bin, the ROM behind
 * KBDDEMO8086: the INPUT counterpart to the display/timer demos. Bare-metal, no
 * BIOS, it proves the XT keyboard hardware path end to end.
 *
 * It hooks INT 09h, programs the PIC to unmask IRQ1, and spins in HLT. Each
 * keypress (machine.keyIn latches the scancode at 8255 port A / port 60h and
 * raises IRQ1) fires the ISR, which:
 *   1. reads the scancode from 60h,
 *   2. ACKNOWLEDGES via the port-B strobe — read 61h, set bit 7 (clears the
 *      latch and drops IRQ1 on the rising edge), clear bit 7 — the exact
 *      sequence the BIOS's int09 uses,
 *   3. ignores break codes (bit 7 of the scancode),
 *   4. translates the set-1 make code to ASCII and echoes it to the CGA text
 *      page at a walking cursor,
 *   5. issues its own EOI (20h -> 20h). Without this the PIC keeps IRQ1 in
 *      service and exactly ONE key ever arrives.
 *
 * This is the first thing in the tier to drive the 8259's IRQ1 path for real
 * (setIRQ / priority / acknowledge / EOI) rather than cpu.interrupt(9) direct.
 *
 *   node scripts/build-keyboard-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

// --- set-1 make-code -> ASCII, the printable subset (0 = ignore) ---
const TABLE = new Uint8Array(128);
const put = (base, s) => { for (let i = 0; i < s.length; i++) TABLE[base + i] = s.charCodeAt(i); };
put(0x02, '1234567890-=');   // 02..0D
put(0x10, 'qwertyuiop[]');   // 10..1B
put(0x1e, "asdfghjkl;'");    // 1E..28
put(0x2c, 'zxcvbnm,./');     // 2C..35
TABLE[0x39] = 0x20;          // space

const code = [];
const e = (...b) => code.push(...b);
const rel8 = (from, to) => (256 + (to - from)) & 0xff;

// --- init ---
e(0xfa);                                // cli
e(0x31, 0xc0, 0x8e, 0xd0, 0xbc, 0x00, 0x70);   // xor ax,ax ; mov ss,ax ; mov sp,7000h
e(0x8e, 0xc0);                          // mov es,ax   (ES=0 -> IVT)
e(0x26, 0xc7, 0x06, 0x24, 0x00);        // mov word [es:0024h],
const isrImmAt = code.length;
e(0x00, 0x00);                          //   <isr offset> (patched)
e(0x26, 0xc7, 0x06, 0x26, 0x00, 0x00, 0xf8);   // mov word [es:0026h], 0F800h
e(0x8e, 0xd8);                          // mov ds,ax   (DS=0 -> cursor)
e(0xc7, 0x06, 0x00, 0x05, 0x00, 0x00);  // mov word [0500h], 0   (cursor = 0)
e(0xb0, 0x13, 0xe6, 0x20);              // mov al,13h ; out 20h,al  (ICW1)
e(0xb0, 0x08, 0xe6, 0x21);              // mov al,08h ; out 21h,al  (ICW2: IR1 -> INT 9)
e(0xb0, 0x01, 0xe6, 0x21);              // mov al,01h ; out 21h,al  (ICW4)
e(0xb0, 0xfd, 0xe6, 0x21);              // mov al,0FDh; out 21h,al  (OCW1: unmask IR1 only)
e(0xfb);                                // sti
const mainLbl = code.length;
e(0xf4);                                // main: hlt
e(0xeb, rel8(code.length + 2, mainLbl));   // jmp main

// --- ISR (INT 09h) ---
const isrLbl = code.length;
code[isrImmAt] = isrLbl & 0xff;
code[isrImmAt + 1] = (isrLbl >> 8) & 0xff;

e(0x50, 0x53, 0x51, 0x57, 0x1e, 0x06);  // push ax,bx,cx,di,ds,es
e(0x31, 0xc0, 0x8e, 0xd8);              // xor ax,ax ; mov ds,ax   (DS=0 -> cursor)
e(0xe4, 0x60);                          // in al,60h    (scancode)
e(0x88, 0xc3);                          // mov bl,al    (save scancode)
// acknowledge: port-B bit-7 strobe high then low
e(0xe4, 0x61);                          // in al,61h
e(0x88, 0xc4);                          // mov ah,al
e(0x0c, 0x80, 0xe6, 0x61);              // or al,80h ; out 61h,al   (strobe HIGH -> clears latch, drops IRQ1)
e(0x88, 0xe0, 0xe6, 0x61);              // mov al,ah ; out 61h,al   (back LOW)
// ignore break codes (bit 7 of the scancode)
e(0xf6, 0xc3, 0x80);                    // test bl,80h
const jnzDone1 = code.length;
e(0x75, 0x00);                          // jnz done (patched)
// translate: al = cs:[table + scancode]
e(0xb7, 0x00);                          // mov bh,0   (bx = scancode)
e(0x2e, 0x8a, 0x87);                    // mov al, cs:[bx +
const tableImmAt = code.length;
e(0x00, 0x00);                          //   table] (patched)
e(0x84, 0xc0);                          // test al,al
const jzDone = code.length;
e(0x74, 0x00);                          // jz done (patched)
// echo to B800 at the walking cursor
e(0xb9, 0x00, 0xb8, 0x8e, 0xc1);        // mov cx,0B800h ; mov es,cx
e(0x8b, 0x3e, 0x00, 0x05);              // mov di,[0500h]   (cursor)
e(0x26, 0x88, 0x05);                    // mov es:[di], al  (glyph)
e(0x26, 0xc6, 0x45, 0x01, 0x07);        // mov byte es:[di+1], 07h  (attribute)
e(0x83, 0x06, 0x00, 0x05, 0x02);        // add word [0500h], 2   (advance cursor)
const doneLbl = code.length;
code[jnzDone1 + 1] = rel8(jnzDone1 + 2, doneLbl);
code[jzDone + 1] = rel8(jzDone + 2, doneLbl);
e(0xb0, 0x20, 0xe6, 0x20);              // done: mov al,20h ; out 20h,al   (EOI)
e(0x07, 0x1f, 0x5f, 0x59, 0x5b, 0x58);  // pop es,ds,di,cx,bx,ax
e(0xcf);                                // iret

// --- the scancode table, right after the code ---
const tableOff = code.length;
code[tableImmAt] = tableOff & 0xff;
code[tableImmAt + 1] = (tableOff >> 8) & 0xff;
for (const b of TABLE) e(b);

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'keyboard-demo.bin'), rom);
console.log(`wrote rom/keyboard-demo.bin (${rom.length} bytes; ${tableOff} bytes of code + 128-byte table; isr at ${isrLbl.toString(16)}h)`);
