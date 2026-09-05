/**
 * E6.8.8 — a real OS as the acceptance target: ELKS.
 *
 * ELKS (Embeddable Linux Kernel Subset) is a genuine 16-bit OS for the 8086.
 * It is the first third-party OS this tier has run: not a program we
 * assembled, not a service answered one call at a time, but a kernel that
 * boots itself, probes the hardware and takes over the machine.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT. Setup runs, detects
 * hardware, and reaches its handoff — that is a reproducible acceptance
 * signal and it is what this file pins. It does NOT assert a shell prompt or
 * a kernel banner: measured 2026-09-05, the kernel then executes across 263
 * distinct code pages without producing console output within twelve million
 * instructions. That is real work rather than a hang, and characterising it
 * further is open (ROADMAP E6.8.8). Asserting a prompt we have not seen would
 * be a test written against a hope.
 *
 * THE IMAGE IS NOT VENDORED AND NEVER WILL BE. ELKS is GPL-2; we run it as a
 * black-box workload, which the licence regime permits, and shipping it in a
 * BSD-3 bundle is not. So this file SKIPS LOUDLY when the image is absent —
 * a silent skip reads exactly like a pass, and this is the one file in the
 * tier whose absence would be least noticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';

const IMAGE = process.env.ELKS_IMAGE || '/mnt/volume1/code/elks-images/fd1440-fat.img';
const skip = existsSync(IMAGE) ? false
    : `SKIPPED: no ELKS image at ${IMAGE}. This file boots a real OS and has `
        + 'nothing to boot. Fetch fd1440-fat.img from '
        + 'github.com/ghaerr/elks/releases and point $ELKS_IMAGE at it. '
        + 'GPL-2: run it, never vendor it.';

/** The CGA text plane as one string — ELKS setup writes here directly. */
function screenText(m) {
    const v = m.mem.subarray(0xb8000, 0xb8000 + 80 * 25 * 2);
    let t = '';
    for (let i = 0; i < v.length; i += 2) {
        t += (v[i] >= 32 && v[i] < 127) ? String.fromCharCode(v[i]) : ' ';
    }
    return t;
}

function bootElks(steps) {
    const img = readFileSync(IMAGE);
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, { disk: img }).install();
    dos.loadBoot(img.subarray(0, 512), 0x00);
    for (let i = 0; i < steps; i++) dos.step();
    return m;
}

test('the image is a real ELKS floppy, so an absent oracle cannot look like a pass', { skip }, () => {
    const img = readFileSync(IMAGE);
    assert.equal(img.length, 1_474_560, 'not a 1.44 MB floppy image');
    assert.equal(String.fromCharCode(...img.subarray(3, 11)), 'ELKSFAT1',
        'OEM ID is not ELKSFAT1 — this is some other disk, and every assertion '
        + 'below would be about the wrong thing');
    assert.equal(img[510], 0x55, 'no boot signature');
    assert.equal(img[511], 0xaa, 'no boot signature');
});

test('ELKS boots: setup runs, probes the hardware and reaches its handoff', { skip }, () => {
    // 200k instructions; measured, all three markers appear by 65,536.
    const m = bootElks(200_000);
    const s = screenText(m);
    assert.ok(s.includes('ELKS'), `no ELKS banner on screen. Got: ${JSON.stringify(s.trim().slice(0, 120))}`);
    assert.ok(s.includes('Setup'), 'setup did not identify itself');
    assert.ok(s.includes('START'),
        'setup never reached START — it did not finish probing and hand off to the kernel');
});

test('the kernel takes over and runs, rather than halting or spinning', { skip }, () => {
    // MEASURED, AND THE FIRST VERSION OF THIS TEST WAS WRONG BECAUSE IT WAS NOT.
    // It sampled 200k-600k instructions and asserted "263 code pages" — a
    // number taken from the SECOND HALF of a twelve-million-instruction run.
    // In that early window ELKS touches ONE page, so the test failed against a
    // figure quoted from a different condition entirely. A score without its
    // split, applied to a test rather than a claim.
    //
    // Walking the boot in 500k windows shows the real shape:
    //
    //     to 0.5M   74 pages   in segment 1235   setup
    //     to 1.0M   25 pages   in segment 1235   narrowing
    //     to 1.5M  342 pages   in segment 4300   the KERNEL takes over
    //     to 12M   ~263 pages  in segment 4300   steady
    //
    // So the handoff completes around 1.5M instructions, and everything before
    // that is setup. This asserts after it.
    const m = bootElks(1_600_000);
    assert.equal(m.cpu.halted, false, 'the CPU halted after ELKS setup handed off');
    assert.equal(m.cpu.cs, 0x4300,
        `CS is ${m.cpu.cs.toString(16)}, expected 4300 — execution never left setup's `
        + 'segment, so the kernel did not take over');

    const pages = new Set();
    for (let i = 0; i < 300_000; i++) {
        m.step();
        if ((i & 0x3f) === 0) pages.add(`${m.cpu.cs.toString(16)}:${(m.cpu.ip & 0xff00).toString(16)}`);
    }
    assert.ok(pages.size > 50,
        `the kernel touched only ${pages.size} code pages, which is a spin rather than `
        + 'work — a steady ~263 was measured across the whole post-handoff run');
});
