/**
 * build-desk-demo.mjs — emit rom/desk-demo.bin, the ROM behind DESKDEMO8086:
 * the capstone that runs TWO interrupt sources at once. It hooks INT 08h (the
 * 8254 timer on IRQ0) and INT 09h (the keyboard on IRQ1), and the PIC arbitrates
 * both: every tick a live hex counter updates at the top-right, and every key
 * you press echoes onto a line below it — concurrently, each interrupt EOI'd on
 * its own. Nothing else in the tier exercises the 8259 with two live IRQ lines,
 * their priority, and two independent EOIs; the timer demo has one source and
 * the keyboard demo the other, and this proves they compose.
 *
 *   node scripts/build-desk-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const TICK_CELL = 0x008c;    // B800 row 0, col 70 — the clock
const KBD_HOME = 0x0140;     // B800 row 2, col 0 — the echo line
const COUNTER = 0x0500;      // RAM: keyboard cursor (word)
const TICKS = 0x0502;        // RAM: tick counter (word)

const TABLE = new Uint8Array(128);
const put = (base, s) => { for (let i = 0; i < s.length; i++) TABLE[base + i] = s.charCodeAt(i); };
put(0x02, '1234567890-='); put(0x10, 'qwertyuiop[]');
put(0x1e, "asdfghjkl;'"); put(0x2c, 'zxcvbnm,./'); TABLE[0x39] = 0x20;

const code = [];
const e = (...b) => code.push(...b);
const rel8 = (from, to) => (256 + (to - from)) & 0xff;

// --- init ---
e(0xfa);                                // cli
e(0x31, 0xc0, 0x8e, 0xd0, 0xbc, 0x00, 0x70);   // xor ax,ax ; mov ss,ax ; mov sp,7000h
e(0x8e, 0xc0);                          // mov es,ax  (ES=0 -> IVT)
e(0x26, 0xc7, 0x06, 0x20, 0x00); const timerImm = code.length; e(0x00, 0x00);   // [0020h]=timerISR
e(0x26, 0xc7, 0x06, 0x22, 0x00, 0x00, 0xf8);                                    // [0022h]=F800h
e(0x26, 0xc7, 0x06, 0x24, 0x00); const kbdImm = code.length; e(0x00, 0x00);     // [0024h]=kbdISR
e(0x26, 0xc7, 0x06, 0x26, 0x00, 0x00, 0xf8);                                    // [0026h]=F800h
e(0x8e, 0xd8);                          // mov ds,ax  (DS=0)
e(0xc7, 0x06, COUNTER & 0xff, COUNTER >> 8, KBD_HOME & 0xff, KBD_HOME >> 8);     // cursor = KBD_HOME
e(0xc7, 0x06, TICKS & 0xff, TICKS >> 8, 0x00, 0x00);                            // ticks = 0
e(0xb0, 0x13, 0xe6, 0x20);              // PIC ICW1
e(0xb0, 0x08, 0xe6, 0x21);              // ICW2: base 8 (IR0->INT8, IR1->INT9)
e(0xb0, 0x01, 0xe6, 0x21);              // ICW4
e(0xb0, 0xfc, 0xe6, 0x21);              // OCW1: unmask IR0 + IR1
e(0xb0, 0x36, 0xe6, 0x43);              // PIT counter0, mode 3
e(0xb0, 0x00, 0xe6, 0x40, 0xb0, 0x04, 0xe6, 0x40);   // count 0x0400
e(0xfb);                                // sti
const mainLbl = code.length;
e(0xf4); e(0xeb, rel8(code.length + 2, mainLbl));   // main: hlt ; jmp main

// --- timer ISR (INT 08h): tick counter at the top-right ---
const timerLbl = code.length;
code[timerImm] = timerLbl & 0xff; code[timerImm + 1] = timerLbl >> 8;
e(0x50, 0x53, 0x51, 0x52, 0x57, 0x1e, 0x06);   // push ax,bx,cx,dx,di,ds,es
e(0x31, 0xc0, 0x8e, 0xd8);              // xor ax,ax ; mov ds,ax
e(0xff, 0x06, TICKS & 0xff, TICKS >> 8);       // inc word [ticks]
e(0x8b, 0x1e, TICKS & 0xff, TICKS >> 8);       // mov bx,[ticks]
e(0xb8, 0x00, 0xb8, 0x8e, 0xc0);        // mov ax,0B800h ; mov es,ax
e(0x89, 0xd8);                          // mov ax,bx
e(0xbf, TICK_CELL & 0xff, TICK_CELL >> 8);     // mov di,TICK_CELL
e(0xba, 0x04, 0x00, 0xb1, 0x04);        // mov dx,4 ; mov cl,4
const tdig = code.length;
e(0xd3, 0xc0, 0x88, 0xc3, 0x80, 0xe3, 0x0f, 0x80, 0xc3, 0x30, 0x80, 0xfb, 0x39);
const tjbe = code.length; e(0x76, 0x00);
e(0x80, 0xc3, 0x07);
code[tjbe + 1] = rel8(tjbe + 2, code.length);
e(0x26, 0x88, 0x1d, 0x47, 0x26, 0xc6, 0x45, 0x01, 0x1e, 0x47, 0x4a);   // write digit + attr(1E), advance, dec dx
e(0x75, rel8(code.length + 2, tdig));   // jnz tdig
e(0xb0, 0x20, 0xe6, 0x20);              // EOI
e(0x07, 0x1f, 0x5f, 0x5a, 0x59, 0x5b, 0x58, 0xcf);   // pop es,ds,di,dx,cx,bx,ax ; iret

// --- keyboard ISR (INT 09h): echo onto the line below ---
const kbdLbl = code.length;
code[kbdImm] = kbdLbl & 0xff; code[kbdImm + 1] = kbdLbl >> 8;
e(0x50, 0x53, 0x51, 0x57, 0x1e, 0x06);  // push ax,bx,cx,di,ds,es
e(0x31, 0xc0, 0x8e, 0xd8);              // xor ax,ax ; mov ds,ax
e(0xe4, 0x60, 0x88, 0xc3);              // in al,60h ; mov bl,al
e(0xe4, 0x61, 0x88, 0xc4, 0x0c, 0x80, 0xe6, 0x61, 0x88, 0xe0, 0xe6, 0x61);   // ack strobe
e(0xf6, 0xc3, 0x80); const kjnz = code.length; e(0x75, 0x00);   // test bl,80h ; jnz kdone
e(0xb7, 0x00, 0x2e, 0x8a, 0x87); const tblImm = code.length; e(0x00, 0x00);  // mov bh,0 ; mov al,cs:[bx+table]
e(0x84, 0xc0); const kjz = code.length; e(0x74, 0x00);          // test al,al ; jz kdone
e(0xb9, 0x00, 0xb8, 0x8e, 0xc1);        // mov cx,0B800h ; mov es,cx
e(0x8b, 0x3e, COUNTER & 0xff, COUNTER >> 8);   // mov di,[cursor]
e(0x26, 0x88, 0x05, 0x26, 0xc6, 0x45, 0x01, 0x1f);   // mov es:[di],al ; mov byte es:[di+1],1Fh
e(0x83, 0x06, COUNTER & 0xff, COUNTER >> 8, 0x02);   // add word [cursor],2
const kdone = code.length;
code[kjnz + 1] = rel8(kjnz + 2, kdone);
code[kjz + 1] = rel8(kjz + 2, kdone);
e(0xb0, 0x20, 0xe6, 0x20);              // EOI
e(0x07, 0x1f, 0x5f, 0x59, 0x5b, 0x58, 0xcf);   // pop es,ds,di,cx,bx,ax ; iret

// --- scancode table ---
const tableOff = code.length;
code[tblImm] = tableOff & 0xff; code[tblImm + 1] = tableOff >> 8;
for (const b of TABLE) e(b);

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'desk-demo.bin'), rom);
console.log(`wrote rom/desk-demo.bin (${rom.length} bytes; ${tableOff} code; timerISR ${timerLbl.toString(16)}h kbdISR ${kbdLbl.toString(16)}h)`);
