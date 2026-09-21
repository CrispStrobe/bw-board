#!/usr/bin/env node
/**
 * PROOF: the GPL-Lab ELKS `brickwright-media.json` is EXECUTABLE.
 *
 * Runs the exact manifest the lab ships (machine i8086 / PCXT8086, the
 * fd1440-fat.img floppy slot, 80/2/18 geometry, the at-floppy-drive-type
 * quirk) through `runI8086FloppyBundle` and checks that the official
 * ELKS v0.9.2 release image boots to its acceptance screen: kernel
 * banner, the sized floppy geometry, and the root mount.
 *
 * SKIPS LOUDLY when the image is absent — ELKS is GPL-2 and is never
 * vendored here, so run `projects/elks/fetch.sh` (or point $ELKS_IMAGE at
 * a v0.9.2 fd1440-fat.img) first. A silent skip would read like a pass.
 *
 * The manifest below MIRRORS brickwright-gpl-lab projects/elks/
 * brickwright-media.json; the lab README points back at this script.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runI8086FloppyBundle } from '../src/machine-media-i8086.js';
import { buildBios } from './build-bios.mjs';

const IMAGE = process.env.ELKS_IMAGE
    || '/mnt/volume1/code/elks-images/fd1440-fat-official-v0.9.2.img';

const MANIFEST = {
    title: 'ELKS 0.9.2 (Embeddable Linux Kernel Subset)',
    machine: 'i8086',
    machineConfig: 'PCXT8086',
    slots: { floppy: 'fd1440-fat.img' },
    floppy: {
        geometry: { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 },
        quirks: ['at-floppy-drive-type'],
    },
    boot: true,
    steps: 4_000_000,
    expect: ['ELKS 0.9.2', '80 cylinders, 2 heads, and 18 sectors', 'Mounted root device'],
};

if (!existsSync(IMAGE)) {
    console.log(`SKIP: no ELKS image at ${IMAGE}.`);
    console.log('Run projects/elks/fetch.sh (GPL-2 image, fetched not vendored),');
    console.log('or set $ELKS_IMAGE to a v0.9.2 fd1440-fat.img. Nothing to boot.');
    process.exit(0);
}

const files = { 'fd1440-fat.img': readFileSync(IMAGE) };
const { screen, expect } = runI8086FloppyBundle(MANIFEST, files, { romBytes: buildBios().bytes });

let ok = true;
for (const e of expect) {
    console.log(`  [${e.ok ? 'PASS' : 'FAIL'}] ${e.text}`);
    ok = ok && e.ok;
}
if (!ok) {
    console.log('\n--- screen ---\n' + screen.replace(/ {2,}/g, ' ').trim().slice(0, 400));
    console.error('\nELKS media bundle did NOT reach its acceptance screen.');
    process.exit(1);
}
console.log('\nELKS media bundle is executable: booted to a mounted root filesystem.');
