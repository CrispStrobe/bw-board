import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';

// A minimal build: value-returning stubs plus a controllable nanosecond clock.
// `cycleStep` decides whether the build reports a real oscillator step; every
// other key is passed straight through as an opts value (including clockHz).
const makeTarget = ({cycleStep = false, ...opts} = {}) => {
    let ns = 0n;
    const wasm = Object.fromEntries([
        '_emu_dbg_state', '_emu_dbg_run', '_emu_dbg_halt', '_emu_dbg_step',
        '_emu_dbg_reset', '_emu_dbg_run_until_ns', '_emu_dbg_read_mem',
        '_emu_dbg_write_mem', '_emu_dbg_pc'
    ].map(name => [name, () => 0]));
    wasm._emu_get_time_ns_hi = () => Number((ns >> 32n) & 0xFFFFFFFFn);
    wasm._emu_get_time_ns_lo = () => Number(ns & 0xFFFFFFFFn);
    // STEP_KIND.cycle is 5; a build "supports" the cycle step iff it answers 1.
    if (cycleStep) wasm._emu_dbg_supports_step = k => (k === 5 ? 1 : 0);
    return {target: createEmu8051DebugTarget(wasm, opts), setNs: v => { ns = BigInt(v); }};
};

test('time() converts nanoseconds to oscillator cycles through the one ns-per-second authority', () => {
    const {target, setNs} = makeTarget({clockHz: 12_000_000});

    setNs(1_000_000_000n);   // one second
    const t = target.time();
    assert.equal(t.ticks, 12_000_000n,
        'a 12 MHz part run for one second is 12,000,000 cycles — a wrong ns/s scale would ' +
        'misreport the cycle count a caller correlates against a trace');
    assert.equal(t.hz, 12_000_000);
    assert.equal(t.domain, '8051-oscillator');

    setNs(1_500_000_000n);
    assert.equal(target.time().ticks, 18_000_000n, 'and the count scales linearly with elapsed time');

    setNs(42n);   // 0.504 cycles at 12 MHz
    assert.equal(target.time().ticks, 1n,
        'half-up rounding: a sub-cycle interval reports as 1, not truncated to 0, so short ' +
        'intervals are not silently lost');
});

for (const [label, opts] of [
    ['unset', {}],
    ['zero', {clockHz: 0}],
    ['negative', {clockHz: -1}],
    ['NaN', {clockHz: Number.NaN}],
    ['fractional', {clockHz: 1.5}]
]) {
    test(`time() falls back to native nanoseconds when the clock is ${label}`, () => {
        const {target, setNs} = makeTarget(opts);
        setNs(4_200n);
        const t = target.time();
        assert.equal(t.ticks, 4_200n,
            'a caller with no usable clock still gets the raw nanosecond count, not a fabricated cycle number');
        assert.equal(t.domain, '8051-simulation-ns');
        assert.equal(t.hz, 1_000_000_000, 'the ns domain reports one tick per nanosecond');
    });
}

test('time() domain changes across a reset so two runs never read as one monotonic series', () => {
    const {target, setNs} = makeTarget({clockHz: 12_000_000});
    setNs(1_000_000_000n);
    const before = target.time();
    assert.equal(before.domain, '8051-oscillator');

    target.reset();
    setNs(10n);   // the new run's clock starts over
    const after = target.time();
    assert.notEqual(after.domain, before.domain,
        'a caller diffing timestamps must see different domains across a reset, or it computes a ' +
        'duration spanning the reset as if the run were continuous');
    assert.equal(after.domain, '8051-oscillator-reset-1');

    target.reset();
    assert.equal(target.time().domain, '8051-oscillator-reset-2', 'each reset advances the epoch');
});

test('the reset epoch is carried in the ns domain too', () => {
    const {target} = makeTarget();
    target.reset();
    assert.equal(target.time().domain, '8051-simulation-ns-reset-1');
});

test('a build without a cycle step offers no oscillator boundary', () => {
    const {target} = makeTarget({clockHz: 12_000_000});   // no cycleStep
    assert.equal(target.cycleProvider(), null,
        'a caller must not be offered an oscillator boundary the build cannot actually stop on');
});

test('the cycle boundary is recorded and resumable but promises no bus and no checkpoint', () => {
    const {target, setNs} = makeTarget({clockHz: 12_000_000, cycleStep: true});
    setNs(1_000_000_000n);
    const cp = target.cycleProvider();

    assert.equal(cp.boundary, 'oscillator-clock');
    assert.equal(cp.fidelity, 'recorded');
    assert.equal(cp.resumable, true, 'the whole point of the provider: this boundary can be resumed from');
    assert.deepEqual(cp.signals, [],
        'an empty signal list is a promise — this ABI exposes no ALE/PSEN/address/data bus, and a ' +
        'client must not synthesize a waveform from a bare cycle step');
    assert.equal(cp.checkpoint, false,
        'architectural reads omit in-flight and peripheral state, so this boundary is not a ' +
        'deterministic continuation point');
    assert.equal(cp.clockHz, 12_000_000, 'the clock is echoed when one was supplied');
    assert.equal(cp.timeDomain, target.time().domain,
        'the provider must name the same domain debugTime reports, or a recorded cycle fact and the ' +
        'declared boundary disagree on which clock they are on');
});

test('the cycle boundary follows the live time domain across a reset and omits clockHz when unclocked', () => {
    const {target} = makeTarget({cycleStep: true});   // no clockHz
    let cp = target.cycleProvider();
    assert.equal(cp.timeDomain, '8051-simulation-ns');
    assert.equal('clockHz' in cp, false, 'no clock was supplied, so the provider must not invent one');

    target.reset();
    cp = target.cycleProvider();
    assert.equal(cp.timeDomain, '8051-simulation-ns-reset-1',
        'the provider reads the live reset epoch from debugTime, not a stale inline copy of the domain rule');
    assert.equal(cp.timeDomain, target.time().domain);
});
