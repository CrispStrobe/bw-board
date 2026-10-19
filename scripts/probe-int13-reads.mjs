#!/usr/bin/env node
/**
 * Check every INT 13h AH=02h read a real boot performs against the raw image.
 *
 * WHY THIS EXISTS. ELKS's MINIX-filesystem floppy does not boot: the loader
 * fetches /linux, execution eventually falls into a zero-filled region and
 * slides through it as `ADD [BX+SI],AL`, the stack descends unbounded through
 * the data segment, and the visible symptom -- a list walk at cs=685 that
 * never reaches its sentinel -- is sixteen million instructions downstream of
 * anything that went wrong. The useful question is not where it stalls but
 * whether the bytes it executes are the bytes on the disk.
 *
 * WHY IT OBSERVES RATHER THAN SYNTHESISES. The first version of this probe
 * built its own INT 13h calls, and every one came back AH=02h -- including
 * cylinder 0 sector 1, which the real boot reads without trouble. A
 * synthesised call that never worked measures the harness, not the BIOS. So
 * this watches the loader make its OWN calls, captures the request at the
 * handler's entry, and compares the destination against the image once the
 * frame is popped.
 *
 * TWO GUARDS, both of which this probe failed before it had them:
 *   - the INT 13h vector is read AFTER POST installs it. At reset the IVT is
 *     zeros, a handler address of 0:0 matches nothing, and the probe observes
 *     no calls at all.
 *   - zero observations is reported as INCONCLUSIVE, never as a pass. The
 *     first run printed "every observed read returned correct data" on an
 *     empty sample, which reads exactly like success.
 *
 *   node scripts/probe-int13-reads.mjs [steps] [image]
 */
import { readFileSync } from 'node:fs';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { buildBios } from './build-bios.mjs';

const STEPS = Number(process.argv[2] || 12_000_000);
const IMAGE = process.argv[3] || process.env.ELKS_IMAGE
    || '/mnt/volume1/code/elks-images/fd1440-minix.img';
const GEO = { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 };
const lba = (c, h, s) => ((c * GEO.heads + h) * GEO.sectors + (s - 1)) * 512;

const img = readFileSync(IMAGE);
const m = new I8086Machine(PCXT8086);
m.loadRom(buildBios().bytes);
m.chips.fdc1.insert(0, img, GEO);
m.reset();

// POST must have installed the vector before we can recognise a call.
const POST = Math.min(600_000, Math.floor(STEPS / 4));
for (let i = 0; i < POST; i++) m.step();
const vec = 0x13 * 4;
const H_OFF = m.mem[vec] | (m.mem[vec + 1] << 8);
const H_SEG = m.mem[vec + 2] | (m.mem[vec + 3] << 8);
console.log(`INT 13h handler at ${H_SEG.toString(16)}:${H_OFF.toString(16)}  image ${IMAGE.split('/').pop()}`);
if ((H_SEG | H_OFF) === 0) {
    console.error('FATAL: INT 13h vector still 0:0 after POST -- this probe would observe nothing.');
    process.exit(2);
}

let pend = null, checked = 0, badStatus = 0, badData = 0;
const problems = [];
for (let i = POST; i < STEPS; i++) {
    const cpu = m.cpu;
    if (!pend && cpu.cs === H_SEG && cpu.ip === H_OFF && ((cpu.ax >> 8) & 0xff) === 0x02) {
        const cx = cpu.cx, dx = cpu.dx;
        pend = {
            n: cpu.ax & 0xff, s: cx & 0x3f, h: (dx >> 8) & 0xff,
            c: ((cx >> 8) & 0xff) | ((cx & 0xc0) << 2),
            dest: ((cpu.es << 4) + cpu.bx) & 0xfffff, sp: cpu.sp, step: i,
        };
    } else if (pend && cpu.sp > pend.sp && cpu.cs !== H_SEG) {
        const p = pend; pend = null; checked++;
        const ah = (cpu.ax >> 8) & 0xff, cf = cpu.flags & 1;
        const want = img.subarray(lba(p.c, p.h, p.s), lba(p.c, p.h, p.s) + p.n * 512);
        const got = m.mem.subarray(p.dest, p.dest + p.n * 512);
        let diff = -1;
        if (want.length === got.length)
            for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) { diff = k; break; }
        const where = `c${p.c} h${p.h} s${p.s} n${p.n}`;
        if (ah !== 0 || cf) {
            badStatus++;
            if (problems.length < 20) problems.push(`  step ${p.step}  ${where} -> AH=${ah.toString(16)} CF=${cf}`);
        } else if (diff >= 0) {
            badData++;
            if (problems.length < 20) problems.push(
                `  step ${p.step}  ${where} DATA WRONG at byte ${diff} (sector ${Math.floor(diff / 512)}):`
                + ` got ${got[diff].toString(16)} want ${want[diff].toString(16)}`);
        }
    }
    m.step();
}

console.log(`\nINT 13h AH=02h calls completed: ${checked}`);
console.log(`  wrong status : ${badStatus}`);
console.log(`  wrong DATA   : ${badData}`);
if (problems.length) { console.log('\nfirst problems:'); console.log(problems.join('\n')); }
if (checked === 0) { console.log('\nINCONCLUSIVE: zero reads observed. This is NOT a pass.'); process.exit(2); }
if (badStatus || badData) process.exit(1);
console.log(`\nall ${checked} observed reads returned correct data.`);
