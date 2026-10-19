// 433 MHz OOK goldens: the wireless wire, band isolation, and the OR of
// two carriers — plus a bit-banged byte crossing the air end to end.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerRf433 } from '../src/devices/rf433.js';
import { createUartRx } from '../src/devices/uart-peer.js';
import { resetAir } from '../src/air.js';

registerRf433();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };

function rig(bandTx, bandRx) {
    resetAir(`rf433:${bandTx}`); resetAir(`rf433:${bandRx}`);
    const board = new BoardImpl(5.0);
    board.setNetlist([V, G,
        { id: 'TX', kind: 'rf433_tx', params: { band: bandTx }, terminals: ['vcc', 'gnd', 'data'] },
        { id: 'RX', kind: 'rf433_rx', params: { band: bandRx }, terminals: ['vcc', 'gnd', 'data'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ], [
        net('nv', ['VCC', 'vcc'], ['TX', 'vcc'], ['RX', 'vcc']),
        net('ng', ['GND', 'gnd'], ['TX', 'gnd'], ['RX', 'gnd']),
        net('nt', ['MCU', 'P1.0'], ['TX', 'data']),
        net('nr', ['MCU', 'P1.1'], ['RX', 'data']),
    ]);
    board.setPin('P1.1', 'input', false);
    let t = 0n;
    const to = (nt) => { t = nt; board.advanceTo(t); };
    return { board, to, now: () => t };
}

describe('rf433', () => {
    it('the wireless wire: RX data follows TX data on the same band', () => {
        const r = rig('bandA', 'bandA');
        r.board.setPin('P1.0', 'pushpull', true); r.to(1n);
        assert.ok(r.board.readAnalog('P1.1') > 4.0, 'high crosses');
        r.board.setPin('P1.0', 'pushpull', false); r.to(2n);
        assert.ok(r.board.readAnalog('P1.1') < 0.5, 'low crosses');
    });

    it('different bands never meet', () => {
        const r = rig('band315', 'band433x');
        r.board.setPin('P1.0', 'pushpull', true); r.to(1n);
        assert.ok(r.board.readAnalog('P1.1') < 0.5, 'nothing crosses bands');
    });

    it('a bit-banged UART byte crosses the air intact', () => {
        const r = rig('bandU', 'bandU');
        const bit = 104_167n;                       // 9600 baud
        const rx = createUartRx(9600);
        const out = [];
        const sample = () => { for (const b of rx.feed(r.board.readAnalog('P1.1') > 2.5 ? 1 : 0, r.now())) out.push(b); };
        r.board.setPin('P1.0', 'pushpull', true); r.to(r.now() + 3n * bit); sample();
        const byte = 0xa5;
        r.board.setPin('P1.0', 'pushpull', false);
        for (let q = 0; q < 4; q++) { r.to(r.now() + bit / 4n); sample(); }
        for (let i = 0; i < 8; i++) {
            r.board.setPin('P1.0', 'pushpull', !!((byte >> i) & 1));
            for (let q = 0; q < 4; q++) { r.to(r.now() + bit / 4n); sample(); }
        }
        r.board.setPin('P1.0', 'pushpull', true);
        for (let q = 0; q < 12; q++) { r.to(r.now() + bit / 4n); sample(); }
        assert.deepEqual(out, [0xa5], 'the byte survived the trip');
    });

    it('two transmitters jam: the receiver hears the OR', () => {
        resetAir('rf433:jam');
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'T1', kind: 'rf433_tx', params: { band: 'jam' }, terminals: ['vcc', 'gnd', 'data'] },
            { id: 'T2', kind: 'rf433_tx', params: { band: 'jam' }, terminals: ['vcc', 'gnd', 'data'] },
            { id: 'RX', kind: 'rf433_rx', params: { band: 'jam' }, terminals: ['vcc', 'gnd', 'data'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['T1', 'vcc'], ['T2', 'vcc'], ['RX', 'vcc']),
            net('ng', ['GND', 'gnd'], ['T1', 'gnd'], ['T2', 'gnd'], ['RX', 'gnd']),
            net('n1', ['MCU', 'P1.0'], ['T1', 'data']),
            net('n2', ['MCU', 'P1.1'], ['T2', 'data']),
            net('n3', ['MCU', 'P1.2'], ['RX', 'data']),
        ]);
        board.setPin('P1.2', 'input', false);
        board.setPin('P1.0', 'pushpull', true);
        board.setPin('P1.1', 'pushpull', false);
        board.advanceTo(1n);
        assert.ok(board.readAnalog('P1.2') > 4.0, 'one carrier keyed → high');
        board.setPin('P1.0', 'pushpull', false);
        board.advanceTo(2n);
        assert.ok(board.readAnalog('P1.2') < 0.5, 'both silent → low');
        board.setPin('P1.1', 'pushpull', true);
        board.advanceTo(3n);
        assert.ok(board.readAnalog('P1.2') > 4.0, 'the other carrier keys → high (the OR)');
    });
});
