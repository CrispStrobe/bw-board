// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root, manifest, sha256, firmware, machine, missingEmulator, PinProbe} from './fixtures/bw8051_1/harness.mjs';

test('bw8051_1 source, patch and firmware identities match the retained build', () => {
    const sources = JSON.parse(readFileSync(path.join(root, 'sources.json'), 'utf8'));
    for (const entry of sources.files) {
        assert.equal(sha256(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
    }
    assert.match(manifest.compiler.version, /SDCC.*\b4\.5\.0\b/);
    for (const program of manifest.programs) {
        firmware(program.id);
        for (const entry of [...program.sources, ...(program.patches ?? [])]) {
            assert.equal(sha256(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
        }
    }
    const clock = manifest.programs.find(p => p.id === 'clock-mod4');
    assert.ok(clock.flags.includes('-DMOD4'));
    assert.ok(!clock.flags.some(f => f.includes('WITH_NMEA')));
});

for (const [volts, expected] of [[0, 0], [1.25, 256], [2.5, 512], [5, 1023]]) {
    test(`bw8051_1 pinned HAL: GPIO modes and polled ADRJ=0 ADC at ${volts} V`, {skip: missingEmulator}, async () => {
        const probe = new PinProbe();
        probe.analog.set('P1.6', volts);
        const m = await machine('hal-gpio-adc', probe);
        try {
            m.adapter.runNs(1_000_000);
            assert.ok(m.wasm._emu_get_sfr(0xb0) & 0x80, 'guest reached its completion pin');
            const result = m.wasm._emu_get_sfr(0x80) | (m.wasm._emu_get_sfr(0xa0) << 8);
            assert.equal(result, expected, '10-bit result comes from declared voltage/VCC, not the HAL implementation');
            assert.equal(m.wasm._emu_get_pin_mode(1, 0), 1, 'P1.0 is push-pull');
            assert.equal(m.wasm._emu_get_pin_drive(1, 0), 0, 'P1.0 sinks');
            assert.equal(m.wasm._emu_get_pin_mode(1, 1), 2, 'unused P1.1 is high impedance');
            assert.equal(m.wasm._emu_get_pin_mode(1, 6), 2, 'ADC pin is input-only');
            assert.equal(m.wasm._emu_get_pin_mode(3, 1), 3, 'P3.1 is open drain');
        } finally { m.adapter.destroy(); }
    });
}

for (const [id, divider, duration] of [['hal-timer-1t', 1, 3_000_000], ['hal-timer-12t', 12, 20_000_000]]) {
    test(`bw8051_1 pinned HAL: ${id} gives repeated 1024-count interrupts`, {skip: missingEmulator}, async () => {
        const probe = new PinProbe();
        const m = await machine(id, probe);
        try {
            m.adapter.runNs(duration);
            const edges = probe.events.filter(e => e.pin === 'P1.0' && e.mode === 'pushpull' && e.timeNs > 100_000n);
            assert.ok(edges.length >= 10, `expected repeated IRQs, got ${edges.length}`);
            const expectedNs = 1024 * divider * 1e9 / 11_059_200;
            for (let i = 1; i < edges.length; i++) {
                assert.notEqual(edges[i].driveHigh, edges[i - 1].driveHigh, 'each ISR toggles the output');
                const actualNs = Number(edges[i].timeNs - edges[i - 1].timeNs);
                assert.ok(Math.abs(actualNs - expectedNs) < 5 * 1e9 / 11_059_200,
                    `1024 × ${divider} clocks: expected ${expectedNs} ns, got ${actualNs} ns`);
            }
        } finally { m.adapter.destroy(); }
    });
}

test('bw8051_1 upstream hourglass stage2 alternates selected LED drive and high impedance', {skip: missingEmulator}, async () => {
    const probe = new PinProbe();
    const m = await machine('hourglass-stage2', probe);
    try {
        m.adapter.runNs(40_000_000);
        const modes = probe.events.filter(e => e.pin === 'P1.0' && e.timeNs > 1_000_000n);
        assert.ok(modes.some(e => e.mode === 'pushpull' && !e.driveHigh), 'selected cathode sinks');
        assert.ok(modes.some(e => e.mode === 'input'), 'off phase releases the cathode');
        assert.ok(probe.events.some(e => e.pin === 'P3.0' && e.mode === 'pushpull' && e.driveHigh), 'selected anode sources');
        const on = modes.filter(e => e.mode === 'pushpull' && !e.driveHigh);
        assert.ok(on.length >= 3, 'multiple complete display periods ran');
        const expectedNs = 2 * 65536 * 1e9 / 11_059_200;
        for (let i = 1; i < on.length; i++) {
            const delta = Number(on[i].timeNs - on[i - 1].timeNs);
            assert.ok(Math.abs(delta - expectedNs) < 1000, `two 65536-count intervals, got ${delta} ns`);
        }
        assert.equal(m.wasm._emu_get_pin_mode(1, 1), 2, 'unused cathode remains high impedance');
        assert.equal(m.wasm._emu_get_pin_mode(3, 1), 2, 'unused anode remains high impedance');
    } finally { m.adapter.destroy(); }
});
