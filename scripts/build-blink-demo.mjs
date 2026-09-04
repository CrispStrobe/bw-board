/**
 * build-blink-demo.mjs — emit rom/blink-demo.bin, the ROM behind BLINK8086:
 * the smallest thing that makes an 8086 board about PINS. It programs the 8255
 * (port B output for the LEDs, port C input for the switches), then loops:
 * walk a pattern across the LEDs and OR in whatever the switches read, so a
 * flipped switch lights its LED and the pattern keeps marching. lite's LED
 * panel draws port B's pins; its switch panel drives port C.
 *
 * LEDs are on PORT B, not PORT A, on purpose: a PC latches the keyboard
 * scancode into this same 8255's port A, so a first board that drove LEDs there
 * would raise a two-owners-of-one-port question a learner should never meet.
 *
 *   node scripts/build-blink-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const code = [];
const e = (...b) => code.push(...b);
const rel8 = (from, to) => (256 + (to - from)) & 0xff;

e(0xfa);                                // cli
e(0x31, 0xc0, 0x8e, 0xd0, 0xbc, 0x00, 0x70);   // xor ax,ax ; mov ss,ax ; mov sp,7000h
// 8255 control word 89h: mode 0, port B OUTPUT (bit1=0), port C INPUT
// (bits 0 and 3 set), port A output. Control register is 63h.
e(0xb0, 0x89, 0xe6, 0x63);              // mov al,89h ; out 63h,al
e(0xb3, 0x01);                          // mov bl,1     (the walking LED bit)

const main = code.length;
e(0xe4, 0x62);                          // in al,62h    (read port C — the switches, active LOW)
e(0xf6, 0xd0);                          // not al       (open switch reads 1; invert so CLOSED = lit)
e(0x08, 0xd8);                          // or al,bl     (OR in the walking bit, so it blinks with no input)
e(0xe6, 0x61);                          // out 61h,al   (port B — the LEDs)
e(0xd0, 0xc3);                          // rol bl,1     (march the walking bit 01->02->..->80->01)
e(0xb9, 0x00, 0x20);                    // mov cx,2000h (a visible-rate delay)
const dly = code.length;
e(0xe2, rel8(code.length + 2, dly));    // delay: loop delay
e(0xeb, rel8(code.length + 2, main));   // jmp main

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'blink-demo.bin'), rom);
console.log(`wrote rom/blink-demo.bin (${rom.length} bytes; ${code.length} bytes of code)`);
