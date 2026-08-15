#!/usr/bin/env node
/**
 * Tali Forth 2 boots to `ok` — the free-system-ROM milestone.
 *
 * Tali Forth 2 (Scot W. Stevenson / Sam Colwell, PUBLIC DOMAIN) is a
 * complete ANS-subset Forth for the 65C02: the best freely-licensed
 * full system ROM in existence. The prebuilt py65mon image loads at
 * $8000 and talks through the py65mon convention:
 *
 *   putc: STA $F001   (write = emit one char)
 *   getc: LDA $F004   (read = next key, 0 when none — Tali spins)
 *
 * The runner is the twin-run pattern: a raw W65C02 over 64K flat
 * memory with those two addresses hooked — no board, no chips, the
 * CPU and the contract. Acceptance: the banner, then arithmetic
 * (2 3 + . → 5), then compiling a new word (: sq dup * ; 7 sq . → 49)
 * — that last one exercises the dictionary, the compiler, and the
 * return stack, which is what "a Forth system works" means.
 *
 * Setup: git clone --depth 1 https://github.com/SamCoVT/TaliForth2
 *          ~/code/TaliForth2   (taliforth-py65mon.bin is committed)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { W65C02 } from '../src/w65c02.js';

const binPath = process.env.TALI_BIN || join(homedir(), 'code', 'TaliForth2', 'taliforth-py65mon.bin');
if (!existsSync(binPath)) {
    console.error('SKIP (loudly): taliforth-py65mon.bin not found — see header');
    process.exit(2);
}

const mem = new Uint8Array(65536);
mem.set(readFileSync(binPath), 0x8000);

let out = '';
const keys = [];
const cpu = new W65C02({
    read: (a) => {
        a &= 0xffff;
        if (a === 0xf004) return keys.length ? keys.shift() : 0;
        return mem[a];
    },
    write: (a, v) => {
        a &= 0xffff;
        if (a === 0xf001) { out += String.fromCharCode(v & 0x7f); return; }
        mem[a] = v & 0xff;
    },
});
cpu.reset();

const type = (s) => { for (const ch of s) keys.push(ch.charCodeAt(0)); };
const runUntilQuiet = (budget = 20_000_000) => {
    // Run until the key queue is drained AND output stops growing.
    let last = -1, steps = 0;
    while (steps < budget) {
        for (let i = 0; i < 100_000 && steps < budget; i++, steps++) cpu.step();
        if (!keys.length && out.length === last) return;
        last = out.length;
    }
};

const checks = [];
const expect = (what, ok) => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

runUntilQuiet();
expect('banner announces Tali Forth 2', /Tali Forth 2/i.test(out));

let mark = out.length;
type('2 3 + .\n');
runUntilQuiet();
expect(`arithmetic: 2 3 + . prints 5 (${JSON.stringify(out.slice(mark, mark + 40))})`,
    /\b5\b/.test(out.slice(mark)));

mark = out.length;
type(': sq dup * ;\n7 sq .\n');
runUntilQuiet();
expect(`compiling a word: 7 sq . prints 49`, /\b49\b/.test(out.slice(mark)));

mark = out.length;
type('words\n');
runUntilQuiet();
expect('WORDS lists the dictionary (dup, swap present)',
    /dup/.test(out.slice(mark)) && /swap/.test(out.slice(mark)));

console.log('\n--- transcript tail ---');
console.log(out.slice(-300));
process.exit(checks.every(Boolean) ? 0 : 1);
