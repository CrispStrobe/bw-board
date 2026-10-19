import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWindowCpuProfile} from '../scripts/lib/window-cpu-profiler.mjs';

function fake ({startError, stopError, profile = {samples: [1], timeDeltas: [-2]}} = {}) {
    const events = [];
    return {events, profile, post (method, params, callback) {
        events.push(method);
        callback(method === 'Profiler.start' ? startError : stopError,
            method === 'Profiler.stop' ? {profile} : {});
    }};
}
test('window lifecycle starts before synchronous work, stops before capture and observations', async () => {
    const session = fake();
    const result = await withWindowCpuProfile(session, () => {
        session.events.push('cycles'); return 42;
    }, profile => { session.events.push('capture'); assert.equal(profile, session.profile); });
    session.events.push('observe');
    assert.equal(result, 42);
    assert.deepEqual(session.events, ['Profiler.start', 'cycles', 'Profiler.stop', 'capture', 'observe']);
    assert.equal(session.profile.timeDeltas[0], -2, 'raw values are not clamped or rewritten');
});
test('failed cycle execution still stops and preserves raw profile', async () => {
    const session = fake(), failure = Error('cycles failed');
    await assert.rejects(withWindowCpuProfile(session, () => { throw failure; }, () => session.events.push('capture')), e => e === failure);
    assert.deepEqual(session.events, ['Profiler.start', 'Profiler.stop', 'capture']);
});
test('failed start does not run body or fabricate stop/profile', async () => {
    const session = fake({startError: Error('start failed')});
    await assert.rejects(withWindowCpuProfile(session, () => assert.fail(), () => assert.fail()), /start failed/);
    assert.deepEqual(session.events, ['Profiler.start']);
});
test('failed stop or missing raw profile is not a successful capture', async () => {
    for (const options of [{stopError: Error('stop failed')}, {profile: null}]) {
        const session = fake(options);
        await assert.rejects(withWindowCpuProfile(session, () => 1, () => assert.fail()), /stop failed|no profile/);
        assert.deepEqual(session.events, ['Profiler.start', 'Profiler.stop']);
    }
});
test('body and stop failure retain both errors', async () => {
    const bodyError = Error('body'), stopError = Error('stop');
    const session = fake({stopError});
    await assert.rejects(withWindowCpuProfile(session, () => { throw bodyError; }, () => assert.fail()), error => {
        assert(error instanceof AggregateError); assert.deepEqual(error.errors, [bodyError, stopError]); return true;
    });
});
test('async bodies are rejected, after stopping and preserving available raw data', async () => {
    const session = fake();
    await assert.rejects(withWindowCpuProfile(session, () => Promise.resolve(1), () => session.events.push('capture')), /must be synchronous/);
    assert.deepEqual(session.events, ['Profiler.start', 'Profiler.stop', 'capture']);
});
test('capture failures are not relabelled as successful sampled windows', async () => {
    const session = fake();
    await assert.rejects(withWindowCpuProfile(session, () => 1, () => { throw Error('disk'); }), /disk/);
});
