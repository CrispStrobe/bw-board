#!/usr/bin/env node
/**
 * R. T. Russell's BBC BASIC (Z80), zlib, booting on OUR vector-complete
 * Z80 core over a minimal CP/M console shim — the classic emu-CP/M trick:
 * page zero carries JP 0005 -> BDOS entry, the step loop traps PC at the
 * entry, services the call in JS, and RETs. Warm boot (PC=0) ends the run.
 *
 * BDOS surface implemented: 0 exit, 1 conin, 2 conout, 6 direct console
 * I/O, 9 $-string, 10 buffered readline, 11 status, 12 version, 25/26
 * stubs. Returns land in A AND L (programs read either).
 *
 * Setup: git clone --depth 1 https://github.com/rtrussell/BBCZ80 ~/code/BBCZ80
 *        (bin/cpm/BBCBASIC.COM is prebuilt — zlib, shippable.)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80 } from '../src/z80.js';

const comPath = process.env.BBCZ80_COM || join(homedir(), 'code', 'BBCZ80', 'bin', 'cpm', 'BBCBASIC.COM');
if (!existsSync(comPath)) {
    console.error('SKIP (loudly): BBCBASIC.COM not found — see header for the clone recipe');
    process.exit(2);
}

const BDOS = 0xfe00;
const mem = new Uint8Array(65536);
const com = readFileSync(comPath);
mem.set(com, 0x0100);
mem[0x0000] = 0x76;                     // warm boot: trap (never actually executed)
mem[0x0005] = 0xc3; mem[0x0006] = BDOS & 0xff; mem[0x0007] = BDOS >> 8;  // JP BDOS
mem[BDOS] = 0xc9;                       // RET (reached only if the trap misses)

const cpu = new Z80({
    read: (a) => mem[a & 0xffff],
    write: (a, v) => { mem[a & 0xffff] = v & 0xff; },
});
cpu.pc = 0x0100;
cpu.sp = 0xfdff;

let out = '';
const keys = [];
const type = (s) => { for (const ch of s) keys.push(ch.charCodeAt(0)); };
const emit = (ch) => { out += String.fromCharCode(ch); };
const ret = () => { cpu.pc = cpu._pop16(); };
const setA = (v) => { cpu.a = v & 0xff; cpu.l = v & 0xff; };

const bdos = () => {
    switch (cpu.c) {
        case 0: return 'exit';
        case 1: // console input (blocking): serve from the queue or spin
            if (!keys.length) { ret(); cpu.pc = 0x0005; return null; } // re-poll
            setA(keys.shift());
            break;
        case 2: emit(cpu.e); break;
        case 6: // direct console I/O
            if (cpu.e === 0xff) setA(keys.length ? keys.shift() : 0);
            else if (cpu.e === 0xfe) setA(keys.length ? 0xff : 0);
            else if (cpu.e === 0xfd) { if (!keys.length) { ret(); cpu.pc = 0x0005; return null; } setA(keys.shift()); }
            else emit(cpu.e);
            break;
        case 9: { // print $-terminated string at DE
            let a = cpu.de;
            for (let n = 0; n < 4096; n++) {
                const ch = mem[a];
                if (ch === 0x24) break;
                emit(ch);
                a = (a + 1) & 0xffff;
            }
            break;
        }
        case 10: { // buffered readline at DE: [max][len][chars...]
            const buf = cpu.de;
            const max = mem[buf];
            let n = 0;
            while (n < max) {
                if (!keys.length) { ret(); cpu.pc = 0x0005; return null; }
                const ch = keys.shift();
                if (ch === 13) break;
                mem[(buf + 2 + n) & 0xffff] = ch;
                emit(ch);
                n++;
            }
            mem[(buf + 1) & 0xffff] = n;
            emit(13); emit(10);
            break;
        }
        case 11: setA(keys.length ? 0xff : 0); break;
        case 12: cpu.hl = 0x0022; setA(0x22); break;
        default: setA(0); break;         // disk stubs etc.
    }
    ret();
    return null;
};

const runUntil = (pattern, budget) => {
    let steps = 0;
    while (steps < budget) {
        if (pattern && out.includes(pattern)) return 'hit';
        if (cpu.pc === BDOS) {
            if (bdos() === 'exit') return 'exit';
            steps++;
            // An input wait with an empty queue re-enters the trap forever;
            // once the pattern check above has had its chance, that is our
            // signal to hand control back.
            if (!keys.length && cpu.pc === 0x0005) return 'waiting';
            continue;
        }
        if (cpu.pc === 0x0000) return 'exit';
        cpu.step();
        steps++;
    }
    return 'budget';
};

const checks = [];
const expect = (what, ok) => checks.push({ what, ok });

let r = runUntil('>', 80_000_000);
expect('banner + prompt', r === 'hit');
expect('it announces itself', /BBC BASIC \(Z80\)/i.test(out) || /R\.?T\.?\s*Russell/i.test(out));

const mark1 = out.length;
type('PRINT 2+2\r');
r = runUntil(null, 5_000_000);
expect('arithmetic', /\b4\b/.test(out.slice(mark1)));

// BASIC flushes type-ahead after Enter — feed lines prompt by prompt.
const line = (s, budget = 10_000_000) => {
    const from = out.length;
    type(s + '\r');
    let steps = 0;
    while (steps < budget) {
        if (out.indexOf('>', from + s.length) >= 0 && !keys.length) break;
        if (cpu.pc === BDOS) { if (bdos() === 'exit') break; steps++; continue; }
        if (cpu.pc === 0x0000) break;
        cpu.step(); steps++;
    }
};
const mark2 = out.length;
line('10 FOR I=1 TO 3');
line('20 PRINT "Z";I');
line('30 NEXT I');
line('RUN', 30_000_000);
expect('a stored program runs', /Z1[\s\S]*Z2[\s\S]*Z3/.test(out.slice(mark2)));

let bad = 0;
for (const c of checks) { console.log(`${c.ok ? 'ok ' : 'FAIL'}  ${c.what}`); if (!c.ok) bad++; }
if (bad) console.log('--- transcript ---\n' + JSON.stringify(out.slice(0, 400)));
else console.log(`\nRussell's BBC BASIC lives on our Z80 (${(cpu.cycles / 1e6).toFixed(1)}M cycles).`
    + `\n${JSON.stringify(out.slice(0, 160))}`);
process.exit(bad ? 1 : 0);
