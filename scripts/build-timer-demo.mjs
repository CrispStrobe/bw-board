/**
 * build-timer-demo.mjs — emit rom/timer-demo.bin, the ROM behind the
 * TIMERDEMO8086 example. It is the one idea worth taking from the MIT-licensed
 * "Learn Assembly the Hard Way" coursework (a timer.asm that hooks INT 8 and
 * shows a tick counter): rewritten clean and own-authored, because that program
 * is the smallest thing that exercises the WHOLE interrupt chain this tier
 * builds — 8254 OUT0 -> 8259 IR0 -> CPU INT 8 -> our ISR -> the CGA text page
 * -> EOI. The other two examples are straight-line; this one proves interrupts
 * are delivered and serviced while the CPU runs.
 *
 * What it does: program the PIC (IR0 -> vector 8) and PIT counter 0 (a short
 * repeating count so it ticks often), point IVT[8] at an ISR, enable
 * interrupts, and HLT. Each timer tick the ISR increments a counter in RAM and
 * paints it as four hex digits near the top-right of the B800 text page, then
 * sends EOI. The screen shows a live, climbing counter with no BIOS and no DOS.
 *
 *   node scripts/build-timer-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const CS = 0xf800;            // where this ROM's code segment lives
const COUNTER = 0x0500;      // first free low RAM (above IVT and the BIOS data area)
const CELL = 0x008c;         // B800 offset: row 0, col 70 -> (70)*2 = 140 = 0x8C
const ATTR = 0x1e;           // yellow on blue

const code = [];
const e = (...b) => code.push(...b);
const rel8 = (from, to) => (256 + (to - from)) & 0xff;   // signed 8-bit displacement

// --- init: stack, then hook INT 8, program the PIC and the PIT ---
e(0xfa);                                // cli
e(0x31, 0xc0);                          // xor ax,ax
e(0x8e, 0xd0);                          // mov ss,ax
e(0xbc, 0x00, 0x70);                    // mov sp,7000h   (a stack in RAM for the interrupt pushes)
e(0x8e, 0xc0);                          // mov es,ax      (ES=0 -> address the IVT at 0000:0)

// IVT[8]: offset at 0:20h, segment at 0:22h. The offset is a forward ref to
// isr; remember where its immediate lands and patch it once isr is placed.
e(0x26, 0xc7, 0x06, 0x20, 0x00);        // mov word [es:0020h],
const isrImmAt = code.length;
e(0x00, 0x00);                          //   <isr offset> (patched)
e(0x26, 0xc7, 0x06, 0x22, 0x00, CS & 0xff, (CS >> 8) & 0xff);   // mov word [es:0022h], 0F800h

// PIC (XT 8259 at 20h/21h): ICW1 single+ICW4, ICW2 base 8 (IR0->INT 8),
// ICW4 8086 mode, OCW1 unmask IR0 only.
e(0xb0, 0x13, 0xe6, 0x20);              // mov al,13h ; out 20h,al
e(0xb0, 0x08, 0xe6, 0x21);              // mov al,08h ; out 21h,al
e(0xb0, 0x01, 0xe6, 0x21);              // mov al,01h ; out 21h,al
e(0xb0, 0xfe, 0xe6, 0x21);              // mov al,0FEh; out 21h,al

// PIT (8254 at 40h/43h): counter 0, lo+hi, mode 3 (square wave), count 0200h.
e(0xb0, 0x36, 0xe6, 0x43);              // mov al,36h ; out 43h,al
e(0xb0, 0x00, 0xe6, 0x40);              // mov al,00h ; out 40h,al  (count LSB)
e(0xb0, 0x02, 0xe6, 0x40);              // mov al,02h ; out 40h,al  (count MSB -> 0x0200)

// zero the RAM counter (DS=0 already? no — set it): xor ax,ax done; DS=0
e(0x8e, 0xd8);                          // mov ds,ax   (DS=0 for the counter word)
e(0xc7, 0x06, COUNTER & 0xff, (COUNTER >> 8) & 0xff, 0x00, 0x00);   // mov word [0500h],0

e(0xfb);                                // sti
// main: hlt ; jmp main  — halt until a tick, service it, halt again.
const mainLbl = code.length;
e(0xf4);                                // hlt
e(0xeb, rel8(code.length + 2, mainLbl));   // jmp main

// --- the timer ISR (vector 8) ---
const isrLbl = code.length;
code[isrImmAt] = isrLbl & 0xff;
code[isrImmAt + 1] = (isrLbl >> 8) & 0xff;

e(0x50, 0x53, 0x51, 0x52, 0x57, 0x1e, 0x06);   // push ax,bx,cx,dx,di,ds,es
e(0x31, 0xc0, 0x8e, 0xd8);              // xor ax,ax ; mov ds,ax   (DS=0 -> the counter)
e(0xff, 0x06, COUNTER & 0xff, (COUNTER >> 8) & 0xff);   // inc word [0500h]
e(0x8b, 0x1e, COUNTER & 0xff, (COUNTER >> 8) & 0xff);   // mov bx,[0500h]
e(0xb8, 0x00, 0xb8, 0x8e, 0xc0);        // mov ax,0B800h ; mov es,ax
e(0x89, 0xd8);                          // mov ax,bx           (value to print)
e(0xbf, CELL & 0xff, (CELL >> 8) & 0xff);   // mov di, CELL
e(0xba, 0x04, 0x00);                    // mov dx,4            (four hex digits)
e(0xb1, 0x04);                          // mov cl,4            (nibble shift)
const digitLbl = code.length;
e(0xd3, 0xc0);                          // rol ax,cl           (next nibble -> low)
e(0x88, 0xc3);                          // mov bl,al
e(0x80, 0xe3, 0x0f);                    // and bl,0Fh
e(0x80, 0xc3, 0x30);                    // add bl,'0'
e(0x80, 0xfb, 0x39);                    // cmp bl,'9'
const jbeAt = code.length;
e(0x76, 0x00);                          // jbe nz              (rel patched)
e(0x80, 0xc3, 0x07);                    // add bl,7            ('A'..'F')
const nzLbl = code.length;
code[jbeAt + 1] = rel8(jbeAt + 2, nzLbl);
e(0x26, 0x88, 0x1d);                    // mov es:[di],bl      (glyph)
e(0x47);                                // inc di
e(0x26, 0xc6, 0x05, ATTR);              // mov byte es:[di],ATTR
e(0x47);                                // inc di
e(0x4a);                                // dec dx
e(0x75, rel8(code.length + 2, digitLbl));   // jnz digit
e(0xb0, 0x20, 0xe6, 0x20);              // mov al,20h ; out 20h,al   (non-specific EOI)
e(0x07, 0x1f, 0x5f, 0x5a, 0x59, 0x5b, 0x58);   // pop es,ds,di,dx,cx,bx,ax
e(0xcf);                                // iret

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, CS & 0xff, (CS >> 8) & 0xff], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'timer-demo.bin'), rom);
console.log(`wrote rom/timer-demo.bin (${rom.length} bytes; ${code.length} bytes of code; isr at ${isrLbl.toString(16)}h)`);
