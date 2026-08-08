/**
 * Detailed onChange tests: event details, ordering, multiple listeners,
 * listener errors don't break the board.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('onChange: event detail content', () => {
  it('pin event carries pin, mode, driveHigh', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));

    board.setPin('P1.0', 'quasi', false);
    const pinEvt = events.find(e => e.type === 'pin');
    assert.ok(pinEvt);
    assert.equal(pinEvt.detail.pin, 'P1.0');
    assert.equal(pinEvt.detail.mode, 'quasi');
    assert.equal(pinEvt.detail.driveHigh, false);
  });

  it('time event carries tNs as bigint', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));

    board.advanceTo(42_000n);
    const timeEvt = events.find(e => e.type === 'time');
    assert.ok(timeEvt);
    assert.equal(timeEvt.detail.tNs, 42_000n);
  });

  it('control event carries partId and value', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));

    board.setControl('POT1', 0.75);
    const ctrlEvt = events.find(e => e.type === 'control');
    assert.ok(ctrlEvt);
    assert.equal(ctrlEvt.detail.partId, 'POT1');
    assert.equal(ctrlEvt.detail.value, 0.75);
  });

  it('power event carries on boolean', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));

    board.setPower(false);
    const powEvt = events.find(e => e.type === 'power');
    assert.ok(powEvt);
    assert.equal(powEvt.detail.on, false);
  });
});

describe('onChange: multiple listeners', () => {
  it('all listeners receive events', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const a = [], b = [], c = [];
    board.onChange(e => a.push(e.type));
    board.onChange(e => b.push(e.type));
    board.onChange(e => c.push(e.type));

    board.setPin('P1.0', 'quasi', false);
    assert.ok(a.includes('pin'));
    assert.ok(b.includes('pin'));
    assert.ok(c.includes('pin'));
  });

  it('removing one does not affect others', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const a = [], b = [];
    const fnA = e => a.push(e.type);
    const fnB = e => b.push(e.type);
    board.onChange(fnA);
    board.onChange(fnB);

    board.setPin('P1.0', 'quasi', false);
    assert.ok(a.length > 0 && b.length > 0);

    board.offChange(fnA);
    const aLen = a.length;
    board.setPin('P1.0', 'quasi', true);
    assert.equal(a.length, aLen, 'A stopped');
    assert.ok(b.length > aLen, 'B still receives');
  });
});

describe('onChange: event ordering', () => {
  it('events fire in registration order', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const order = [];
    board.onChange(() => order.push('first'));
    board.onChange(() => order.push('second'));
    board.onChange(() => order.push('third'));

    board.setPin('P1.0', 'quasi', false);
    assert.deepEqual(order, ['first', 'second', 'third']);
  });

  it('rapid pin changes fire in sequence', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const pins = [];
    board.onChange(e => { if (e.type === 'pin') pins.push(e.detail.driveHigh); });

    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.0', 'pushpull', false);
    assert.deepEqual(pins, [false, true, false]);
  });
});

describe('onChange: listener error isolation', () => {
  it('throwing listener does not break the board or other listeners', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const good = [];
    board.onChange(() => { throw new Error('boom'); });
    board.onChange(e => good.push(e.type));

    // Should not throw — error is caught internally
    board.setPin('P1.0', 'quasi', false);

    // Board state should be updated
    assert.deepEqual(board.getPinState('P1.0'), { mode: 'quasi', driveHigh: false });

    // Second listener should have fired despite the first throwing
    assert.ok(good.includes('pin'),
      'second listener should fire even when first throws');
  });
});

describe('onChange: high-frequency events', () => {
  it('1000 pin changes fire 1000 events', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    let count = 0;
    board.onChange(e => { if (e.type === 'pin') count++; });

    for (let i = 0; i < 1000; i++) {
      board.setPin('P1.0', 'pushpull', i % 2 === 0);
    }
    assert.equal(count, 1000);
  });
});
