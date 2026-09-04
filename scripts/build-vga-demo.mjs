/**
 * build-vga-demo.mjs — emit rom/vga-demo.bin, the VGA entry in the display-demo
 * set (ROADMAP E7.1) and the second display board that actually renders. Bare-
 * metal, no BIOS: it sets exactly the four register bits the renderer's
 * modeFromVga keys off for mode 13h, then paints the linear framebuffer at
 * A000:0000 with 200 horizontal colour bands (row y = palette entry y), which
 * VdpScreen draws in colour.
 *
 * The mode-13h discriminator (per lego-47's src/i8086-debug.js:73), nothing
 * else is read to identify the mode:
 *   misc (3C2h)      != 0        -- the card was programmed at all
 *   gc[06h] (3CFh)   bit 0 = 1   -- graphics, not alphanumeric
 *   seq[04h] (3C5h)  bit 3 = 1   -- chain-4
 *   attr[10h] (3C0h) bit 6 = 1   -- 8-bit colour
 * Standard values (GR6=05h, SR4=0Eh, AR10h=41h, misc=63h) satisfy all four and
 * are what real mode-13h setup writes. The 320x200 geometry and A0000 base are
 * constants in the renderer's mode table, NOT derived from the CRTC, so the
 * CRTC is left alone. No DAC writes: the renderer falls back to the real VGA
 * power-on 256-colour palette when the DAC is all zero, which is the correct
 * palette for free (an all-zero DAC would be ignored anyway).
 *
 *   node scripts/build-vga-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const code = [];
const e = (...b) => code.push(...b);

e(0xfa);                                // cli
e(0x31, 0xc0, 0x8e, 0xd0, 0xbc, 0x00, 0x70);   // xor ax,ax ; mov ss,ax ; mov sp,7000h

// --- mode 13h identification ---
e(0xb0, 0x63, 0xba, 0xc2, 0x03, 0xee);  // mov al,63h ; mov dx,3C2h ; out dx,al   (misc output)
e(0xba, 0xce, 0x03, 0xb0, 0x06, 0xee, 0x42, 0xb0, 0x05, 0xee);   // GR6=05h: mov dx,3CEh;al,06;out;inc dx(3CF);al,05;out
e(0xba, 0xc4, 0x03, 0xb0, 0x04, 0xee, 0x42, 0xb0, 0x0e, 0xee);   // SR4=0Eh: mov dx,3C4h;al,04;out;inc dx(3C5);al,0E;out
e(0xba, 0xda, 0x03, 0xec);              // mov dx,3DAh ; in al,dx   (reset the attribute flip-flop)
e(0xba, 0xc0, 0x03, 0xb0, 0x10, 0xee);  // mov dx,3C0h ; mov al,10h ; out dx,al   (attr index 10h)
e(0xb0, 0x41, 0xee);                    // mov al,41h ; out dx,al   (attr[10h] = 41h, bit6 = 8-bit colour)
e(0xb0, 0x20, 0xee);                    // mov al,20h ; out dx,al   (PAS: re-enable video)

// --- paint A000:0000 with 200 horizontal colour bands (row y = colour y) ---
e(0xb8, 0x00, 0xa0, 0x8e, 0xc0);        // mov ax,0A000h ; mov es,ax
e(0x31, 0xff);                          // xor di,di
e(0x30, 0xc0);                          // xor al,al           (colour = 0)
e(0xba, 0xc8, 0x00);                    // mov dx,200          (row counter)
e(0xfc);                                // cld
const rowLbl = code.length;
e(0xb9, 0x40, 0x01);                    // mov cx,320
e(0xf3, 0xaa);                          // rep stosb           (fill one row with AL)
e(0xfe, 0xc0);                          // inc al              (next row -> next colour)
e(0x4a);                                // dec dx
e(0x75, (256 + (rowLbl - (code.length + 2))) & 0xff);   // jnz rowLbl
e(0xeb, 0xfe);                          // jmp $   (park)

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'vga-demo.bin'), rom);
console.log(`wrote rom/vga-demo.bin (${rom.length} bytes; ${code.length} bytes of code)`);
