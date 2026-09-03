// The PC speaker: 8255 port B bits 0/1 gating 8254 counter 2 into the cone.
// The direct tests pin the {hz, on} arithmetic; the machine test drives the
// real chips through the XT port map (8255 at 60h, 8254 at 40h) exactly as a
// corpus program does — OUT 43h/42h to set the tone, OUT 61h to sound it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCSpeaker } from '../src/pc-speaker.js';
import { I8086Machine } from '../src/i8086-machine.js';

test('a tone sounds only when BOTH gate and data are set', () => {
    const spk = new PCSpeaker({ readDivisor: () => 1193 });
    assert.deepEqual(spk.audioTone(), { hz: 0, on: false }, 'silent at reset');
    spk.setControl(0x01);   // gate only
    assert.equal(spk.on, false, 'gate without data is silent');
    spk.setControl(0x02);   // data only
    assert.equal(spk.on, false, 'data without gate is silent');
    spk.setControl(0x03);   // both
    assert.equal(spk.on, true);
    assert.deepEqual(spk.audioTone(), { hz: 1000, on: true }, '1193182/1193 ~ 1000 Hz');
});

test('the pitch is 1193182 / divisor, and divisor 0 means 65536', () => {
    let div = 2385;                                   // ~500 Hz
    const spk = new PCSpeaker({ readDivisor: () => div });
    spk.setControl(0x03);
    assert.equal(spk.audioTone().hz, 500);
    div = 0;                                          // wraps to 65536
    assert.equal(spk.audioTone().hz, Math.round(1_193_182 / 0x10000));   // ~18 Hz
});

test('state round-trips', () => {
    const spk = new PCSpeaker({ readDivisor: () => 100 });
    spk.setControl(0x03);
    const s = new PCSpeaker({ readDivisor: () => 100 });
    s.setState(spk.getState());
    assert.equal(s.on, true);
});

// ---------------------------------------------------------------------------
test('the machine wires 61h -> counter 2 -> a {hz, on} readout', () => {
    const m = new I8086Machine({
        clockHz: 4_770_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'ppi', name: 'ppi1', at: 0x60 },     // XT: 8255 at 60-63h
            { kind: 'pit', name: 'pit1', at: 0x40 },     // XT: 8254 at 40-43h
            { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
        ],
    });

    // 8255: all ports output (so port B drives the speaker gate).
    m._out(0x63, 0x80);
    // 8254 counter 2, mode 3 (square wave), divisor for ~1000 Hz.
    m._out(0x43, 0xb6);
    m._out(0x42, 1193 & 0xff); m._out(0x42, (1193 >> 8) & 0xff);

    // The tone is programmed but the speaker is not connected yet.
    assert.deepEqual(m.audioTone(), { hz: 0, on: false });

    // OUT 61h, 3 — the classic "turn the speaker on" (gate + data).
    m._out(0x61, 0x03);
    assert.deepEqual(m.audioTone(), { hz: 1000, on: true }, 'the tone now sounds');

    // Change the divisor and the reported pitch follows (reads it live).
    m._out(0x42, 2385 & 0xff); m._out(0x42, (2385 >> 8) & 0xff);
    assert.equal(m.audioTone().hz, 500, 'reprogramming counter 2 changes the pitch');

    // OUT 61h, 0 — silence.
    m._out(0x61, 0x00);
    assert.deepEqual(m.audioTone(), { hz: 0, on: false });
});

test('configuring the 8255 (mode set) clears the speaker gate', () => {
    const m = new I8086Machine({
        clockHz: 4_770_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'ppi', name: 'ppi1', at: 0x60 },
            { kind: 'pit', name: 'pit1', at: 0x40 },
            { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
        ],
    });
    m._out(0x63, 0x80);
    m._out(0x43, 0xb6); m._out(0x42, 100); m._out(0x42, 0);
    m._out(0x61, 0x03);
    assert.equal(m.audioTone().on, true);
    // A fresh mode-set word clears port B's latch — the speaker goes quiet.
    m._out(0x63, 0x80);
    assert.equal(m.audioTone().on, false, 'mode-set cleared the gate bits');
});
