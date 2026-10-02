import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GIB, memoryAvailable, decideResources} from '../scripts/lib/local-resource-preflight.mjs';
const healthy = () => ({cpus: 4, load: [1, 1, 1], memoryAvailableBytes: 6 * GIB,
    disks: [{path: '/work', availableBytes: 30 * GIB}, {path: '/tmp', availableBytes: 30 * GIB}]});

test('uses MemAvailable rather than free or total memory', () => {
    assert.equal(memoryAvailable('MemTotal: 8000 kB\nMemFree: 20 kB\nMemAvailable: 4000 kB\n'), 4000 * 1024);
    for (const value of ['MemFree: 8000 kB', 'MemAvailable: -1 kB', 'MemAvailable: 3 GB']) {
        assert.throws(() => memoryAvailable(value));
    }
});
test('admits exact limits but refuses any overloaded averaging window', () => {
    const sample = healthy();
    sample.load = [3, 3, 4];
    assert.equal(decideResources(sample, 'build').allowed, true);
    for (const index of [0, 1, 2]) {
        const loaded = structuredClone(sample);
        loaded.load[index] += 0.01;
        assert.equal(decideResources(loaded, 'benchmark').allowed, false);
    }
});
test('checks available memory and every output/temp filesystem', () => {
    for (const kind of ['build', 'benchmark']) {
        assert.equal(decideResources(healthy(), kind).allowed, true);
        const memory = healthy();
        memory.memoryAvailableBytes = GIB;
        assert.equal(decideResources(memory, kind).allowed, false);
        const disk = healthy();
        disk.disks[1].availableBytes = GIB;
        assert.equal(decideResources(disk, kind).allowed, false);
    }
    const sample = healthy();
    sample.disks[0].availableBytes = 6 * GIB;
    assert.equal(decideResources(sample, 'benchmark').allowed, true);
    assert.equal(decideResources(sample, 'build').allowed, false);
});
test('invalid or incomplete samples fail closed', () => {
    for (const change of [{cpus: 0}, {load: [0, NaN, 0]}, {load: [0, 0]},
        {memoryAvailableBytes: Infinity}, {disks: []}, {disks: [{path: '/tmp', availableBytes: -1}]}]) {
        assert.equal(decideResources({...healthy(), ...change}, 'build').allowed, false);
    }
    for (const kind of ['other', '__proto__', 'constructor']) assert.throws(() => decideResources(healthy(), kind));
});
