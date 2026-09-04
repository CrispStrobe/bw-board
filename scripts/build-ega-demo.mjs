/**
 * build-ega-demo.mjs — emit rom/ega-demo.bin, the EGA entry in the display-demo
 * set (ROADMAP E7.1) and the hardest. Bare-metal, no BIOS: it selects a PLANAR
 * graphics mode (mode 0Dh signature — graphics, NOT chain-4, NOT 8-bit colour),
 * loads a 16-entry attribute palette, and fills the four bit planes with
 * distinct patterns via the sequencer map mask.
 *
 * EGA planar memory: a pixel's four-bit colour is one bit from each of four
 * planes at the same A0000 offset. A write lands in every plane the Sequencer
 * Map Mask (SR2, 3C4h index 2) selects, so filling plane p means SR2 = 1<<p then
 * writing. This demo gives each plane a different byte (FF / AA / CC / F0) so the
 * plane routing is provable and the composed picture is a busy 16-colour field.
 *
 *   node scripts/build-ega-demo.mjs
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

// --- planar mode 0Dh identification registers ---
e(0xb0, 0x63, 0xba, 0xc2, 0x03, 0xee);  // mov al,63h ; mov dx,3C2h ; out dx,al   (misc)
e(0xba, 0xc4, 0x03, 0xb0, 0x04, 0xee, 0x42, 0xb0, 0x06, 0xee);   // SR4=06h: seq mem mode (NOT chain-4)
e(0xba, 0xce, 0x03, 0xb0, 0x06, 0xee, 0x42, 0xb0, 0x05, 0xee);   // GR6=05h: graphics, A0000
e(0xba, 0xce, 0x03, 0xb0, 0x05, 0xee, 0x42, 0xb0, 0x00, 0xee);   // GR5=00h: write mode 0
// attribute mode control AR10h = 01h (graphics, NOT 8-bit): reset flip-flop, index, data
e(0xba, 0xda, 0x03, 0xec);              // mov dx,3DAh ; in al,dx   (reset attr flip-flop)
e(0xba, 0xc0, 0x03, 0xb0, 0x10, 0xee);  // mov dx,3C0h ; mov al,10h ; out dx,al   (index 10h)
e(0xb0, 0x01, 0xee);                    // mov al,01h ; out dx,al   (AR10h = 01h)

// --- 16-entry attribute palette AR00-0Fh = i (a linear 16-colour ramp) ---
e(0xba, 0xda, 0x03, 0xec);              // in al,3DAh  (reset flip-flop -> index)
e(0xba, 0xc0, 0x03);                    // mov dx,3C0h
e(0x31, 0xc9);                          // xor cx,cx
const palLbl = code.length;
e(0x88, 0xc8, 0xee);                    // mov al,cl ; out dx,al   (palette index)
e(0x88, 0xc8, 0xee);                    // mov al,cl ; out dx,al   (value = index)
e(0x41);                                // inc cx
e(0x83, 0xf9, 0x10);                    // cmp cx,16
e(0x72, rel8(code.length + 2, palLbl)); // jb palLbl
// re-enable video (PAS)
e(0xba, 0xda, 0x03, 0xec);              // in al,3DAh
e(0xba, 0xc0, 0x03, 0xb0, 0x20, 0xee);  // mov dx,3C0h ; mov al,20h ; out dx,al

// --- fill the four planes with distinct bytes via the map mask ---
e(0xb8, 0x00, 0xa0, 0x8e, 0xc0);        // mov ax,0A000h ; mov es,ax
e(0xfc);                                // cld
const PLANES = [[0x01, 0xff], [0x02, 0xaa], [0x04, 0xcc], [0x08, 0xf0]];
for (const [mask, val] of PLANES) {
    e(0xba, 0xc4, 0x03, 0xb0, 0x02, 0xee, 0x42, 0xb0, mask, 0xee);   // SR2 = mask (select the plane)
    e(0x31, 0xff);                      // xor di,di
    e(0xb0, val);                       // mov al,val
    e(0xb9, 0x40, 0x1f);                // mov cx,8000   (320x200/8 = 8000 bytes/plane)
    e(0xf3, 0xaa);                      // rep stosb
}
e(0xeb, 0xfe);                          // jmp $   (park)

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset far-jump -> F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'ega-demo.bin'), rom);
console.log(`wrote rom/ega-demo.bin (${rom.length} bytes; ${code.length} bytes of code)`);
