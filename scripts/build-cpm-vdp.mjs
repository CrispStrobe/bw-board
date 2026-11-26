// Generate the optional CP/M BIOS with the TMS9918A console entry points.
// Pasmo 0.5.3 is also used by roms/cpm/PROVENANCE for the original BIOS.
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FUNSCII} from '../src/funscii-font.js';

const root = new URL('../roms/cpm/', import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'cpm-vdp-'));
try {
    for (const file of ['bios.asm', 'vdp-console.asm']) {
        copyFileSync(new URL(file, root), join(temp, file));
    }
    // TMS9918A text mode takes six MSB-first pixels per row. FUNSCII is
    // LSB-first with eight pixels, so keep the central six and reverse them.
    const font = FUNSCII.slice(32 * 8, 127 * 8).map(row => {
        let pixels = 0;
        for (let col = 0; col < 6; col++) pixels |= ((row >> (col + 1)) & 1) << (7 - col);
        return pixels;
    });
    writeFileSync(join(temp, 'vdp-font.bin'), font);
    execFileSync(process.env.PASMO || 'pasmo',
        ['--equ', 'VDP_CONSOLE=1', 'bios.asm', 'bios-vdp.bin'], {cwd: temp, stdio: 'inherit'});
    const bios = readFileSync(join(temp, 'bios-vdp.bin'));
    if (bios.length > 0x600) throw new Error(`VDP BIOS exceeds the 0xFA00–0xFFFF window: ${bios.length} bytes`);
    writeFileSync(new URL('bios-vdp.bin', root), bios);
} finally {
    rmSync(temp, {recursive: true, force: true});
}
