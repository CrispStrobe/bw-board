// runMediaBundle — the GPL Lab's brickwright-media.json contract made
// executable: manifest + fetched files → running machine, no app-side
// machine knowledge. The full-fat acceptance uses the REAL Bad Apple
// files when the run-local clone exists (GPL: never vendored, so CI
// without the clone skips that test HONESTLY and still checks the
// mechanics on a synthetic bundle).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { runMediaBundle } from '../src/machine-media.js';

// The Bad Apple manifest, as the GPL Lab ships it (our own authored
// contract file — the copyleft content it points at stays upstream).
const BADAPPLE_MANIFEST = {
    machine: 'eater6502',
    machineConfig: {
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 16383 }, { kind: 'rom', start: 32768, end: 65535 }],
        chips: [
            { kind: 'via', name: 'via1', at: 24576 },
            { kind: 'sdcard', name: 'sd1', via: 'via1', pins: { cs: 5, sck: 'ca2', mosi: 3, port: 'b', miso: 0, misoPort: 'a' } },
            { kind: 'framebuffer', name: 'vga', at: 8192, size: 8192 },
        ],
    },
    preload: { writes: [{ addr: 24578, value: 255, why: 'DDRB bench precondition' }] },
    slots: { rom: 'player.hex', 'sd-image': 'sd-image.bin' },
    entry: 6144,
};

test('mechanics: preload writes land, missing files error by name', async () => {
    const { machine, errors } = await runMediaBundle(
        { ...BADAPPLE_MANIFEST, slots: { rom: 'nope.bin' } }, {});
    assert.equal(machine.chips.via1.ddrb, 0xff, 'DDRB precondition applied');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].slot, 'rom');
    assert.match(errors[0].error, /nope\.bin/);
    assert.equal(machine.cpu.pc, 6144, 'entry honored even with load errors');
});

const repo = join(homedir(), 'code', 'Ben-Eater-Bad-Apple');
const haveGpl = existsSync(join(repo, 'BadApple37FPS.bin'));

test('the Bad Apple bundle runs end to end from its manifest',
    { skip: haveGpl ? false : 'run-local GPL clone absent (never vendored)' }, async () => {
        const files = {
            'player.hex': readFileSync(join(repo, 'BadApple37FPS.bin')),
            'sd-image.bin': readFileSync(join(repo, 'BApple-Intro-Single-SD.bin')),
        };
        const { machine, applied, errors } = await runMediaBundle(BADAPPLE_MANIFEST, files);
        assert.deepEqual(errors, []);
        assert.deepEqual(applied.sort(), ['rom', 'sd-image']);
        machine.advanceToMs(1500);
        const fb = machine.chips.vga;
        assert.ok(fb.frame > 50_000, `expected >50k framebuffer writes, got ${fb.frame}`);
        const snap1 = Buffer.from(fb.buf).toString('hex');
        machine.advanceToMs(3000);
        const snap2 = Buffer.from(fb.buf).toString('hex');
        assert.notEqual(snap1, snap2, 'frames move');
    });
