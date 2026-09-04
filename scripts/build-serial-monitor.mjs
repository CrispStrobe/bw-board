/**
 * build-serial-monitor.mjs — emit rom/serial-monitor.bin, the ROM behind the
 * SERIALSHELL8086 example. It is the smallest thing that makes an 8086 "boot
 * when you open it": configure a 16550 UART, print a banner, then echo every
 * byte typed back to the terminal. That is the UART-shell example the owner
 * asked for — the 8086's counterpart to the Z80/6502 serial monitors.
 *
 * The UART sits at port 10h (the BREADBOARD8086 / SERIALSHELL8086 map): THR
 * and RBR at 10h, LCR at 13h, LSR at 15h. LSR bit 0 = a received byte waits,
 * bit 5 = the transmitter is ready.
 *
 *   node scripts/build-serial-monitor.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const romDir = join(here, '..', 'rom');

const BANNER = '8086 serial shell - type and it echoes\r\n> ';

const code = [];
const e = (...b) => code.push(...b);

// --- init: DS = CS so the banner (in this ROM segment) is addressable, then
//     LCR = 8N1, DLAB clear. Reset leaves CS = F800 but DS = 0, so without
//     this the banner read hits segment 0 (RAM) and prints nothing. ---
e(0x8c, 0xc8, 0x8e, 0xd8);              // mov ax,cs ; mov ds,ax
e(0xb0, 0x03, 0xe6, 0x13);              // mov al,03h ; out 13h,al

// --- print the banner: SI walks it, 0 terminates ---
// mov si, <banner offset>  (filled once the code length is known)
const movSiAt = code.length;
e(0xbe, 0x00, 0x00);                    // mov si, imm16 (patched below)
//   print:  mov al,[si] ; test al,al ; jz echo ; <putc> ; inc si ; jmp print
const printLbl = code.length;
e(0x8a, 0x04);                          // mov al,[si]
e(0x84, 0xc0);                          // test al,al
const jzToEcho = code.length;
e(0x74, 0x00);                          // jz echo  (rel patched below)
// putc(al): save char in AH, wait LSR bit5, restore, out 10h
e(0x88, 0xc4);                          // mov ah,al
const w1 = code.length;
e(0xe4, 0x15, 0xa8, 0x20);              // in al,15h ; test al,20h
e(0x74, (256 + (w1 - (code.length + 2))) & 0xff);  // jz w1
e(0x88, 0xe0, 0xe6, 0x10);              // mov al,ah ; out 10h,al
e(0x46);                                // inc si
e(0xeb, (256 + (printLbl - (code.length + 2))) & 0xff);   // jmp print

// --- echo loop ---
const echoLbl = code.length;
code[jzToEcho + 1] = (256 + (echoLbl - (jzToEcho + 2))) & 0xff;   // patch jz echo
const r1 = code.length;
e(0xe4, 0x15, 0xa8, 0x01);              // in al,15h ; test al,01h  (RX ready?)
e(0x74, (256 + (r1 - (code.length + 2))) & 0xff);        // jz r1
e(0xe4, 0x10);                          // in al,10h  (read RBR)
e(0x88, 0xc4);                          // mov ah,al
const t1 = code.length;
e(0xe4, 0x15, 0xa8, 0x20);              // in al,15h ; test al,20h  (TX ready?)
e(0x74, (256 + (t1 - (code.length + 2))) & 0xff);        // jz t1
e(0x88, 0xe0, 0xe6, 0x10);              // mov al,ah ; out 10h,al  (echo)
e(0xeb, (256 + (echoLbl - (code.length + 2))) & 0xff);   // jmp echo

// the banner goes right after the code; patch the mov si offset
const bannerOff = code.length;
code[movSiAt + 1] = bannerOff & 0xff;
code[movSiAt + 2] = (bannerOff >> 8) & 0xff;
for (const ch of BANNER) {
    const c = ch.charCodeAt(0);
    if (c > 0x7f) throw new Error(`banner has a non-ASCII char (${JSON.stringify(ch)}) — it would be truncated into a control byte`);
    e(c);
}
e(0x00);

// --- assemble the 32K ROM image: code at 0, reset far-jump at the top ---
const rom = new Uint8Array(0x8000);
rom.set(code, 0);
rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000

mkdirSync(romDir, { recursive: true });
writeFileSync(join(romDir, 'serial-monitor.bin'), rom);
console.log(`wrote rom/serial-monitor.bin (${rom.length} bytes; ${code.length} bytes of code + banner)`);
