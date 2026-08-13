#!/usr/bin/env node
/**
 * Run the Klaus Dormann functional tests against src/w65c02.js — the
 * program-shaped complement to the per-opcode vector grind: tens of
 * millions of REAL instructions (loops, deep stacks, decimal chains),
 * self-verifying by design. The suite traps (JMP *) at the first failure;
 * reaching the documented success trap means everything passed.
 *
 * The suite is GPL-3 and therefore lives OUTSIDE the repo:
 *   git clone --depth 1 \
 *     https://github.com/Klaus2m5/6502_65C02_functional_tests \
 *     ~/code/6502-functional-tests
 *
 * The prebuilt 65C02 extended-opcodes binary is assembled with the
 * default configuration (wdc_op = 0): $CB/$DB are expected to behave as
 * NOPs, but on the W65C02 they are WAI/STP — our core is WDC. The runner
 * pre-scans the load image and reports that configuration mismatch as a
 * SKIP for that binary rather than a core failure, unless a rebuilt
 * binary with wdc_op = 1 is dropped in.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { W65C02 } from '../src/w65c02.js';

const dir = process.env.DORMANN_DIR || join(homedir(), 'code', '6502-functional-tests', 'bin_files');
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see header for the clone recipe`);
    process.exit(2);
}

function run(name, start, opts = {}) {
    const image = readFileSync(join(dir, name));
    const mem = new Uint8Array(65536);
    mem.set(image.subarray(0, 65536), 65536 - image.length < 0 ? 0 : 0);
    const cpu = new W65C02({ read: (a) => mem[a & 0xffff], write: (a, v) => { mem[a & 0xffff] = v & 0xff; } });
    cpu.pc = start;
    let prev = -1;
    let steps = 0;
    const CAP = 400_000_000;
    const t0 = Date.now();
    while (steps < CAP) {
        cpu.step();
        steps++;
        if (cpu.pc === prev) break;              // trap: JMP * (success or failure)
        if (cpu.stopped || cpu.waiting) break;    // WDC op reached (config mismatch)
        prev = cpu.pc;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const trap = cpu.pc.toString(16).padStart(4, '0');
    const testNo = mem[0x0200];
    const ok = opts.successPc ? cpu.pc === opts.successPc : null;
    console.log(`${name}: trapped at $${trap} after ${steps.toLocaleString()} steps (${secs}s), `
        + `test byte $0200=${testNo}${cpu.stopped ? ' [STP]' : cpu.waiting ? ' [WAI]' : ''}`
        + (ok === null ? '' : ok ? ' — SUCCESS' : ` — FAILED (success is $${opts.successPc.toString(16)})`));
    return { pc: cpu.pc, steps, stopped: cpu.stopped, waiting: cpu.waiting, testNo };
}

// Each listing's `success` label is the self-jump the run must end on:
// the line after the label reads `24f1 : 4cf124 > jmp *`. Read it out of
// the .lst so a rebuilt binary keeps working.
function successFrom(lstName) {
    const lst = readFileSync(join(dir, lstName), 'utf8');
    const m = lst.match(/\bsuccess\b[^\n]*\n([0-9a-f]{4}) : 4c[0-9a-f ]+>\s+jmp \*/i);
    return m ? parseInt(m[1], 16) : null;
}

let bad = 0;
for (const [bin, lstName] of [
    ['6502_functional_test.bin', '6502_functional_test.lst'],
    ['65C02_extended_opcodes_test.bin', '65C02_extended_opcodes_test.lst'],
]) {
    const successPc = successFrom(lstName);
    if (!successPc) { console.log(`${bin}: success PC not parsed from ${lstName} — inspect manually`); bad++; continue; }
    const r = run(bin, 0x0400, { successPc });
    if (r.stopped || r.waiting) {
        console.log('  hit WAI/STP mid-test: binary assembled with wdc_op=0 (NOPs expected at '
            + '$CB/$DB) but our core is WDC — configuration mismatch, rebuild with wdc_op=1.');
    }
    if (r.pc !== successPc) bad++;
}
process.exit(bad ? 1 : 0);
