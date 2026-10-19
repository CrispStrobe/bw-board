/**
 * The bw-board half of brickwright-lite's seven lesson-review waves.
 *
 * Each test names the wave review that measured the defect and the lesson it
 * cost. They are ordinary regression tests — the point of writing them here
 * rather than downstream is that the downstream repo vendors this one, so a
 * gate that lives only in lite cannot stop the defect coming back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { ControllerPanel, WIDGET_TYPES, WIDGET_DEFAULTS } from '../src/controller.js';
import { WIDGET_RENDER_INFO } from '../src/controller-stage-view.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ── D19: the ammeter contradicted itself on a transistor terminal ──────────
// docs/LESSON-REVIEW-WAVE-1.md defect 6 (electricity-transistor-switch).
//
// 38-npn-switch, reduced to its series loop: VCC -> 470R -> LED -> collector,
// emitter -> GND, with a 10k base resistor behind a button.
function npnSwitchBench() {
    const parts = [
        { id: 'vcc1', kind: 'vcc', terminals: ['vcc'], params: {} },
        { id: 'gnd1', kind: 'gnd', terminals: ['gnd'], params: {} },
        { id: 'r1', kind: 'resistor', terminals: ['a', 'b'], params: { ohms: 470 } },
        { id: 'led1', kind: 'led', terminals: ['anode', 'cathode'], params: { vf: 2.0 } },
        { id: 'q1', kind: 'npn', terminals: ['base', 'collector', 'emitter'], params: { beta: 100 } },
        { id: 'btn1', kind: 'button', terminals: ['a', 'b'], params: {} },
        { id: 'rb1', kind: 'resistor', terminals: ['a', 'b'], params: { ohms: 10000 } },
    ];
    const nets = [
        { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }, { part: 'btn1', terminal: 'a' }] },
        { id: 'n_led', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
        { id: 'n_col', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'q1', terminal: 'collector' }] },
        { id: 'n_btn', terminals: [{ part: 'btn1', terminal: 'b' }, { part: 'rb1', terminal: 'a' }] },
        { id: 'n_base', terminals: [{ part: 'rb1', terminal: 'b' }, { part: 'q1', terminal: 'base' }] },
        { id: 'gnd', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'q1', terminal: 'emitter' }] },
    ];
    const b = new BoardImpl();
    b.setNetlist(parts, nets);
    return b;
}

const mA = (board, part, terminal) => Math.abs(board.branchCurrent(part, terminal)) * 1000;

test('a saturated BJT reports the current its LOAD passes, not beta times Ib', () => {
    const b = npnSwitchBench();
    b.setControl('btn1', 1);
    b.advanceTo(50_000_000n);

    // The transistor really is saturated — this is the precondition, not the claim.
    assert.ok(b.nodeVoltage('n_col') < 0.4,
        `collector should sit near Vce(sat), saw ${b.nodeVoltage('n_col')} V`);

    // One series loop, so one current: r1 -> led1 -> q1.collector.
    const load = mA(b, 'r1', 'b');
    assert.ok(load > 4 && load < 8, `load current out of range: ${load} mA`);
    for (const [part, terminal] of [['led1', 'anode'], ['q1', 'collector']]) {
        assert.ok(Math.abs(mA(b, part, terminal) - load) < 0.01,
            `${part}.${terminal} reads ${mA(b, part, terminal)} mA against ${load} mA in the ` +
            'same series loop. beta*Ib is what the VCCS DEMANDS; the stamp replaces it with a ' +
            'Vce clamp in saturation and the extraction must agree.');
    }
});

test('a closed button carries the current of the branch it is in, not a flat zero', () => {
    const b = npnSwitchBench();
    b.setControl('btn1', 1);
    b.advanceTo(50_000_000n);
    const base = mA(b, 'rb1', 'b');
    assert.ok(base > 0.1, `base branch should carry current, saw ${base} mA`);
    for (const terminal of ['a', 'b']) {
        assert.ok(Math.abs(mA(b, 'btn1', terminal) - base) < 0.001,
            `btn1.${terminal} reads ${mA(b, 'btn1', terminal)} mA while rb1 in series with it ` +
            `carries ${base} mA. A flat 0 is indistinguishable from an open circuit.`);
    }
});

test('an open button carries no current, so the reading still distinguishes the two states', () => {
    const b = npnSwitchBench();
    b.advanceTo(50_000_000n);
    assert.ok(mA(b, 'btn1', 'b') < 1e-3, 'an open button must read ~0 mA');
});

// ── D34: the dc_motor's DC operating point must not depend on the step ─────
// docs/LESSON-REVIEW-WAVE-1.md defect 7 (pc26-motor-clamp/EXPECTED.md).
test('a dc_motor honours its declared winding resistance at every step size', () => {
    const parts = [
        { id: 'vcc1', kind: 'vcc', terminals: ['vcc'], params: { volts: 9 } },
        { id: 'gnd1', kind: 'gnd', terminals: ['gnd'], params: {} },
        { id: 'motor1', kind: 'dc_motor', terminals: ['a', 'b'], params: { windingR: 10, kV: 0 } },
    ];
    const nets = [
        { id: 'n_p', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'motor1', terminal: 'a' }] },
        { id: 'gnd', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'motor1', terminal: 'b' }] },
    ];
    const readings = [];
    for (const stepUs of [100, 1000, 10000, 50000]) {
        const b = new BoardImpl();
        b.setNetlist(structuredClone(parts), structuredClone(nets));
        let t = 0n;
        while (t < 50_000_000n) { t += BigInt(stepUs) * 1000n; b.advanceTo(t > 50_000_000n ? 50_000_000n : t); }
        readings.push(Math.abs(b.branchCurrent('motor1', 'a')));
    }
    for (const i of readings) {
        assert.ok(Math.abs(i - 0.9) < 0.02,
            `9 V across a declared 10 ohm winding is 0.9 A; read ${i.toFixed(4)} A. ` +
            'A DC operating point that moves with dt means the inductor companion is stamped ' +
            'in PARALLEL with 1/R rather than in series with it.');
    }
    assert.ok(Math.max(...readings) - Math.min(...readings) < 1e-3,
        `the answer moved with the step size: ${readings.map(v => v.toFixed(4)).join(' ')}`);
});

// ── D17: char_lcd_i2c had no control() handler ─────────────────────────────
// docs/LESSON-REVIEW-WAVE-2.md defect 1 (measurement-current-burden).
test('char_lcd_i2c accepts the same high-level verbs every other display does', () => {
    const parts = [
        { id: 'vcc1', kind: 'vcc', terminals: ['vcc'], params: {} },
        { id: 'gnd1', kind: 'gnd', terminals: ['gnd'], params: {} },
        { id: 'lcd1', kind: 'char_lcd_i2c', terminals: ['sda', 'scl', 'vcc', 'gnd'],
            params: { address: 0x27, cols: 16, rows: 2 } },
    ];
    const nets = [
        { id: 'n_v', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'lcd1', terminal: 'vcc' }] },
        { id: 'gnd', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'lcd1', terminal: 'gnd' }] },
        { id: 'n_sda', terminals: [{ part: 'lcd1', terminal: 'sda' }] },
        { id: 'n_scl', terminals: [{ part: 'lcd1', terminal: 'scl' }] },
    ];
    const b = new BoardImpl();
    b.setNetlist(parts, nets);
    b.advanceTo(1_000_000n);

    assert.equal(b.setDeviceControl('lcd1', 'clear', 1), true, 'clear must be accepted');
    assert.equal(b.setDeviceControl('lcd1', 'cursor', [0, 0]), true, 'cursor must be accepted');
    assert.equal(b.setDeviceControl('lcd1', 'print', 'I = 9.8 mA'), true, 'print must be accepted');

    const state = b.getDeviceState('lcd1');
    assert.ok(String(state.display[0]).startsWith('I = 9.8 mA'),
        `row 0 reads ${JSON.stringify(state.display[0])} — the verb path must write the same ` +
        'display rows the I2C decode writes');

    // Row 1, so the cursor verb is doing something rather than being ignored.
    b.setDeviceControl('lcd1', 'cursor', [1, 2]);
    b.setDeviceControl('lcd1', 'print', 'ok');
    assert.equal(b.getDeviceState('lcd1').display[1].slice(0, 4), '  ok');

    // And clear really clears.
    b.setDeviceControl('lcd1', 'clear', 1);
    assert.deepEqual(b.getDeviceState('lcd1').display, ['                ', '                ']);
});

// ── D33: an example declared a widget type the panel did not have ──────────
// docs/LESSON-REVIEW-WAVE-4.md defect 8 (6502-terminal).
test('the terminal widget exists, and shows the TAIL of a growing transcript', () => {
    const panel = new ControllerPanel();
    const w = panel.addWidget('screen', 'terminal', { rows: 3, cols: 10 });
    assert.equal(w.type, 'terminal');
    panel.setTerminalText('screen', 'one\ntwo\nthree\nfour');
    assert.deepEqual(panel.getTerminalRows('screen'),
        ['two       ', 'three     ', 'four      '],
        'a terminal must show its LAST rows — anchoring at line 0 freezes the face on the ' +
        'first screenful and never shows what the program just printed');
});

test('a terminal wraps a long line rather than dropping its end', () => {
    const panel = new ControllerPanel();
    panel.addWidget('screen', 'terminal', { rows: 2, cols: 4 });
    panel.setTerminalText('screen', 'abcdefgh');
    assert.deepEqual(panel.getTerminalRows('screen'), ['abcd', 'efgh']);
});

test('a transcript ending in a newline keeps its cursor line', () => {
    const panel = new ControllerPanel();
    panel.addWidget('screen', 'terminal', { rows: 2, cols: 4 });
    panel.setTerminalText('screen', 'ab\n');
    assert.deepEqual(panel.getTerminalRows('screen'), ['ab  ', '    '],
        'a prompt written with a trailing newline must not render like one written without');
});

// ── D5: the panel's own persistence dropped the mode ───────────────────────
// docs/LESSON-REVIEW-WAVE-4.md defect 5b.
test('toJSON carries the mode, so a play-mode faceplate survives a round trip', () => {
    const panel = new ControllerPanel();
    panel.addWidget('go', 'button');
    panel.setMode('play');
    const json = panel.toJSON();
    assert.equal(json.mode, 'play', 'a layout that does not record its mode opens in edit, ' +
        'where every input control renders disabled');
    assert.equal(ControllerPanel.fromJSON(json).mode, 'play');
});

test('a layout written before the mode field existed still restores as edit', () => {
    const legacy = { version: 1, widgets: [{ name: 'go', type: 'button', config: {}, layout: {}, binding: null }] };
    assert.equal(ControllerPanel.fromJSON(legacy).mode, 'edit');
});

// ── The contracts a host reads, which nothing asserted were complete ───────
test('every declared widget type has a default config and a render descriptor', () => {
    for (const type of Object.values(WIDGET_TYPES)) {
        assert.ok(WIDGET_DEFAULTS[type],
            `${type} is in WIDGET_TYPES with no entry in WIDGET_DEFAULTS — addWidget throws on it`);
        assert.ok(WIDGET_RENDER_INFO[type],
            `${type} has no render descriptor, so a host reading renderInfo[type] gets undefined ` +
            'and has to invent a size');
    }
});
