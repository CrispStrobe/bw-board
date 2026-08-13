#!/usr/bin/env node
/**
 * Twin-run CPU differential: our W65C02 vs vrEmu6502 (MIT, independent
 * lineage) in lockstep over the SAME flat-64K image. Any 6502 binary is a
 * CPU test this way, whatever machine it targeted — unmapped I/O is plain
 * RAM on both sides, identically. First divergence is reported with full
 * context; agreement is counted in instructions.
 *
 * Setup (once):
 *   git clone --depth 1 https://github.com/visrealm/vrEmu6502 ~/code/vrEmu6502
 *   cc -O2 -I ~/code/vrEmu6502/src -o scripts/twinrun/vrpeer \
 *      scripts/twinrun/vrpeer.c ~/code/vrEmu6502/src/vrEmu6502.c
 *
 *   node scripts/twinrun-6502.mjs <image.bin> <startPC-hex> [maxSteps]
 *   node scripts/twinrun-6502.mjs --dormann     # both canonical suites
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { W65C02 } from '../src/w65c02.js';

const here = dirname(fileURLToPath(import.meta.url));
const peer = join(here, 'twinrun', 'vrpeer');
if (!existsSync(peer)) {
    console.error('SKIP (loudly): peer not built — see the header for the two setup commands');
    process.exit(2);
}

function twinrun(imagePath, startPc, maxSteps = 400_000_000) {
    const image = readFileSync(imagePath);
    const mem = new Uint8Array(65536);
    mem.set(image.subarray(0, 65536));
    mem[0xfffc] = startPc & 0xff;
    mem[0xfffd] = (startPc >> 8) & 0xff;
    const cpu = new W65C02({ read: (a) => mem[a & 0xffff], write: (a, v) => { mem[a & 0xffff] = v & 0xff; } });
    cpu.pc = startPc;

    return new Promise((resolve) => {
        const child = spawn(peer, [imagePath, startPc.toString(16), String(maxSteps)]);
        let carry = Buffer.alloc(0);
        let steps = 0;
        let diverged = false;
        let adopted = false;
        let prevPc = -1;
        const t0 = Date.now();
        child.stdout.on('data', (buf) => {
            if (diverged) return;
            let b = carry.length ? Buffer.concat([carry, buf]) : buf;
            const whole = b.length - (b.length % 8);
            let off = 0;
            if (!adopted && whole >= 8) {
                // Record 0 is the peer's post-reset state: adopt it, so the
                // comparison starts aligned (reset S/P are implementation lore).
                cpu.pc = b[0] | (b[1] << 8);
                cpu.a = b[2]; cpu.x = b[3]; cpu.y = b[4]; cpu.s = b[5]; cpu.p = b[6];
                adopted = true;
                off = 8;
            }
            for (; off < whole; off += 8) {
                const atPc = cpu.pc;
                const op = mem[atPc];
                const n = cpu.step();
                steps++;
                // P is compared with B (bit 4) and U (bit 5) masked: they are
                // not architectural flags — they exist only on the pushed
                // byte, and SingleStepTests (which we pass) and vrEmu6502
                // chose opposite in-register conventions. A wrong pushed B
                // still surfaces here: it flows through the stack into a
                // later PLP/PLA and diverges the masked bits or A.
                const mine = [cpu.pc & 0xff, cpu.pc >> 8, cpu.a, cpu.x, cpu.y, cpu.s, cpu.p & 0xcf, n];
                const theirs = [b[off], b[off + 1], b[off + 2], b[off + 3], b[off + 4], b[off + 5], b[off + 6] & 0xcf, b[off + 7]];
                for (let k = 0; k < 8; k++) {
                    // Known peer cycle-model differences, adjudicated by the
                    // SingleStepTests vectors (10k per opcode, all passing):
                    //  - column F (BBR/BBS): vectors say 6 taken / 5 not,
                    //    vrEmu6502 models a flat 5;
                    //  - $5C: vectors say 4 cycles, vrEmu6502 models the
                    //    oft-quoted 8 (the same folklore the vectors already
                    //    corrected in our own core).
                    // Cycles exempt for exactly these; state still compared.
                    if (k === 7 && ((op & 0x0f) === 0x0f || op === 0x5c)) continue;
                    if (mine[k] !== theirs[k]) {
                        const name = ['pc_lo', 'pc_hi', 'a', 'x', 'y', 's', 'p', 'cycles'][k];
                        console.log(`DIVERGED at step ${steps.toLocaleString()} on ${name}: `
                            + `ours ${mine[k]} vs peer ${theirs[k]} `
                            + `(executed $${op.toString(16).padStart(2, '0')} at $${atPc.toString(16)}, `
                            + `our pc now $${cpu.pc.toString(16)}, peer pc $${(b[off] | (b[off + 1] << 8)).toString(16)})`);
                        diverged = true;
                        child.kill();
                        return;
                    }
                }
                prevPc = cpu.pc;
            }
            carry = Buffer.from(b.subarray(whole));
        });
        child.on('close', () => {
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            resolve({ steps, diverged, secs });
        });
    });
}

const args = process.argv.slice(2);
let jobs;
if (args[0] === '--dormann') {
    const d = join(homedir(), 'code', '6502-functional-tests', 'bin_files');
    jobs = [
        [join(d, '6502_functional_test.bin'), 0x0400],
        [join(d, '65C02_extended_opcodes_test.bin'), 0x0400],
    ];
} else if (args.length >= 2) {
    jobs = [[args[0], parseInt(args[1], 16), args[2] ? Number(args[2]) : undefined]];
} else {
    console.error('usage: twinrun-6502.mjs <image.bin> <startPC-hex> [maxSteps] | --dormann');
    process.exit(2);
}

let bad = 0;
for (const [image, start, cap] of jobs) {
    const r = await twinrun(image, start, cap);
    console.log(`${image.split('/').pop()}: ${r.diverged ? 'DIVERGED' : 'AGREE'} over `
        + `${r.steps.toLocaleString()} instructions (${r.secs}s)`);
    if (r.diverged) bad++;
}
process.exit(bad ? 1 : 0);
