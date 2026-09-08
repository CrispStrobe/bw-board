import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';

const fixture = hz => new I8086Machine({clockHz: hz,
    regions: [{kind: 'ram', start: 0, end: 0xfffff}],
    chips: [{kind: 'pit', name: 'pit', at: 0x40}]});

test('halt deadlines convert the PIT clock and fractional phase to CPU cycles', () => {
    for (const hz of [1_000_000, 5_000_000, 8_000_000]) {
        const m = fixture(hz), pit = m.chips.pit;
        pit.write(3, 0x30); pit.write(0, 100); pit.write(0, 0);
        pit._frac = 0.75;
        const expected = Math.max(1, Math.floor((100 - 0.75) * hz / pit.clockHz));
        assert.equal(m._wakeHorizon(), expected);
        m.cpu.halted = true;
        m.step();
        assert.ok(pit.counters[0].ce <= 1, 'advance reaches the cycle before the edge');
        assert.equal(pit.counters[0].out, 0, 'no early edge');
        for (let i = 0; i < 10 && !pit.counters[0].out; i++) m.step();
        assert.equal(pit.counters[0].out, 1);
    }
});

test('deadline-free devices veto skipping and attachment invalidates the cached schedule', () => {
    const m = fixture(5e6);
    assert.equal(m._wakeHorizon(), 5000);
    m.attachDevice('unknown', {advance() {}});
    assert.equal(m._wakeHorizon(), 1);
});

test('a millisecond device cannot silently supply device ticks as CPU cycles', () => {
    const m = fixture(5e6);
    m.chips.pit.nextWakeMs = undefined;
    assert.equal(m._wakeHorizon(), 1);
});
