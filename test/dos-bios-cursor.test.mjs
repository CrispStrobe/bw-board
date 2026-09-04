// WHOSE CURSOR IS IT, when a real BIOS ROM owns INT 10h?
//
// `install({vectors: DOS_VECTORS})` exists so a machine can have BOTH: the
// ROM's INT 10h/13h/16h/1Ah, and the DOS layer's INT 20h-2Fh on top. On such a
// machine INT 10h/AH=02h never reaches the DOS layer -- the ROM handles it and
// keeps the cursor in the BDA at 0040:0050.
//
// The DOS layer's putChar used a PRIVATE cursor variable regardless, so every
// INT 21h string printed from (0,0) no matter where the program had put the
// cursor. Found by running a real game: Breakout's playfield drew correctly
// (INT 10h) while its HUD landed in the top-left corner (INT 21h). Both halves
// of the program were right; the two services disagreed about where the cursor
// was.
//
// Real DOS avoids this by never touching video memory -- it calls INT 10h and
// lets the BIOS place the character. Reaching the ROM's handler from inside a
// JS service would mean executing 8086 code mid-call, so this shares the BDA
// cell the ROM uses instead. Same observable result: one cursor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { assembleRaw } from '../src/i8086-asm.js';
import { buildBios } from '../scripts/build-bios.mjs';
import { createDos8086, DOS_VECTORS, trapRegion } from '../src/i8086-dos.js';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';

const rom = buildBios().bytes;
const NULL_BOARD = { advanceTo() {}, setPin() {} };
const VRAM = 0xb8000, COLS = 80;
const cell = (row, col) => VRAM + (row * COLS + col) * 2;
const BDA_CURSOR = 0x400 + 0x50;

/** A machine with the real ROM AND the DOS layer, DOS claiming only 20h-2Fh. */
async function romPlusDos() {
    const config = {
        ...PCXT8086,
        regions: [...PCXT8086.regions, trapRegion()],
    };
    const { adapter } = await createDebugTarget('i8086', { config, rom, board: NULL_BOARD });
    const m = adapter.machine;
    let n = 0;
    while (n < 3_000_000 && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, 'POST did not reach its HLT');
    const dos = createDos8086(m).install({ vectors: DOS_VECTORS });
    return { m, dos };
}

test('an INT 21h string lands where INT 10h put the cursor, not at (0,0)', async () => {
    const { m, dos } = await romPlusDos();
    // Exactly the reported repro: the ROM moves the cursor, then DOS prints.
    const src = [
        ' mov ah, 02h', ' mov bh, 0', ' mov dh, 10', ' mov dl, 20', ' int 10h',
        ' mov ah, 09h', ' mov dx, offset msg', ' int 21h',
        ' mov ax, 4c00h', ' int 21h',
        'msg: db "HUD$"',
    ].join('\n');
    dos.loadCom(assembleRaw(src, 0x100));
    dos.run(2_000_000);

    assert.equal(String.fromCharCode(m.mem[cell(10, 20)]), 'H',
        'the string printed at row 10 col 20, where INT 10h left the cursor. '
        + 'Before this fix it printed at (0,0) while the BIOS correctly reported '
        + '(10,20) -- two services, two cursors, both internally consistent');
    assert.equal(String.fromCharCode(m.mem[cell(10, 21)]), 'U');
    assert.equal(String.fromCharCode(m.mem[cell(10, 22)]), 'D');
    assert.notEqual(String.fromCharCode(m.mem[cell(0, 0)]), 'H',
        'and nothing was written to the top-left corner');
});

test('DOS advances the BIOS cursor, so the ROM sees where DOS got to', async () => {
    const { m, dos } = await romPlusDos();
    dos.loadCom(assembleRaw([
        ' mov ah, 02h', ' mov bh, 0', ' mov dh, 5', ' mov dl, 3', ' int 10h',
        ' mov ah, 09h', ' mov dx, offset msg', ' int 21h',
        ' mov ax, 4c00h', ' int 21h',
        'msg: db "abc$"',
    ].join('\n'), 0x100));
    dos.run(2_000_000);
    // The cursor must have moved three cells, IN THE BDA -- the direction the
    // original bug did not travel either. A one-way fix would leave the ROM
    // overwriting what DOS just printed.
    assert.equal(m.mem[BDA_CURSOR], 6, 'column advanced from 3 to 6');
    assert.equal(m.mem[BDA_CURSOR + 1], 5, 'still on row 5');
});

test('with NO ROM, DOS owns INT 10h and its own cursor still works', async () => {
    // The other half of the ownership question, and the reason the fix is a
    // branch rather than a rewrite: on a Tier B machine there is no BDA cursor
    // to share because there is no BIOS, and the private variable IS the truth.
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [
            { kind: 'ram', start: 0, end: 0xbffff },
            trapRegion(),
        ],
        chips: [],
    });
    const dos = createDos8086(m).install();          // claims all 256
    dos.loadCom(assembleRaw([
        ' mov ah, 02h', ' mov bh, 0', ' mov dh, 7', ' mov dl, 9', ' int 10h',
        ' mov ah, 09h', ' mov dx, offset msg', ' int 21h',
        ' mov ax, 4c00h', ' int 21h',
        'msg: db "xy$"',
    ].join('\n'), 0x100));
    dos.run(2_000_000);
    assert.equal(String.fromCharCode(m.mem[cell(7, 9)]), 'x',
        'DOS still honours its own INT 10h/AH=02h when nothing else owns video');
    assert.equal(String.fromCharCode(m.mem[cell(7, 10)]), 'y');
});
