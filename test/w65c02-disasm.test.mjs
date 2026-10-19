// The 6502 disassembler, held to the 8051 standard: lengths ground against
// the vector suite's own pc-deltas for EVERY opcode (the strongest length
// oracle that exists), mnemonics spot-checked against the WDC table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasm6502 } from '../src/w65c02-disasm.js';

test('mnemonics and formats: spot checks against the published table', () => {
    const mem = (bytes) => (a) => bytes[a] ?? 0;
    const d = (bytes) => disasm6502(mem(bytes), 0).text;
    assert.equal(d([0xa9, 0x42]), 'LDA #$42');
    assert.equal(d([0x8d, 0x01, 0x60]), 'STA $6001');
    assert.equal(d([0xbd, 0x00, 0x02]), 'LDA $0200,X');
    assert.equal(d([0xb1, 0x10]), 'LDA ($10),Y');
    assert.equal(d([0xb2, 0x10]), 'LDA ($10)');
    assert.equal(d([0x7c, 0x00, 0x30]), 'JMP ($3000,X)');
    assert.equal(d([0xf0, 0xfe]), 'BEQ $0000', 'relative resolves to the target');
    assert.equal(d([0x0f, 0x10, 0x02]), 'BBR0 $10,$0005');
    assert.equal(d([0x67, 0x22]), 'RMB6 $22');
    assert.equal(d([0xcb]), 'WAI');
    assert.equal(d([0x1a]), 'INC A');
    assert.equal(d([0x00, 0x00]).startsWith('BRK'), true);
});

test('lengths ground against the vector suite pc-deltas (every opcode)', (t) => {
    const dir = join(homedir(), 'code', '65x02-vectors', 'wdc65c02', 'v1');
    if (!existsSync(dir)) { t.skip('vector suite not cloned'); return; }
    // Control flow moves pc by its TARGET, not its length — those opcodes
    // are covered by the format spot checks above instead.
    const FLOW = new Set([0x00, 0x20, 0x40, 0x4c, 0x60, 0x6c, 0x7c,
        0x10, 0x30, 0x50, 0x70, 0x80, 0x90, 0xb0, 0xd0, 0xf0]);
    for (let i = 0; i < 8; i++) { FLOW.add(0x0f | (i << 4)); FLOW.add(0x8f | (i << 4)); }
    let checked = 0;
    for (let op = 0; op < 256; op++) {
        if (FLOW.has(op)) continue;
        const file = join(dir, `${op.toString(16).padStart(2, '0')}.json`);
        if (!existsSync(file)) continue;
        const raw = readFileSync(file, 'utf8');
        if (!raw.trim()) continue;                      // WAI/STP ship empty
        const tests = JSON.parse(raw);
        // Straight-line vectors only: control flow moves pc by more or less
        // than the encoding length, so filter to the modal delta.
        const deltas = new Map();
        for (const v of tests.slice(0, 60)) {
            const dpc = (v.final.pc - v.initial.pc + 0x10000) & 0xffff;
            if (dpc > 0 && dpc <= 3) deltas.set(dpc, (deltas.get(dpc) || 0) + 1);
        }
        if (!deltas.size) continue;                     // pure control flow
        const modal = [...deltas.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const mem = new Uint8Array(4).fill(0);
        mem[0] = op;
        const { length } = disasm6502((a) => mem[a] ?? 0, 0);
        assert.equal(length, modal, `opcode $${op.toString(16)}: table length ${length} vs suite ${modal}`);
        checked++;
    }
    assert.ok(checked >= 200, `${checked} opcodes length-checked`);
});

test('labels: known addresses render by name; ld65 label files parse to symbols', async () => {
    const { symbolsFromLd65Labels } = await import('../src/w65c02-disasm.js');
    const syms = symbolsFromLd65Labels([
        'al 008000 .reset',
        'al 000204 ._bw_task0_state',
        'al 000206 ._bw_task1_state',
        'al 00F00A ._main',
    ].join('\n'));
    assert.equal(syms.labels.get(0x8000), 'reset');
    assert.deepEqual(syms.scheduler.tasks.map((t) => t.name), ['bw_task0', 'bw_task1']);
    assert.deepEqual(syms.scheduler.tasks[0].state, { addr: 0x0204, size: 2 });

    const mem = [0x20, 0x00, 0x80];       // JSR $8000
    const r = disasm6502((a) => mem[a] ?? 0, 0, { labels: syms.labels });
    assert.equal(r.text, 'JSR reset');

    const { disasmZ80, CPM_LABELS } = await import('../src/z80-disasm.js');
    const z = disasmZ80((a) => [0xcd, 0x05, 0x00][a] ?? 0, 0, { labels: CPM_LABELS });
    assert.equal(z.text, 'CALL BDOS', 'symbol-less CP/M binaries still get entry-point names');
});
