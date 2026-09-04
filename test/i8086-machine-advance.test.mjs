import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';
import {DOSBOX8086} from '../src/i8086-dos.js';

test('the cached advance schedule includes a device attached after first use', () => {
    const machine = new I8086Machine(DOSBOX8086);
    machine._advanceChips(4); // populate the initially empty schedule
    let cycles = 0;
    machine.attachDevice('late', {advance: (n) => { cycles += n; }});
    machine._advanceChips(7);
    assert.equal(cycles, 7, 'attachDevice must invalidate the cached schedule');
});

test('advanceMs chips receive emulated milliseconds, not CPU cycles', () => {
    const machine = new I8086Machine(DOSBOX8086);
    let ms = 0;
    machine.chips.clocked = {advanceMs: (n) => { ms += n; }};
    machine._advanceChips(machine.clockHz / 1000);
    assert.equal(ms, 1);
});
