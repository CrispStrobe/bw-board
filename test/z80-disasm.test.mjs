// The Z80 disassembler: format spot checks against the published table,
// and lengths ground against the vector suite's modal pc-deltas for every
// file — the filename IS the instruction's leading bytes. Control flow and
// repeating blocks move pc by target (or not at all), so they are filtered
// by their own decoded mnemonic and covered by the spot checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasmZ80 } from '../src/z80-disasm.js';

const d = (bytes) => disasmZ80((a) => bytes[a] ?? 0, 0);

test('formats: spot checks across all pages', () => {
    assert.equal(d([0x00]).text, 'NOP');
    assert.equal(d([0x3e, 0x42]).text, 'LD A,$42');
    assert.equal(d([0x21, 0x34, 0x12]).text, 'LD HL,$1234');
    assert.equal(d([0x18, 0xfe]).text, 'JR $0000');
    assert.equal(d([0x10, 0x02]).text, 'DJNZ $0004');
    assert.equal(d([0x76]).text, 'HALT');
    assert.equal(d([0xc6, 0x05]).text, 'ADD A,$05');
    assert.equal(d([0xbe]).text, 'CP (HL)');
    assert.equal(d([0xd3, 0x80]).text, 'OUT ($80),A');
    assert.equal(d([0xcb, 0x27]).text, 'SLA A');
    assert.equal(d([0xcb, 0x46]).text, 'BIT 0,(HL)');
    assert.equal(d([0xed, 0xb0]).text, 'LDIR');
    assert.equal(d([0xed, 0x47]).text, 'LD I,A');
    assert.equal(d([0xed, 0x43, 0x00, 0x90]).text, 'LD ($9000),BC');
    assert.equal(d([0xed, 0x78]).text, 'IN A,(C)');
    assert.equal(d([0xdd, 0x21, 0x00, 0x80]).text, 'LD IX,$8000');
    assert.equal(d([0xdd, 0x77, 0x05]).text, 'LD (IX+$05),A');
    assert.equal(d([0xfd, 0x7e, 0xfb]).text, 'LD A,(IY-$05)');
    assert.equal(d([0xdd, 0x24]).text, 'INC IXH');
    assert.equal(d([0xdd, 0x36, 0x02, 0x99]).text, 'LD (IX+$02),$99');
    assert.equal(d([0xdd, 0xcb, 0x03, 0x46]).text, 'BIT 0,(IX+$03)');
    assert.equal(d([0xdd, 0xcb, 0x03, 0x06]).text, 'RLC (IX+$03)');
    assert.equal(d([0xdd, 0xcb, 0x03, 0x00]).text, 'RLC (IX+$03),B', 'undocumented copy-to-register named');
    assert.equal(d([0xdd, 0xe9]).text, 'JP (IX)');
    assert.equal(d([0xc7]).text, 'RST $00');
    assert.equal(d([0xff]).text, 'RST $38');
});

test('lengths ground against the vector suite pc-deltas (every file)', (t) => {
    const dir = join(homedir(), 'code', 'z80-vectors', 'v1');
    if (!existsSync(dir)) { t.skip('vector suite not cloned'); return; }
    const FLOW = /^(JP|JR|CALL|RET|RST|DJNZ|HALT|LDIR|LDDR|CPIR|CPDR|INIR|INDR|OTIR|OTDR|NONI)/;
    let checked = 0;
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const lead = file.replace('.json', '').split(' ').map((h) => parseInt(h, 16));
        const mem = new Uint8Array(8);
        mem.set(lead);
        const { text, length } = disasmZ80((a) => mem[a] ?? 0, 0);
        if (FLOW.test(text)) continue;
        const tests = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const deltas = new Map();
        for (const v of tests.slice(0, 60)) {
            const dpc = (v.final.pc - v.initial.pc + 0x10000) & 0xffff;
            if (dpc > 0 && dpc <= 4) deltas.set(dpc, (deltas.get(dpc) || 0) + 1);
        }
        if (!deltas.size) continue;
        const modal = [...deltas.entries()].sort((a, b) => b[1] - a[1])[0][0];
        assert.equal(length, modal, `${file}: "${text}" length ${length} vs suite ${modal}`);
        checked++;
    }
    assert.ok(checked >= 1000, `${checked} files length-checked`);
});
