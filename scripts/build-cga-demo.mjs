/**
 * build-cga-demo.mjs — emit rom/cga-demo.bin, the ROM behind the CGADEMO8086
 * example: the display counterpart to the serial shell. It selects CGA text
 * mode, writes a message straight into the text page at B800:0000 (each cell
 * is a character byte then an attribute byte), and parks. The VdpScreen widget
 * renders that page, so the board "boots into a screen" with no BIOS.
 *
 *   node scripts/build-cga-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const MSG = '8086 PC/XT - CGA text ready';
const ATTR = 0x1f;   // white on blue

const code = [];
const e = (...b) => code.push(...b);

e(0x8c, 0xc8, 0x8e, 0xd8);              // mov ax,cs ; mov ds,ax  (address the message)
e(0xb8, 0x00, 0xb8, 0x8e, 0xc0);       // mov ax,0B800h ; mov es,ax  (ES -> CGA text page)
e(0xb0, 0x29, 0xba, 0xd8, 0x03, 0xee); // mov al,29h ; mov dx,3D8h ; out dx,al  (mode 3: 80x25 text)

const movSiAt = code.length;
e(0xbe, 0x00, 0x00);                    // mov si, <msg offset> (patched)
e(0x31, 0xff);                          // xor di,di

const loopLbl = code.length;
e(0x8a, 0x04);                          // mov al,[si]
e(0x84, 0xc0);                          // test al,al
const jzToDone = code.length;
e(0x74, 0x00);                          // jz done (patched)
e(0x26, 0x88, 0x05);                    // mov es:[di], al   (character cell)
e(0x47);                                // inc di
e(0xb0, ATTR, 0x26, 0x88, 0x05);        // mov al,ATTR ; mov es:[di], al  (attribute cell)
e(0x47);                                // inc di
e(0x46);                                // inc si
e(0xeb, (256 + (loopLbl - (code.length + 2))) & 0xff);   // jmp loop

const doneLbl = code.length;
code[jzToDone + 1] = (256 + (doneLbl - (jzToDone + 2))) & 0xff;   // patch jz done
e(0xeb, 0xfe);                          // done: jmp $  (park)

const msgOff = code.length;
code[movSiAt + 1] = msgOff & 0xff;
code[movSiAt + 2] = (msgOff >> 8) & 0xff;
for (const ch of MSG) {
    const c = ch.charCodeAt(0);
    if (c > 0x7f) throw new Error(`message has a non-ASCII char ${JSON.stringify(ch)}`);
    e(c);
}
e(0x00);

const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'cga-demo.bin'), rom);
console.log(`wrote rom/cga-demo.bin (${rom.length} bytes; ${code.length} bytes of code + message)`);
