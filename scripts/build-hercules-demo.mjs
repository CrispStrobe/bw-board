/**
 * build-hercules-demo.mjs — emit rom/hercules-demo.bin, the Hercules entry in
 * the display-demo set. Bare-metal, no BIOS: it un-protects graphics mode at
 * the HGC config register (3BFh bit 0), selects graphics + video-enable at the
 * mode register (3B8h), and fills the mono framebuffer at B000:0000 with a
 * 4-pixel-wide vertical-bar pattern, painting the whole 720x348 mono screen.
 *
 * HGC graphics memory: 720x348x1bpp = 30160 bytes across B000:0000 in FOUR
 * interleaved 8KB banks — scanlines mod 4 = 0 at +0x0000, =1 at +0x2000,
 * =2 at +0x4000, =3 at +0x6000, 90 bytes a line, eight pixels a byte. 0xF0 =
 * 11110000 = four pixels on, four off, so a bank filled with it is 4-wide
 * vertical bars.
 *
 *   node scripts/build-hercules-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const code = [];
const e = (...b) => code.push(...b);

e(0xfa);                                // cli
e(0x31, 0xc0);                          // xor ax,ax
e(0x8e, 0xd0, 0xbc, 0x00, 0x70);        // mov ss,ax ; mov sp,7000h
e(0xb0, 0x03, 0xba, 0xbf, 0x03, 0xee);  // mov al,03h ; mov dx,3BFh ; out dx,al  (config: graphics-enable + 2nd page allow)
e(0xb0, 0x0a, 0xba, 0xb8, 0x03, 0xee);  // mov al,0Ah ; mov dx,3B8h ; out dx,al  (mode: graphics + video enable)
e(0xb8, 0x00, 0xb0, 0x8e, 0xc0);        // mov ax,0B000h ; mov es,ax
e(0x31, 0xff);                          // xor di,di
e(0xb8, 0xf0, 0xf0);                    // mov ax,0F0F0h  (4 pixels on, 4 off)
e(0xb9, 0x00, 0x40);                    // mov cx,4000h  (16384 words = 32K = all four 8K banks)
e(0xfc);                                // cld
e(0xf3, 0xab);                          // rep stosw
e(0xeb, 0xfe);                          // jmp $   (park)

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'hercules-demo.bin'), rom);
console.log(`wrote rom/hercules-demo.bin (${rom.length} bytes; ${code.length} bytes of code)`);
