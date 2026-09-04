/**
 * build-cga-gfx-demo.mjs — emit rom/cga-gfx-demo.bin, the GRAPHICS companion to
 * the CGA text demo. Same board (CGADEMO8086), no BIOS: it selects CGA mode 4
 * (320x200, 4 colours) straight at the mode register and fills the text page's
 * two interleaved banks with a repeating 2-bit pattern, painting vertical
 * colour bars — black / cyan / magenta / white under palette 1. The renderer
 * (i8086-debug.js modeFromCga -> renderMode 'cga4') decodes it from the mode
 * register alone, so the board boots into a graphics screen with nothing but
 * hardware. lego-47 proved the decode path in-process before this was built.
 *
 * CGA mode 4 memory: 320x200x2bpp = 16000 bytes across B800:0000, split into
 * two banks — even scanlines at +0x0000, odd scanlines at +0x2000, 80 bytes a
 * line, four pixels a byte (bits 7-6 = leftmost pixel). 0x1B = 00 01 10 11 =
 * colours 0,1,2,3, so a bank filled with 0x1B is vertical bars every 4 pixels.
 *
 *   node scripts/build-cga-gfx-demo.mjs
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
e(0xb0, 0x0a, 0xba, 0xd8, 0x03, 0xee);  // mov al,0Ah ; mov dx,3D8h ; out dx,al  (mode 4: graphics + enable)
e(0xb0, 0x30, 0xba, 0xd9, 0x03, 0xee);  // mov al,30h ; mov dx,3D9h ; out dx,al  (palette 1, high intensity)
e(0xb8, 0x00, 0xb8, 0x8e, 0xc0);        // mov ax,0B800h ; mov es,ax
e(0x31, 0xff);                          // xor di,di
e(0xb8, 0x1b, 0x1b);                    // mov ax,1B1Bh  (four pixels: colours 0,1,2,3)
e(0xb9, 0x00, 0x20);                    // mov cx,2000h  (8192 words = 16K = both banks, 0000h-3FFFh)
e(0xfc);                                // cld
e(0xf3, 0xab);                          // rep stosw
e(0xeb, 0xfe);                          // jmp $   (park; no interrupts)

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'cga-gfx-demo.bin'), rom);
console.log(`wrote rom/cga-gfx-demo.bin (${rom.length} bytes; ${code.length} bytes of code)`);
