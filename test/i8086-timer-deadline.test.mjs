import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';
import {createDos8086, DOSBOX8086} from '../src/i8086-dos.js';

const interval = 1000 / 18.2065;
function setup(io = {}) {
    const machine = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(machine, io).install();
    machine.cpu.flags |= 0x200;
    const at = ms => { machine.cycles = Math.ceil(ms * machine.clockHz / 1000); };
    const hook = vector => { machine._write(vector * 4 + 2, 0x00); machine._write(vector * 4 + 3, 0x08); };
    return {machine, dos, at, hook};
}

for (const vector of [8, 0x1c]) {
    test(`a late INT ${vector.toString(16)} hook receives the overdue first tick immediately`, () => {
        const {dos, at, hook} = setup();
        at(interval * 3);
        assert.equal(dos._timerTickDue(), false);
        hook(vector);
        assert.equal(dos._timerTickDue(), true);
        assert.equal(dos._timerTickDue(), false);
        at(interval * 4 + 0.001);
        assert.equal(dos._timerTickDue(), true);
    });
}

test('timer deadline preserves masking, unhooking and memory restore', () => {
    const {machine, dos, at, hook} = setup();
    const vectors = machine.mem.slice(0, 0x80);
    hook(0x1c);
    at(interval - 0.01);
    assert.equal(dos._timerTickDue(), false);
    at(interval + 0.001);
    machine.cpu.flags &= ~0x200;
    assert.equal(dos._timerTickDue(), false);
    machine.cpu.flags |= 0x200;
    assert.equal(dos._timerTickDue(), true);
    machine.mem.set(vectors);
    at(interval * 3);
    assert.equal(dos._timerTickDue(), false);
    hook(8);
    assert.equal(dos._timerTickDue(), true);
});

test('explicit and hardware timer ownership suppress synthetic ticks', () => {
    const {machine, dos, at, hook} = setup();
    hook(8);
    at(interval * 2);
    machine.hasHardwareTimerIrq = () => true;
    assert.equal(dos._timerTickDue(), false);
    machine.hasHardwareTimerIrq = () => false;
    assert.equal(dos._timerTickDue(), true);
    const disabled = setup({syntheticTick: false});
    disabled.hook(8);
    disabled.at(interval * 2);
    assert.equal(disabled.dos._timerTickDue(), false);
});
