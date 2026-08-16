/**
 * UM245R USB-parallel-FIFO tests — the behavioural contract from
 * Z80-BENCH-PAINFULDIODES §8: read/write strobes, FIFO status flags,
 * and the empty-FIFO-repeats-last-byte trap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

function makePart(params = {}) {
    return { id: 'u8', kind: 'um245r', params };
}

function makeRead(voltages) {
    return (pin) => voltages[pin] ?? 0;
}

test('device registers and has correct terminals', () => {
    const dev = getDevice('um245r');
    assert.ok(dev, 'um245r device registered');
    assert.ok(dev.terminals.includes('d0'));
    assert.ok(dev.terminals.includes('d7'));
    assert.ok(dev.terminals.includes('rdb'));
    assert.ok(dev.terminals.includes('wr'));
    assert.ok(dev.terminals.includes('txeb'));
    assert.ok(dev.terminals.includes('rxfb'));
});

test('/RXF is HIGH when FIFO is empty, LOW when data waiting', () => {
    const dev = getDevice('um245r');
    const part = makePart();
    const state = dev.init(part);
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    assert.equal(state.drives.rxfb.vTh, 5, '/RXF HIGH when empty');

    part.params = { rxData: { seq: 1, bytes: [0x42] } };
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    assert.equal(state.drives.rxfb.vTh, 0, '/RXF LOW when byte waiting');
});

test('read strobe drives D0-D7 from FIFO, pops on rising edge', () => {
    const dev = getDevice('um245r');
    const part = makePart({ rxData: { seq: 1, bytes: [0xA5, 0x3C] } });
    const state = dev.init(part);
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    assert.equal(state.rxFifo.length, 2);

    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 0, wr: 0, resetb: 5 }));
    assert.equal(state.drives.d0.vTh, 5, 'bit 0 of 0xA5');
    assert.equal(state.drives.d1.vTh, 0, 'bit 1 of 0xA5');

    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    assert.equal(state.rxFifo.length, 1, 'one byte popped');
    assert.equal(state.lastByte, 0xA5);
});

test('THE TRAP: empty FIFO repeats the last byte, not zero', () => {
    const dev = getDevice('um245r');
    const part = makePart({ rxData: { seq: 1, bytes: [0x42] } });
    const state = dev.init(part);
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 0, wr: 0, resetb: 5 }));
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5 }));
    assert.equal(state.rxFifo.length, 0);

    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 0, wr: 0, resetb: 5 }));
    assert.equal(state.drives.d1.vTh, 5, 'bit 1 of last byte 0x42');
    assert.equal(state.drives.d6.vTh, 5, 'bit 6 of last byte 0x42');
    assert.equal(state.drives.d0.vTh, 0, 'bit 0 = 0');
});

test('write strobe latches on WR falling edge', () => {
    const dev = getDevice('um245r');
    const part = makePart();
    const state = dev.init(part);
    const wv = { vcc: 5, gnd: 0, rdb: 5, wr: 5, resetb: 5,
        d0: 5, d1: 0, d2: 5, d3: 0, d4: 5, d5: 0, d6: 5, d7: 0 };
    dev.update(part, state, makeRead(wv));
    wv.wr = 0;
    dev.update(part, state, makeRead(wv));
    assert.equal(state.txFifo[0], 0x55);
});

test('/RESET clears both FIFOs', () => {
    const dev = getDevice('um245r');
    const part = makePart({ rxData: { seq: 1, bytes: [0x01] } });
    const state = dev.init(part);
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 5, resetb: 5, d0: 5, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0 }));
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 5, d0: 5, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0 }));
    assert.ok(state.rxFifo.length > 0);
    assert.ok(state.txFifo.length > 0);
    dev.update(part, state, makeRead({ vcc: 5, gnd: 0, rdb: 5, wr: 0, resetb: 0 }));
    assert.equal(state.rxFifo.length, 0);
    assert.equal(state.txFifo.length, 0);
});
