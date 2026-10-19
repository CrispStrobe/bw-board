// run-dos --file: mount host files into the DOS virtual filesystem so a program
// can read them, and collect the files it writes (a .OBJ from MASM, a .EXE from
// LINK) — the plumbing that lets the real toolchain chain tool to tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDos } from '../scripts/run-dos.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'run-dos-file-'));
const write = (name, bytes) => { const p = join(DIR, name); writeFileSync(p, Uint8Array.from(bytes)); return p; };

// A branch-free .COM that opens "IN", reads one byte, and prints it (INT 21h
// 3Dh/3Fh/02h), then exits. Name "IN",0 at memory 0x121, buffer at 0x120.
function readerCom() {
    const code = [
        0xba, 0x21, 0x01, 0xb8, 0x00, 0x3d, 0xcd, 0x21, 0x89, 0xc3, 0xb4, 0x3f,
        0xb9, 0x01, 0x00, 0xba, 0x20, 0x01, 0xcd, 0x21, 0xb4, 0x02, 0x8a, 0x16,
        0x20, 0x01, 0xcd, 0x21, 0xb4, 0x4c, 0xcd, 0x21,
    ];
    const com = new Uint8Array(0x24);
    com.set(code, 0);                     // 0x00..0x1F (memory 0x100..0x11F)
    com.set([0x49, 0x4e, 0x00], 0x21);    // "IN",0 (memory 0x121)
    return write('READ.COM', com);
}

test('a mounted file is readable — a program opens IN, reads a byte, and DOS prints it', () => {
    const inPath = write('IN', [0x5a]);   // content 'Z'
    let out = '';
    const r = runDos({ program: readerCom(), variant: '80286', preset: 'at', max: 1_000_000, keys: '', files: [`IN=${inPath}`] },
        { write: (s) => { out += s; } });
    assert.ok(r.result.terminated, 'the program exited');
    assert.equal(out, 'Z', 'the mounted file\'s byte reached the program and was printed');
});

test('files a program creates are reported (and can be saved with --out)', () => {
    // .COM: create "OUT" (3Ch), then exit. The created file shows up in r.created.
    const code = [
        0xba, 0x0d, 0x01,             // mov dx, 0x10D   ("OUT",0)
        0xb4, 0x3c,                   // mov ah, 3Ch     (create)
        0x31, 0xc9,                   // xor cx, cx      (attributes 0)
        0xcd, 0x21,                   // int 21h
        0xb4, 0x4c, 0xcd, 0x21,       // exit
    ];
    const com = new Uint8Array(0x11);
    com.set(code, 0);                 // 13 bytes: 0x00..0x0C (memory 0x100..0x10C)
    com.set([0x4f, 0x55, 0x54, 0x00], 0x0d); // "OUT",0 (memory 0x10D)
    const prog = write('MK.COM', com);

    const r = runDos({ program: prog, variant: '80286', preset: 'at', max: 1_000_000, keys: '', files: [] },
        { write() {} });
    assert.ok(r.result.terminated);
    assert.deepEqual(r.created, ['OUT'], 'the created file is detected as program output');
    assert.ok(r.files.get('OUT') instanceof Uint8Array, 'and its bytes are available to save');
});

test('--file mounts under the uppercased basename (no explicit DOS name needed)', () => {
    // Mount a lowercase host file "in" — it should be keyed "IN" (uppercased
    // basename), which the reader opens. Content 'Q'.
    const inPath = write('in', [0x51]);
    let out = '';
    runDos({ program: readerCom(), variant: '80286', preset: 'at', max: 1_000_000, keys: '', files: [inPath] },
        { write: (s) => { out += s; } });
    assert.equal(out, 'Q', 'the host file "in" mounted as DOS "IN" and was read');
});
