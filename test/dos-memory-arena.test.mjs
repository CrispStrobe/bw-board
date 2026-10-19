// DOS memory arena: a loaded program is told the top of conventional memory in
// PSP:0002, the paragraph past the last one it owns. Tools that size their heap
// from there — LINK ("Not enough memory for linker" when it read 0), MASM's
// larger passes — need it. Both loaders set it; a program can read it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';

const ARENA_TOP = 0xa000;   // 640K, matching the INT 21h/48h allocator cap
const PSP = 0x0800;         // default load segment for both loaders

const readTop = (m) => m._read((PSP << 4) + 2) | (m._read((PSP << 4) + 3) << 8);

test('loadCom sets PSP:0002 to the conventional-memory top (not 0)', () => {
    const m = new I8086Machine(DOSBOX8086);
    createDos8086(m).install().loadCom(Uint8Array.from([0xcd, 0x20]));   // trivial .COM
    assert.equal(readTop(m), ARENA_TOP, 'a .COM owns memory to the arena top');
});

test('loadExe sets PSP:0002 too (LINK/MASM size their heap from it)', () => {
    // A minimal MZ .EXE: 2-paragraph (32-byte) header, one page, code = INT 20h.
    const e = new Uint8Array(34);
    e[0] = 0x4d; e[1] = 0x5a;                 // 'MZ'
    e[2] = 34; e[3] = 0;                      // bytes in last page
    e[4] = 1; e[5] = 0;                       // pages = 1
    e[8] = 2; e[9] = 0;                       // header paragraphs = 2 (32 bytes)
    e[0x10] = 0x00; e[0x11] = 0x01;           // initial SP = 0x100
    e[32] = 0xcd; e[33] = 0x20;              // code: INT 20h
    const m = new I8086Machine(DOSBOX8086);
    createDos8086(m).install().loadExe(e);
    assert.equal(readTop(m), ARENA_TOP, 'a .EXE owns memory to the arena top');
});

test('a program reads the arena top from PSP:0002 and DOS prints it', () => {
    const m = new I8086Machine(DOSBOX8086);
    const out = [];
    const dos = createDos8086(m, { onChar: (ch) => out.push(ch.charCodeAt(0) & 0xff) }).install();
    // DS = PSP; print the high byte of PSP:0002 (0xA0 for a 0xA000 top).
    dos.loadCom(Uint8Array.from([
        0x8a, 0x16, 0x03, 0x00,   // mov dl, [0003]  (high byte of the top-of-memory word)
        0xb4, 0x02,               // mov ah, 02h     (DOS: write character in DL)
        0xcd, 0x21,               // int 21h
        0xcd, 0x20,               // int 20h         (exit)
    ]));
    dos.run(10000);
    assert.deepEqual(out, [ARENA_TOP >> 8], 'the program saw 0xA0 — the arena top, from PSP:0002');
});
