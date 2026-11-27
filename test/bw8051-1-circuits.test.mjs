// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';
import {root, machine, missingEmulator} from './fixtures/bw8051_1/harness.mjs';

registerAllDevices();

function circuit(id) {
    return JSON.parse(readFileSync(path.join(root, 'circuits', id + '.json'), 'utf8'));
}

function boardFor(netlist) {
    const board = new BoardImpl(netlist.vcc);
    board.setNetlist(netlist.parts, netlist.nets);
    return board;
}

// The full display is qualified below. The longer RTC and ADC endpoint tests
// retain the real DS1302, rails, crystal, battery and input circuits, but remove
// the display loads to avoid solving 32 LED junctions for every scan edge.
function clockWithoutDisplay() {
    const netlist = circuit('clock-mod4');
    netlist.parts = netlist.parts.filter(p => !/^([DQ][0-3]|R[BS][0-7])$/.test(p.id));
    const ids = new Set(netlist.parts.map(p => p.id));
    netlist.nets = netlist.nets.map(n => ({
        ...n, terminals: n.terminals.filter(t => ids.has(t.part)),
    })).filter(n => n.terminals.length > 1);
    return boardFor(netlist);
}

test('bw8051_1 hourglass: selected LED conducts, unselected high-impedance LED stays dark', {skip: missingEmulator}, async () => {
    const board = boardFor(circuit('hourglass-stage2'));
    const m = await machine('hourglass-stage2', board);
    try {
        m.adapter.runNs(40_000_000);
        assert.ok(board.ledBrightness('L1') > 0.02, 'P3.0 sources current through R1 and L1 to P1.0');
        assert.ok(board.ledBrightness('L2') < 1e-6, 'releasing the unselected anode prevents ghost current');
        assert.deepEqual(board.getWarnings(), []);
    } finally { m.adapter.destroy(); }
});

test('bw8051_1 clock: RTC time lights 12:34 through real common-anode and PNP wiring', {skip: missingEmulator}, async () => {
    const board = boardFor(circuit('clock-mod4'));
    // Declared initial state of the external RTC. The MCU must enable its
    // oscillator and read the time over the three physical signal nets.
    Object.assign(board.getDeviceState('RTC'), {hour: 12, min: 34, sec: 56});
    const m = await machine('clock-mod4', board);
    try {
        m.adapter.runNs(150_000_000);
        assert.equal(board.getDeviceState('RTC').ch, false, 'guest clears the oscillator halt bit');
        assert.deepEqual(m.readBytes('_rtc_table', 3), [0x56, 0x34, 0x12]);
        assert.deepEqual(m.readBytes('_frameBuffer', 4), [1, 2, 3, 4]);
        // Conventional digit shapes are independent of the guest's bit masks.
        // D2 also proves the rotated third package is connected correctly.
        const expected = ['bc', 'abdeg', 'abcdg', 'bcfg'];
        for (let digit = 0; digit < 4; digit++) {
            const brightness = board.sevenSegmentBrightness('D' + digit);
            for (const segment of 'abcdefg') {
                if (expected[digit].includes(segment)) {
                    assert.ok(brightness[segment] > 0.02, `D${digit}.${segment} must conduct`);
                } else {
                    assert.ok(brightness[segment] < 1e-5, `D${digit}.${segment} must stay dark`);
                }
            }
        }
        assert.deepEqual(board.getWarnings(), []);
    } finally { m.adapter.destroy(); }
});

for (const volts of [0, 5]) {
    test(`bw8051_1 clock: ${volts} V temperature input cannot trap the main loop`, {skip: missingEmulator}, async () => {
        const board = clockWithoutDisplay();
        board.setControl('TEMP', volts / 5);
        Object.assign(board.getDeviceState('RTC'), {hour: 12, min: 34, sec: 56});
        const m = await machine('clock-mod4', board);
        try {
            m.adapter.runNs(150_000_000);
            assert.ok(Math.abs(board.readAnalog('P1.7') - volts) < 0.02, 'external ADC voltage reaches the pin');
            assert.equal(m.wasm._emu_get_sfr(0x9d) & 0xc0, 0xc0, 'both ADC pins have P1ASF enabled');
            // These writes occur after temperature conversion in the main loop;
            // timer IRQs alone cannot satisfy them if the lookup gets stuck.
            assert.deepEqual(m.readBytes('_rtc_table', 3), [0x56, 0x34, 0x12]);
            assert.deepEqual(m.readBytes('_frameBuffer', 4), [1, 2, 3, 4]);
        } finally { m.adapter.destroy(); }
    });
}

test('bw8051_1 clock: physical RTC rollover reaches guest RAM and the next display frame', {skip: missingEmulator}, async () => {
    const board = clockWithoutDisplay();
    Object.assign(board.getDeviceState('RTC'), {hour: 12, min: 59, sec: 59});
    const m = await machine('clock-mod4', board);
    try {
        m.adapter.runNs(150_000_000);
        assert.deepEqual(m.readBytes('_rtc_table', 3), [0x59, 0x59, 0x12]);
        assert.deepEqual(m.readBytes('_frameBuffer', 4), [1, 2, 5, 9]);
        m.adapter.runNs(1_000_000_000);
        const rtc = board.getDeviceState('RTC');
        assert.deepEqual([rtc.sec, rtc.min, rtc.hour], [0, 0, 13]);
        assert.deepEqual(m.readBytes('_rtc_table', 3), [0x00, 0x00, 0x13]);
        assert.deepEqual(m.readBytes('_frameBuffer', 4), [1, 3, 0, 0]);
        assert.deepEqual(board.getWarnings(), []);
    } finally { m.adapter.destroy(); }
});
