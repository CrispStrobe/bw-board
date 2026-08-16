// Microsoft BASIC V1.1 (MIT, vendored) on the EATER6502 — the shippable
// 6502 BASIC, verified as an acceptance test rather than a ledger line
// (the port finished in its own repo and the roadmap sat stale at
// "mid-flight" until the owner asked; a test in the suite cannot drift).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';

const ROM = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', 'vendor', 'msbasic', 'basic.rom'));

test('Microsoft BASIC boots, answers prompts, computes, runs a program', () => {
    let out = '';
    const m = new M6502Machine(EATER6502, {
        onSerial(byte) { out += String.fromCharCode(byte); },
    });
    m.loadRom(ROM, 0x8000);
    m.cpu.pc = m.mem[0xfffc] | (m.mem[0xfffd] << 8);
    const acia = Object.values(m.chips).find((c) => typeof c.rxPush === 'function');
    assert.ok(acia, 'EATER6502 has an ACIA');
    const typeLine = (s) => { for (const ch of s) acia.rxPush(ch.charCodeAt(0)); acia.rxPush(0x0d); };

    const until = (needle, budgetMs) => {
        const start = m.tMs;
        while (!out.includes(needle) && m.tMs - start < budgetMs) m.advanceToMs(m.tMs + 50);
        assert.ok(out.includes(needle), `expected ${JSON.stringify(needle)} in ${JSON.stringify(out.slice(-160))}`);
    };

    until('MEMORY SIZE?', 6000);
    typeLine('');
    until('WIDTH?', 4000);   // the KIM-1 build's short form
    typeLine('');
    until('BYTES FREE', 6000);
    until('OK', 2000);
    out = '';
    typeLine('PRINT 2+2');
    until(' 4', 4000);
    out = '';
    typeLine('10 FOR I=1 TO 3');
    typeLine('20 PRINT I*I');
    typeLine('30 NEXT I');
    typeLine('RUN');
    until(' 9', 8000);
    assert.match(out, / 1[\s\S]* 4[\s\S]* 9/);
});
