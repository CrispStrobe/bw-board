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
/**
 * Supply INT 13h AH=08h's floppy DRIVE TYPE in BL, the way a real PC/AT BIOS
 * does — 01h=360K, 02h=1.2M, 03h=720K, 04h=1.44M, 05h=2.88M — WITHOUT touching
 * the ROM or the machine core.
 *
 * WHY THIS IS A HOOK AND NOT A ROM/CORE CHANGE. The ROM's AH=08h (`d_params`)
 * is XT-shaped: it answers the geometry (CH/CL/DH/DL and ES:DI) but leaves BX
 * untouched, so BL round-trips the caller's value and a guest that reads it
 * gets 0. rom/bios.asm is content-pinned by a frozen receipt, and the machine
 * core is bound by the DOS/FreeDOS persistence receipts, so neither can carry
 * this. It is also not NEEDED by DOS/FreeDOS/Windows — only by a guest that
 * trusts the AT CMOS drive-type byte. ELKS does: `bios_getfdinfo` does
 * `*drivep = fd_types[(BL & 0xFF) - 1]`, so BL=0 indexes `fd_types[-1]`, whose
 * sector_size word reads as 256 rather than 512; every 1024-byte block then
 * maps to `blocknr * (1024/256) = blocknr*4` sectors instead of *2, the root
 * directory (block 9) is read from LBA 36 not 18, comes back garbage, and
 * `/bin/init` is never found — panic "No init". So the ELKS setup opts in here.
 *
 * The machine fires onInterrupt at INT ENTRY (i8086 `_swInt`: onInterrupt then
 * `_interrupt(n)`), before the ROM handler runs, and the handler preserves BX
 * through to its IRET — so a value written here is what the guest reads back.
 * Scoped to floppies (DL < 80h) with real media, so the HDD path is untouched.
 */
function installFloppyDriveType(machine) {
    const prior = machine.hooks.onInterrupt;
    machine.hooks.onInterrupt = (ev) => {
        if (ev.vector === 0x13 && ev.source === 'int') {
            const cpu = machine.cpu;
            if (cpu.ah === 0x08 && cpu.dl < 0x80) {
                const geom = machine.chips.fdc1?.drives?.[cpu.dl & 3]?.geom;
                if (geom) {
                    const cyl = geom.cylinders | 0, spt = geom.sectors | 0;
                    cpu.bl = cyl <= 40 ? 1 : spt >= 36 ? 5 : spt >= 18 ? 4 : spt >= 15 ? 2 : 3;
                }
            }
        }
        if (prior) prior(ev);
    };
}

function bootElks(steps) {
    const img = readFileSync(IMAGE);
    const m = new I8086Machine(PCXT8086);
    installFloppyDriveType(m);
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
    // The kernel sizes the disk and reports its geometry. This once read
    // `/fd0: probed/`, which matched the "probed, probably" fallback the kernel
    // prints ONLY when it cannot read the boot sector's parameter block — the
    // symptom of the sector_size=256 bug (INT 13h AH=08h returned no drive type
    // in BL, see i8086-machine _biosFloppyDriveType). With the drive type now
    // supplied, ELKS reads the boot sector, recognises the ELKS parameter block
    // and reports the geometry directly, so assert the geometry the kernel
    // determined rather than the fallback wording that only a broken read reaches.
    assert.ok(/80 cylinders, 2 heads, and 18 sectors/.test(s),
        'the kernel never sized the floppy geometry');
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
