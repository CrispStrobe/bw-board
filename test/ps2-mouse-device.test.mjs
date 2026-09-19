// The board-side PS/2 mouse part: a drawn `ps2mouse` holds a PS2Mouse, exposes
// it via getDeviceState (state._mouse, which the adapter's bridgePS2 auto-wires),
// and takes pointer intent through the device-control channel. The machine-side
// bridging is covered by test/i80286-ps2-autowire.test.mjs; this proves the
// drawn part exists and behaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';
import { PS2Mouse } from '../src/ps2.js';

registerAllDevices();

const TERMS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'da'];

test('the ps2mouse device is registered with the PS/2 data + DA terminals', () => {
    const model = getDevice('ps2mouse');
    assert.ok(model, 'ps2mouse is registered');
    assert.deepEqual(model.terminals, TERMS, 'd0-d7 + da, for the designer wiring display');
});

function boardWithMouse() {
    const parts = [{ id: 'ms', kind: 'ps2mouse', params: {}, terminals: [...TERMS] }];
    const nets = TERMS.map((t, i) => ({ id: `n${i}`, terminals: [{ part: 'ms', terminal: t }] }));
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    return b;
}

test('a drawn ps2mouse part exposes a PS2Mouse via getDeviceState', () => {
    const state = boardWithMouse().getDeviceState('ms');
    assert.ok(state && state._mouse instanceof PS2Mouse, 'the part holds a PS2Mouse the adapter can bridge');
    assert.equal(typeof state.move, 'function');
    assert.equal(typeof state.click, 'function');
});

test('the device-control channel drives movement and buttons into packets', () => {
    const b = boardWithMouse();
    const state = b.getDeviceState('ms');

    assert.equal(b.setDeviceControl('ms', 'move', { dx: 5, dy: -3 }), true, 'move accepted');
    assert.equal(b.setDeviceControl('ms', 'press', 'left'), true, 'press accepted');
    assert.equal(b.setDeviceControl('ms', 'bogus', 0), false, 'an unknown verb is refused, not a silent no-op');

    // Two 3-byte packets queued for the machine-side capture: the move, then the press.
    assert.ok(state._mouse.fifo.length >= 6, `two packets queued (got ${state._mouse.fifo.length} bytes)`);
    const [b1, x, y] = state._mouse.fifo;                 // decode the move packet
    assert.equal(x, 5, 'X delta');
    assert.equal((b1 & 0x20) ? y - 256 : y, -3, 'Y delta sign-extends via YS');
    assert.equal(b1 & 0x01, 0, 'no button in the move packet');
    const b4 = state._mouse.fifo[3];                      // the press packet's byte 1
    assert.equal(b4 & 0x01, 1, 'the press packet carries the left button');
});

test('the face-side API and click convenience work directly too', () => {
    const state = boardWithMouse().getDeviceState('ms');
    state.click('right');                                 // press+release
    assert.equal(state._mouse.fifo.length, 6, 'a click is a press packet then a release packet');
    assert.equal(state._mouse.fifo[0] & 0x02, 0x02, 'right button down in the first packet');
    assert.equal(state._mouse.fifo[3] & 0x02, 0, 'and up in the second');
});
