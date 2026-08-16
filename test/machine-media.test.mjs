// machine-media — the describable "load software onto the machine"
// surface. What these pin down: slots describe truthfully per kind, a
// raw ROM lands at its slot address, Intel HEX self-locates, and the
// multi-file case (both 128K ROM pages in one entries map) applies
// atomically with honest per-slot errors for what cannot load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMedia, applyMedia, parseIhex } from '../src/machine-media.js';
import { M6502Machine, GPASCAL } from '../src/m6502-machine.js';

test('slots describe per kind; MCU kinds have none (they flash)', () => {
    assert.ok(describeMedia('eater6502').some((s) => s.id === 'rom'));
    assert.equal(describeMedia('zx128').filter((s) => s.id.startsWith('rom')).length, 2);
    assert.deepEqual(describeMedia('avr8js'), []);
});

test('parseIhex self-locates', () => {
    // two bytes at $8000: A9 42 (LDA #$42)
    const { bytes, origin } = parseIhex(':02800000A94293\n:00000001FF\n');
    assert.equal(origin, 0x8000);
    assert.deepEqual([...bytes], [0xa9, 0x42]);
});

test('a raw ROM applies to a live 6502 machine at the slot address', () => {
    const m = new M6502Machine(GPASCAL, {});
    const rom = new Uint8Array(0x8000).fill(0xea);
    rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;
    const { applied, errors } = applyMedia({ machine: m, kind: 'gpascal' }, { rom });
    assert.deepEqual(applied, ['rom']);
    assert.deepEqual(errors, []);
    assert.equal(m.mem[0x8000], 0xea);
    assert.equal(m.mem[0xfffd], 0x80);
});

test('multi-file: both 128K ROM pages in one map; failures stay per-slot', () => {
    const roms = [new Uint8Array(0x4000), new Uint8Array(0x4000)];
    const machine = { roms };
    const page0 = new Uint8Array(0x4000).fill(1);
    const page1 = new Uint8Array(0x4000).fill(2);
    const { applied, errors } = applyMedia({ machine, kind: 'zx128' },
        { rom0: page0, rom1: page1, tape: new Uint8Array(4) });
    assert.deepEqual(applied.sort(), ['rom0', 'rom1']);
    assert.equal(roms[0][0], 1);
    assert.equal(roms[1][0], 2);
    // the fake machine has no tape deck: that slot errors, the ROMs stand
    assert.equal(errors.length, 1);
    assert.equal(errors[0].slot, 'tape');
});

test('unknown slots are named, not thrown', () => {
    const { applied, errors } = applyMedia({ machine: {}, kind: 'eater6502' },
        { floppy: new Uint8Array(1) });
    assert.deepEqual(applied, []);
    assert.equal(errors[0].slot, 'floppy');
    assert.match(errors[0].error, /unknown slot/);
});

// ── AT24C64 EEPROM media slot ────────────────────────────────────

test('describeMedia adds eeprom slot when circuit has at24c64 part', () => {
    const parts = [
        { id: 'eep1', kind: 'at24c64', declName: 'animStore' },
        { id: 'mcu', kind: 'mcu' },
    ];
    const slots = describeMedia('eater6502', { parts });
    const eepromSlot = slots.find(s => s.id === 'eeprom:eep1');
    assert.ok(eepromSlot, 'should have eeprom slot for at24c64 part');
    assert.match(eepromSlot.label, /animStore/);
    assert.ok(eepromSlot.accept.includes('.bin'));
    assert.ok(eepromSlot.accept.includes('.hex'));
});

test('describeMedia returns no eeprom slot when no at24c64 in circuit', () => {
    const parts = [{ id: 'mcu', kind: 'mcu' }];
    const slots = describeMedia('eater6502', { parts });
    assert.ok(!slots.some(s => s.id.startsWith('eeprom:')));
});

test('describeMedia with no parts option still works (backward compat)', () => {
    const slots = describeMedia('eater6502');
    assert.ok(slots.some(s => s.id === 'rom'));
    assert.ok(!slots.some(s => s.id.startsWith('eeprom:')));
});

test('applyMedia eeprom slot writes contents via board.setPartParam', () => {
    const parts = [{ id: 'eep1', kind: 'at24c64', declName: 'store' }];
    const written = {};
    const board = {
        setPartParam(partId, param, value) { written[`${partId}.${param}`] = value; },
    };
    const data = new Uint8Array([0x41, 0x42, 0x43]);
    const { applied, errors } = applyMedia(
        { machine: {}, kind: 'eater6502' },
        { 'eeprom:eep1': data },
        { parts, board },
    );
    assert.deepEqual(applied, ['eeprom:eep1']);
    assert.deepEqual(errors, []);
    assert.deepEqual(written['eep1.contents'], [0x41, 0x42, 0x43]);
});

test('applyMedia eeprom slot rejects files > 8192 bytes', () => {
    const parts = [{ id: 'eep1', kind: 'at24c64' }];
    const big = new Uint8Array(8193);
    const { applied, errors } = applyMedia(
        { machine: {}, kind: 'eater6502' },
        { 'eeprom:eep1': big },
        { parts },
    );
    assert.deepEqual(applied, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /exceeds.*8192/);
});

test('applyMedia eeprom slot accepts Intel HEX', () => {
    const parts = [{ id: 'eep1', kind: 'at24c64' }];
    const written = {};
    const board = {
        setPartParam(partId, param, value) { written[`${partId}.${param}`] = value; },
    };
    // Two bytes at address 0: 0xA9, 0x42
    const hex = ':02000000A94214\n:00000001FF\n';
    const hexBytes = new TextEncoder().encode(hex);
    const { applied, errors } = applyMedia(
        { machine: {}, kind: 'eater6502' },
        { 'eeprom:eep1': hexBytes },
        { parts, board },
    );
    assert.deepEqual(applied, ['eeprom:eep1']);
    assert.deepEqual(errors, []);
    assert.deepEqual(written['eep1.contents'], [0xa9, 0x42]);
});
