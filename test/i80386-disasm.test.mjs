import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {disasmI80386} from '../src/i80386-disasm.js';
import {disasmI8086} from '../src/i8086-disasm.js';
import {createI80386Adapter} from '../src/i80386-adapter.js';
import {createI80386DebugTarget} from '../src/i80386-debug.js';

/**
 * No independent x86 disassembler is installed on the build host, so these
 * vectors are hand-checked against the Intel 80386 Programmer's Reference
 * opcode map (encoding -> length and operands). The 16-bit half is
 * additionally cross-checked against the SingleStepTests-ground 8086/186
 * decoder below.
 */
const VECTORS = [
    // [eip, code32, bytes, text, length]
    [0x7c13, false, [0xeb, 0xfe], 'jmp 7C13h', 2],
    [0x0000, false, [0x90], 'nop', 1],
    [0x0000, false, [0xb8, 0x34, 0x12], 'mov ax, 1234h', 3],
    [0x0000, false, [0xcd, 0x10], 'int 10h', 2],
    [0x0000, false, [0x8b, 0x46, 0xfe], 'mov ax, word [ss:bp-2h]', 3],
    [0x0000, false, [0x26, 0x8a, 0x07], 'mov al, byte [es:bx]', 3],
    [0x0000, false, [0xf3, 0xa4], 'rep movsb', 2],
    [0x0100, false, [0xe8, 0x00, 0x00], 'call 0103h', 3],
    [0x0000, false, [0x66, 0xb8, 0x78, 0x56, 0x34, 0x12], 'mov eax, 12345678h', 6],
    [0x0000, false, [0x66, 0x40], 'inc eax', 2],
    [0x0000, false, [0x0f, 0xb6, 0xc0], 'movzx ax, al', 3],
    [0x0000, false, [0x66, 0x0f, 0xb6, 0xc3], 'movzx eax, bl', 4],
    [0x7c00, false, [0x0f, 0x84, 0xfe, 0xff], 'jz 7C02h', 4],
    [0x0000, false, [0x64, 0x8b, 0x07], 'mov ax, word [fs:bx]', 3],
    [0x0000, false, [0x65, 0x8b, 0x07], 'mov ax, word [gs:bx]', 3],
    [0x0000, false, [0x67, 0x8b, 0x04, 0x24], 'mov ax, word [ss:esp]', 4],
    [0x0000, false, [0x67, 0x66, 0x8b, 0x44, 0x8e, 0x10], 'mov eax, dword [ds:esi+ecx*4+10h]', 6],
    [0x0000, false, [0x67, 0x8b, 0x04, 0xcd, 0x00, 0x20, 0x00, 0x00], 'mov ax, word [ds:ecx*8+2000h]', 8],
    [0x0000, false, [0x0f, 0x20, 0xc0], 'mov eax, cr0', 3],
    [0x0000, false, [0x0f, 0x22, 0xc0], 'mov cr0, eax', 3],
    [0x0000, false, [0x0f, 0xa0], 'push fs', 2],
    [0x0000, false, [0x0f, 0x01, 0x16, 0x00, 0x10], 'lgdt fword [ds:1000h]', 5],
    [0x0000, false, [0x66, 0xea, 0x00, 0x00, 0x10, 0x00, 0x08, 0x00], 'jmpf 0008h:00100000h', 8],
    [0x0000, false, [0x0f, 0xba, 0xe0, 0x05], 'bt ax, 5h', 4],
    [0x0000, false, [0x0f, 0xa4, 0xd0, 0x04], 'shld ax, dx, 4h', 4],
    [0x0000, false, [0x8c, 0xe0], 'mov ax, fs', 2],
    [0x0000, false, [0x8e, 0xe8], 'mov gs, ax', 2],
    [0x0000, false, [0x0f, 0x94, 0xc0], 'setz al', 3],
    // 32-bit code segment
    [0x0000, true, [0xb8, 0x78, 0x56, 0x34, 0x12], 'mov eax, 12345678h', 5],
    [0x0000, true, [0x66, 0xb8, 0x34, 0x12], 'mov ax, 1234h', 4],
    [0x1000, true, [0xe9, 0xfb, 0xff, 0xff, 0xff], 'jmp 00001000h', 5],
    [0x0000, true, [0x8b, 0x05, 0x00, 0x10, 0x00, 0x00], 'mov eax, dword [ds:1000h]', 6],
    [0x0000, true, [0x8b, 0x45, 0x08], 'mov eax, dword [ss:ebp+8h]', 3],
    [0x0000, true, [0x67, 0x8b, 0x46, 0xfe], 'mov eax, dword [ss:bp-2h]', 4],
    [0x0000, true, [0x60], 'pushad', 1],
    [0x0000, true, [0x9c], 'pushfd', 1],
    [0x0000, true, [0xa5], 'movsd', 1],
    [0x0000, true, [0xcf], 'iretd', 1],
    [0x0000, true, [0xc3], 'retn', 1],
    [0x0000, true, [0x6a, 0xff], 'push FFFFFFFFh', 2],
    // explicit unknown rows, never a throw
    [0x0000, false, [0x0f, 0x0b], 'db 0Fh', 1],
    [0x0000, false, [0x0f, 0xa2], 'db 0Fh', 1],
    [0x0000, false, [0xf1], 'db F1h', 1],
    [0x0000, false, [0xff, 0xff], 'db FFh', 1],
    [0x0000, false, [0x8e, 0xc8], 'db 8Eh', 1],
    [0x0000, false, [0x8d, 0xc0], 'db 8Dh', 1],
    [0x0000, false, [...new Array(15).fill(0x66), 0x90], 'db 66h', 1],
];

const reader = (bytes, base) => a => bytes[(a - base) >>> 0] ?? 0;

test('hand-checked 386 vectors decode to the expected text and length', () => {
    for (const [eip, code32, bytes, text, length] of VECTORS) {
        const got = disasmI80386(reader(bytes, eip), eip, {eip, code32});
        assert.equal(got.text, text, `${bytes.map(b => b.toString(16)).join(' ')}`);
        assert.equal(got.length, length, text);
        assert.deepEqual(got.bytes, bytes.slice(0, length), text);
        assert.equal(got.unknown === true, text.startsWith('db '), text);
    }
});

test('own 16-bit decoder agrees on length with the ground 8086/186 decoder', () => {
    // Deterministic LCG; opcodes the 186 decoder treats as 386-different are skipped.
    let seed = 0x386;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
    let compared = 0;
    const skip = new Set([0x0f, 0x63, 0x64, 0x65, 0x66, 0x67, 0xf1, 0x8c, 0x8e, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf]);
    for (let n = 0; n < 20000; n++) {
        const bytes = Array.from({length: 8}, rnd);
        if (skip.has(bytes[0])) continue;
        const own = disasmI80386(reader(bytes, 0), 0, {eip: 0, own: true});
        if (own.unknown) continue;
        const ref = disasmI8086(reader(bytes, 0), 0, {ip: 0, variant: '80186'});
        assert.equal(own.length, ref.length, bytes.map(b => b.toString(16)).join(' '));
        compared++;
    }
    assert.ok(compared > 10000, `compared ${compared}`);
});

test('own decoder text matches the ground decoder on ordinary 16-bit forms', () => {
    const forms = [[0x90], [0xb8, 0x34, 0x12], [0x8b, 0x46, 0xfe], [0x26, 0x8a, 0x07], [0x01, 0xd8],
        [0x83, 0xc4, 0x02], [0xe8, 0x00, 0x00], [0xeb, 0xfe], [0xcd, 0x21], [0xa1, 0x34, 0x12],
        [0xc7, 0x06, 0x00, 0x10, 0x34, 0x12], [0xf7, 0xe3], [0xff, 0x16, 0x00, 0x20], [0xe4, 0x60],
        [0xf3, 0xa4], [0xc4, 0x1e, 0x00, 0x10], [0x8d, 0x40, 0x02], [0xd1, 0xe0]];
    for (const bytes of forms) {
        const own = disasmI80386(reader(bytes, 0x7c00), 0x7c00, {eip: 0x7c00, own: true});
        const ref = disasmI8086(reader(bytes, 0x7c00), 0x7c00, {ip: 0x7c00, variant: '80186'});
        assert.equal(own.text, ref.text);
        assert.equal(own.length, ref.length);
    }
});

test('fetch wraps at the 16-bit segment boundary, not linearly', () => {
    const mem = new Map([[0x1fffe, 0xb8], [0x1ffff, 0x34], [0x10000, 0x12], [0x20000, 0x99]]);
    const got = disasmI80386(a => mem.get(a) ?? 0, 0x1fffe, {eip: 0xfffe});
    assert.equal(got.text, 'mov ax, 1234h');
    const own = disasmI80386(a => mem.get(a) ?? 0, 0x1fffe, {eip: 0xfffe, own: true});
    assert.equal(own.text, 'mov ax, 1234h');
});

test('random bytes never throw and always advance', () => {
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
    for (let n = 0; n < 5000; n++) {
        const bytes = Array.from({length: 16}, rnd);
        for (const code32 of [false, true]) {
            const got = disasmI80386(reader(bytes, 0), 0, {eip: 0, code32});
            assert.ok(got.length >= 1 && got.length <= 15);
            assert.equal(typeof got.text, 'string');
        }
    }
});

function atFixture(code, at = 0x7c13) {
    const adapter = createI80386Adapter();
    const m = adapter.machine;
    m.reset();
    const target = createI80386DebugTarget(adapter);
    for (let i = 0; i < code.length; i++) m.mem[at + i] = code[i];
    return {adapter, m, cpu: m.cpu, target};
}

test('debug target lists forward code rows from a real-mode PC with linear addresses', () => {
    const {cpu, target} = atFixture([0x90, 0xb8, 0x34, 0x12, 0xeb, 0xfe]);
    cpu.cs = 0; cpu.segmentCaches[1].base = 0; cpu.eip = 0x7c13;
    let addr = target.nextCodeAddress(0x7c13, 0);
    assert.equal(addr, 0x7c13);
    const rows = [];
    for (let i = 0; i < 3; i++) {
        const d = target.disasm(addr);
        rows.push([addr, d.text]);
        addr = target.nextCodeAddress(addr, d.length);
    }
    assert.deepEqual(rows, [[0x7c13, 'nop'], [0x7c14, 'mov ax, 1234h'], [0x7c17, 'jmp 7C17h']]);
    // Segment 07C0h: same linear rows, relative targets in the segment.
    cpu.cs = 0x7c0; cpu.segmentCaches[1].base = 0x7c00; cpu.eip = 0x13;
    assert.equal(target.disasm(0x7c17).text, 'jmp 0017h');
    assert.equal(target.nextCodeAddress(0x7c17, 2), 0x7c19);
    // IP wraps within the segment.
    assert.equal(target.nextCodeAddress(0x7c00 + 0xffff, 2), 0x7c01);
});

test('debug target refuses listing under paging and outside 32-bit space without mutation', () => {
    const {cpu, m, target} = atFixture([0x90]);
    assert.ok(target.disasm(-1).unsupported);
    assert.ok(target.nextCodeAddress(0x100000000, 1).unsupported);
    assert.ok(target.nextCodeAddress(0, -1).unsupported);
    const cr0 = cpu.cr0;
    cpu.cr0 = (cr0 | 0x80000001) >>> 0;
    const before = JSON.stringify(target.regs());
    assert.ok(target.disasm(0x7c13).unsupported);
    assert.ok(target.nextCodeAddress(0x7c13, 1).unsupported);
    assert.equal(JSON.stringify(target.regs()), before);
    cpu.cr0 = cr0;
    assert.equal(m.mem[0x7c13], 0x90);
});

test('reset vector decodes through the high physical alias', () => {
    const adapter = createI80386Adapter();
    const rom = new Uint8Array(65536); rom.fill(0x90); rom.set([0xea, 0x5b, 0xe0, 0x00, 0xf0], 0xfff0);
    adapter.machine.loadRom(rom, 0xffff0000); adapter.machine.reset();
    const target = createI80386DebugTarget(adapter);
    const d = target.disasm(adapter.machine.cpu.pc);
    assert.equal(d.text, 'jmpf F000h:E05Bh');
    assert.equal(d.length, 5);
});

test('mutation checks: each seeded decoder defect is killed by the vectors', async () => {
    const srcPath = fileURLToPath(new URL('../src/i80386-disasm.js', import.meta.url));
    const original = readFileSync(srcPath, 'utf8');
    const dep = pathToFileURL(fileURLToPath(new URL('../src/i8086-disasm.js', import.meta.url))).href;
    const mutants = [
        ['sib scale', 'const scale = 1 << (sib >> 6)', 'const scale = 1 << ((sib >> 6) & 1)'],
        ['operand-size prefix', 'else if (op === 0x66) osz = !code32;', 'else if (op === 0x66) osz = code32;'],
        ['address-size prefix', 'else if (op === 0x67) asz = !code32;', 'else if (op === 0x67) asz = code32;'],
        ['relative base', 'const t = ((eip0 + i + d)', 'const t = ((eip0 + d)'],
        ['fs/gs override', 'seg = SREG[op - 0x60];', 'seg = SREG[op - 0x61];'],
        ['delegation guard', 'if (op === 0x0f || op === 0x63 || op === 0x8c || op === 0x8e) return false;', ''],
        ['unknown row length', 'length: 1, unknown: true', 'length: 0, unknown: true'],
        ['ebp default segment', "(baseReg === 4 || baseReg === 5) ? 'ss' : 'ds'", "(baseReg === 4) ? 'ss' : 'ds'"],
        ['prefix limit', 'if (i >= MAX_LENGTH) throw new Unknown();', ''],
    ];
    const dir = mkdtempSync(join(tmpdir(), 'i80386-disasm-mutants-'));
    try {
        for (const [name, from, to] of mutants) {
            assert.ok(original.includes(from), `mutant anchor ${name}`);
            const file = join(dir, `${name.replace(/\W+/g, '-')}.mjs`);
            writeFileSync(file, original.replace(from, to).replace("from './i8086-disasm.js'", `from '${dep}'`));
            const mod = await import(pathToFileURL(file).href);
            let killed = false;
            try {
                for (const [eip, code32, bytes, text, length] of VECTORS) {
                    const got = mod.disasmI80386(reader(bytes, eip), eip, {eip, code32});
                    if (got.text !== text || got.length !== length) { killed = true; break; }
                }
            } catch { killed = true; }
            assert.ok(killed, `mutant survived: ${name}`);
        }
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});
