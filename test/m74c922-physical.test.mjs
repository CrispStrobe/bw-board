import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerTier2Parts} from '../src/devices/tier2-parts.js';
import {registerMiscParts} from '../src/devices/misc-parts.js';
import {M74C922} from '../src/m74c922.js';

registerMiscParts();
registerTier2Parts();

const net = (id, ...terminals) => ({id, terminals: terminals.map(([part, terminal]) => ({part, terminal}))});
const KP_TERMS = ['r0','r1','r2','r3','c0','c1','c2','c3'];
const ENC_TERMS = ['y1','y2','y3','y4','osc','kbm','x4','x3','vss','x2','x1','da','oeb','d','c','b','a','vcc'];

function rig({broken = null, outputBias = null} = {}) {
    const parts = [
        {id: 'V', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'K', kind: 'keypad_4x4', params: {pressed: -1}, terminals: KP_TERMS},
        {id: 'E', kind: '74c922', params: {}, terminals: ENC_TERMS},
        {id: 'M', kind: 'mcu', params: {}, terminals: ['oe','a','b','c','d','da']},
    ];
    const nets = [
        net('vcc', ['V','vcc'], ['E','vcc']),
        net('gnd', ['G','gnd'], ['E','vss']),
        net('oe', ['M','oe'], ['E','oeb']),
        ...['a','b','c','d','da'].map(p => net(`out-${p}`, ['M',p], ['E',p])),
    ];
    for (let row = 0; row < 4; row++) {
        if (broken !== `r${row}`) nets.push(net(`row-${row}`, ['K',`r${row}`], ['E',`y${row + 1}`]));
    }
    for (let col = 0; col < 4; col++) {
        if (broken !== `c${col}`) nets.push(net(`col-${col}`, ['K',`c${col}`], ['E',`x${col + 1}`]));
    }
    if (outputBias) {
        for (const bit of ['a','b','c','d']) {
            const id = `R-${bit}`;
            parts.push({id, kind: 'resistor', params: {ohms: 10_000}, terminals: ['a','b']});
            nets.find(n => n.id === `out-${bit}`).terminals.push({part: id, terminal: 'a'});
            nets.find(n => n.id === outputBias).terminals.push({part: id, terminal: 'b'});
        }
    }
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    board.setPin('oe', 'pushpull', false);
    for (const p of ['a','b','c','d','da']) board.setPin(p, 'input', false);
    return board;
}

const readCode = board => ['a','b','c','d'].reduce((n, p, bit) =>
    n | (board.readAnalog(p) > 2.5 ? 1 << bit : 0), 0);

test('physical X/Y nets encode all sixteen keypad switches and release lowers DA', () => {
    const board = rig();
    let t = 0n;
    for (let key = 0; key < 16; key++) {
        board.setPartParam('K', 'pressed', key);
        t += 1_000_000n;
        board.advanceTo(t);
        assert.equal(readCode(board), key, `row-major key ${key} encoded on DCBA`);
        assert.ok(board.readAnalog('da') > 2.5, `key ${key} raises DA`);
        board.setPartParam('K', 'pressed', -1);
        t += 1_000_000n;
        board.advanceTo(t);
        assert.ok(board.readAnalog('da') < 0.5, `release ${key} lowers DA`);
    }
});

test('logical core retains two-key rollover ordering', () => {
    const events = [];
    const enc = new M74C922({onChange: (code, da) => events.push([code, da])});
    enc.press(11); enc.press(5); enc.release(11);
    assert.deepEqual(events, [[11, 1], [0, 0], [5, 1]]);
    assert.equal(enc.registered, 5);
});

test('/OE makes A-D electrically high-Z while DA remains driven', () => {
    for (const [biasNet, expectedHigh] of [['vcc', true], ['gnd', false]]) {
        const board = rig({outputBias: biasNet});
        board.setPartParam('K', 'pressed', 15); // all four outputs actively high
        board.advanceTo(1_000_000n);
        assert.ok(board.readAnalog('da') > 2.5);
        board.setPin('oe', 'pushpull', true);
        board.advanceTo(1_200_000n);
        for (const bit of ['a','b','c','d']) {
            assert.equal(board.readAnalog(bit) > 2.5, expectedHigh,
                `disabled ${bit.toUpperCase()} follows the external ${biasNet} bias`);
        }
        assert.ok(board.readAnalog('da') > 2.5, 'DA is not gated by /OE');
    }
});

test('a broken physical row or column isolates only its keys', () => {
    for (const [broken, isolated, control] of [['r2', 9, 1], ['c3', 7, 6]]) {
        const board = rig({broken});
        board.setPartParam('K', 'pressed', isolated);
        board.advanceTo(1_000_000n);
        assert.ok(board.readAnalog('da') < 0.5,
            `${broken} break isolates the switch (registered ${board.getDeviceState('E').encoder.registered})`);
        board.setPartParam('K', 'pressed', -1);
        board.advanceTo(2_000_000n);
        board.setPartParam('K', 'pressed', control);
        board.advanceTo(3_000_000n);
        assert.equal(readCode(board), control, `${broken} fixture still scans a neighboring key`);
        assert.ok(board.readAnalog('da') > 2.5, `${broken} fixture is live, not globally disconnected`);
    }
});

test('scheduled scan result is invariant to advanceTo chunk size', () => {
    const run = chunks => {
        const board = rig();
        board.setPartParam('K', 'pressed', 14);
        let t = 0n;
        for (const chunk of chunks) { t += chunk; board.advanceTo(t); }
        return [readCode(board), board.readAnalog('da') > 2.5,
            board.getDeviceState('E').encoder.registered];
    };
    assert.deepEqual(run([2_000_000n]), run(Array(20).fill(100_000n)));
    assert.deepEqual(run([300_000n, 500_000n, 1_200_000n]), [14, true, 14]);
});
