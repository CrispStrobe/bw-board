// The 8086 disassembler. The real verification is
// scripts/grind-i8086-disasm.mjs, which compares BOTH the text and the byte
// length against the disassembly string the SingleStepTests 8086 suite ships
// with every one of its 646,000 vectors — 646,000/646,000 on 2026-09-03,
// with three excluded where the suite's own name contradicts its own bytes.
// These are the always-on subset: the syntax rules that look like bugs, the
// segment-boundary fetch, and a sampled grind when the suite is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasmI8086 } from '../src/i8086-disasm.js';

/** Disassemble a byte string sitting at 0000:0000. */
const d = (bytes, opts) => disasmI8086((a) => bytes[a] ?? 0, 0, { ip: 0, ...opts });

test('a memory operand always names its segment and its size', () => {
    assert.equal(d([0x00, 0x3b]).text, 'add byte [ss:bp+di], bh');
    assert.equal(d([0x0b, 0x00]).text, 'or ax, word [ds:bx+si]');
    assert.equal(d([0x8e, 0x25]).text, 'mov es, word [ds:di]');
    assert.equal(d([0xc4, 0x65, 0xf5]).text, 'les sp, dword [ds:di-Bh]');
    // ...except LEA, which computes an address and never touches memory.
    assert.equal(d([0x8d, 0x2c]).text, 'lea bp, [ds:si]');
});

test('an override lives in the brackets, is spelled out for a string op, and is dropped when it did nothing', () => {
    assert.equal(d([0x3e, 0x0b, 0x00]).text, 'or ax, word [ds:bx+si]');
    assert.equal(d([0x2e, 0x0b, 0x22]).text, 'or sp, word [cs:bp+si]');
    assert.equal(d([0x2e, 0xa4]).text, 'cs movsb');
    assert.equal(d([0x2e, 0xf2, 0xa6]).text, 'cs repne cmpsb');
    assert.equal(d([0xf3, 0xa4]).text, 'rep movsb', 'MOVS ignores ZF, so its REP has no sense');
    assert.equal(d([0x3e, 0xf3, 0xae]).text, 'ds repe scasb', 'SCAS reads ZF, so its REP does');
    assert.equal(d([0x26, 0xd6]).text, 'salc', 'no memory operand, nothing to override');
    assert.equal(d([0x3e, 0x3b, 0xfd]).text, 'cmp di, bp');
});

test('a displacement is printed because mod says one was encoded, not because it is non-zero', () => {
    assert.equal(d([0xd0, 0x6a, 0x00]).text, 'shr byte [ss:bp+si+0h]');
    assert.equal(d([0xd1, 0x4f, 0x00]).text, 'ror word [ds:bx+0h]');
    assert.equal(d([0xd1, 0x21]).text, 'shl word [ds:bx+di]', 'mod 0 encodes none');
    assert.equal(d([0x00, 0xb0, 0xa2, 0x34]).text, 'add byte [ds:bx+si+34A2h], dh');
    assert.equal(d([0x22, 0x62, 0xbc]).text, 'and ah, byte [ss:bp+si-44h]', 'signed, sign-and-magnitude');
    assert.equal(d([0x0b, 0x2e, 0x61, 0xe2]).text, 'or bp, word [ds:E261h]', 'the direct form is unsigned');
});

test('targets pad to four digits, immediates pad to none, far pointers pad both halves', () => {
    assert.equal(d([0x7e, 0x29]).text, 'jle 002Bh');
    assert.equal(d([0x7e, 0x8b]).text, 'jle FF8Dh');
    assert.equal(d([0xc6, 0xeb, 0x02]).text, 'mov bl, 2h');
    assert.equal(d([0xd4, 0x00]).text, 'aam 0h');
    assert.equal(d([0xea, 0xb0, 0x08, 0x79, 0x7d]).text, 'jmpf 7D79h:08B0h');
    assert.equal(d([0x83, 0x3d, 0xce]).text, 'cmp word [ds:di], FFCEh', 'imm8 sign-extends into the text');
});

test('the undocumented and the aliased decode as what the silicon does', () => {
    assert.equal(d([0x68, 0xa0]).text, 'js FFA2h', '60-6F is the Jcc block a second time');
    assert.equal(d([0x0f]).text, 'pop cs');
    assert.equal(d([0xd6]).text, 'salc');
    assert.equal(d([0xd0, 0x37]).text, 'setmo byte [ds:bx]');
    assert.equal(d([0xd2, 0xf2]).text, 'setmoc dl, cl', 'the CL-counted form is conditional, and named for it');
    assert.equal(d([0xc1]).text, 'retn');
    assert.equal(d([0xc0, 0x71, 0xf6]).text, 'retn F671h');
    assert.equal(d([0xf6, 0x0b, 0x09]).text, 'test byte [ss:bp+di], 9h', 'F6 reg=1 is TEST, not a hole');
    assert.equal(d([0xff, 0xf5]).text, 'push bp', 'FF reg=7 is PUSH again');
});

test('fetch wraps at the segment boundary, not the linear one', () => {
    // A five-byte instruction starting at offset FFFCh takes its last byte
    // from offset 0000h of the SAME segment. Reading linearly on past the
    // end disassembles a different instruction — one vector in 646,000
    // proves it, and no hand-written test would have.
    const seg = 0x5dcc, base = seg << 4;
    const mem = new Uint8Array(1 << 20);
    mem.set([0x2e, 0xd2, 0xba, 0xb2], base + 0xfffc);
    mem[base] = 0xc5;                       // the wrapped fifth byte
    mem[base + 0x10000] = 0x00;             // what a linear read would find
    const got = disasmI8086((a) => mem[a & 0xfffff], (base + 0xfffc) & 0xfffff, { ip: 0xfffc });
    assert.equal(got.text, 'sar byte [cs:bp+si-3A4Eh], cl');
    assert.equal(got.length, 5);
});

test('a relative target is an address in the segment, unless asked for the suite convention', () => {
    const mem = new Uint8Array(1 << 20);
    mem.set([0x74, 0x10], (0x1000 << 4) + 0x0200);
    const abs = disasmI8086((a) => mem[a], (0x1000 << 4) + 0x0200, { ip: 0x0200 });
    assert.equal(abs.text, 'jz 0212h', 'the pane wants where it lands');
    const rel = disasmI8086((a) => mem[a], (0x1000 << 4) + 0x0200, { ip: 0x0200, targetBase: 0 });
    assert.equal(rel.text, 'jz 0012h', 'the suite measures from the instruction');
});

test('labels replace a target that has a name', () => {
    const labels = new Map([[0x0212, 'again']]);
    const mem = new Uint8Array(1 << 20);
    mem.set([0x74, 0x10], (0x1000 << 4) + 0x0200);
    const got = disasmI8086((a) => mem[a], (0x1000 << 4) + 0x0200, { ip: 0x0200, labels });
    assert.equal(got.text, 'jz again');
});

// ---- sampled grind, only when the suite is on this machine ---------------
const suite = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors', 'v1');
test('sampled disassembly against the suite', { skip: !existsSync(suite) && 'suite not present' }, () => {
    // The three vectors whose own name contradicts their own bytes, at a
    // segment wrap. See scripts/grind-i8086-disasm.mjs for the argument.
    const excused = new Set([
        '8171adee83f0a5f33536d087217cc342c4ccd9de818f5f2e9c04e881093be729',
        'ac3ed829c118be9e386a9961a8087c9a19c806b062bd60fcdd826a1abf29f788',
        '7f154ea9f6eb272a23bffed55c4e0f670f0343c6628cc5d2836ed7a5d796babd',
    ]);
    const mem = new Uint8Array(1 << 20);
    const files = readdirSync(suite).filter((f) => f.endsWith('.json.gz')).sort()
        .filter((_, i) => i % 20 === 0);
    let checked = 0;
    for (const file of files) {
        const base = file.replace('.json.gz', '');
        const tests = JSON.parse(gunzipSync(readFileSync(join(suite, file))).toString('utf8')).slice(0, 20);
        for (const t of tests) {
            for (const [addr, val] of t.initial.ram) mem[addr] = val;
            const { cs, ip } = t.initial.regs;
            const got = disasmI8086((a) => mem[a & 0xfffff], ((cs << 4) + ip) & 0xfffff,
                { ip, targetBase: 0 });
            assert.equal(got.bytes.join(' '), t.bytes.join(' '), `${base} #${t.test_num}: bytes`);
            if (!excused.has(t.test_hash)) {
                assert.equal(got.text, t.name.trim(), `${base} #${t.test_num}`);
            }
            for (const [addr] of t.initial.ram) mem[addr] = 0;
            checked++;
        }
    }
    assert.ok(checked > 200, `sampled ${checked} vectors`);
});
