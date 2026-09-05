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
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { buildBios } from '../scripts/build-bios.mjs';

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

/**
 * ELKS ON REAL EMULATED HARDWARE — and the machine choice is the whole story.
 *
 * The first version of this file booted ELKS on DOSBOX8086 through the DOS
 * service layer, and concluded the kernel "executes across 263 code pages
 * without producing console output" with where it goes next left open. That
 * conclusion was an artefact of the machine: **DOSBOX8086 HAS NO 8259**, so
 * `_serviceInterrupts` returns at `if (!this._pic)` and no hardware interrupt
 * can ever be delivered. Measured: zero IRQs across eight million
 * instructions while IF stayed set — a kernel waiting for a timer tick that
 * could not arrive, which looks exactly like a kernel doing mysterious work.
 *
 * On PCXT8086 with our own BIOS ROM and the uPD765, ELKS boots completely:
 * probes the hardware, sizes the floppy, mounts its root filesystem, and
 * panics only because this image carries no userland.
 */
function bootElks(steps) {
    const img = readFileSync(IMAGE);
    const m = new I8086Machine(PCXT8086);
    m.loadRom(buildBios().bytes);
    m.chips.fdc1.insert(0, img,
        { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 });
    m.reset();
    for (let i = 0; i < steps; i++) m.step();
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

test('ELKS boots: kernel initialises, sizes the disk and MOUNTS ITS ROOT', { skip }, () => {
    // Measured: banner at 1.31M instructions, root mounted at 2.36M, panic at
    // 2.62M. 4M is comfortable headroom and runs in about 12 seconds.
    const s = screenText(bootElks(4_000_000));
    assert.ok(s.includes('ELKS 0.9.1'),
        `no ELKS kernel banner. Screen: ${JSON.stringify(s.trim().slice(0, 200))}`);
    assert.ok(/fd0: probed/.test(s), 'the kernel never probed the floppy geometry');
    assert.ok(s.includes('Mounted root device'),
        'the kernel did not mount a root filesystem — the strongest single claim '
        + 'this test makes, since it needs the FDC, the DMA controller, the 8259 '
        + 'and the BIOS to have all worked together');
});

test('the hardware the kernel needs is actually driving it', { skip }, () => {
    // The FIRST version of this file asserted a page count and concluded
    // "the kernel is doing work". It was waiting on an interrupt that could
    // never arrive, because the machine had no PIC. So assert the CAUSE
    // rather than a symptom: both interrupt sources must fire.
    const irqs = new Map();
    const img = readFileSync(IMAGE);
    const m = new I8086Machine(PCXT8086, {
        onInterrupt: ({ vector, source }) => {
            if (source === 'irq') irqs.set(vector, (irqs.get(vector) || 0) + 1);
        },
    });
    m.loadRom(buildBios().bytes);
    m.chips.fdc1.insert(0, img,
        { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 });
    m.reset();
    for (let i = 0; i < 4_000_000; i++) m.step();

    assert.ok(m._pic, 'PCXT8086 has no PIC — no hardware interrupt can be delivered at all');
    assert.ok((irqs.get(8) || 0) > 10,
        `only ${irqs.get(8) || 0} timer interrupts (vector 8) in 4M instructions; `
        + 'ELKS schedules on the tick and a kernel without one merely spins');
    assert.ok((irqs.get(0x0e) || 0) > 0,
        `no FDC interrupts (vector 0x0e); the root mount above cannot have come `
        + 'from real disk hardware');
});
