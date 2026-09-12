import test from 'node:test';
import assert from 'node:assert/strict';
import {Z80Machine} from '../src/z80-machine.js';

const build = () => {
    const machine = new Z80Machine({clockHz: 3500000,
        regions: [{kind: 'rom', start: 0, end: 0xff}], ula: true}, {});
    // IN A,($FE); LD ($4000),A; JP 0: sample keyboard and tape through the CPU.
    machine.load(Uint8Array.from([0xdb, 0xfe, 0x32, 0x00, 0x40, 0xc3, 0, 0]), 0);
    machine.cpu.pc = 0;
    return machine;
};
const seed = m => {
    m.ula.setKeys(['a', 'space']);
    m.ula.setEarEdges([{tStates: 0, level: 0}, {tStates: 10000, level: 1}, {tStates: 20000, level: 0}]);
    m.ula.out(0xfe, 0x10, 0);
    m.ula.out(0xfe, 0, 80);
    m.advanceToMs(1);
    m.ula.in(0xfdfe); // consume the EAR prefix at the checkpoint boundary
};

test('whole-machine restore preserves held keys, consumed EAR prefix and audio history', () => {
    const original = build(); seed(original);
    const snapshot = original.saveState();
    const restored = build(); restored.loadState(snapshot);
    assert.deepEqual(restored.ula.rows, original.ula.rows, 'held keys survive restore');
    assert.equal(restored.ula.in(0xfdfe), original.ula.in(0xfdfe), 'keyboard and EAR level agree');
    assert.equal(restored.ula._earIdx, 1, 'consumed EAR prefix stays consumed');
    assert.deepEqual(restored.ula.speakerEdges, [[0, 1], [80, 0]], 'pending audio survives');
    for (const ms of [2, 3, 6, 7]) {
        original.advanceToMs(ms); restored.advanceToMs(ms);
        assert.deepEqual(restored.saveState(), original.saveState(), `execution agrees at ${ms}ms`);
    }
});

test('saved and restored ULA queues own their nested state', () => {
    const original = build(); seed(original);
    const snapshot = original.saveState();
    const restored = build(); restored.loadState(snapshot);
    const before = structuredClone(restored.ula.saveState());
    original.ula.rows.fill(0); original.ula.speakerEdges[0][1] = 99;
    original.ula._earEdges[0].level = 99;
    assert.deepEqual(restored.ula.saveState(), before, 'original mutation cannot alter restored state');
    // The snapshot must be isolated from the original as well as the restore.
    const chip = Object.values(snapshot.chips).find(s => Object.hasOwn(s, 'earEdges'));
    assert.deepEqual(chip, before, 'saving deep-copies producer queues');
    chip.rows.fill(0); chip.speakerEdges[0][1] = 88; chip.earEdges[0].level = 88;
    assert.deepEqual(restored.ula.saveState(), before, 'restore deep-copies the saved queues');
});

test('legacy machine-v1 ULA snapshots remain readable; partial modern state is refused', () => {
    const original = build(); seed(original);
    const snapshot = original.saveState();
    const chip = Object.values(snapshot.chips).find(s => Object.hasOwn(s, 'earEdges'));
    const fields = ['rows', 'speakerEdges', 'earEdges', 'earIdx', 'earLevel'];
    for (const field of fields) {
        const partial = {...chip}; delete partial[field];
        assert.throws(() => build().ula.loadState(partial), /incomplete ZX ULA checkpoint/);
    }
    for (const field of fields) delete chip[field];
    const restored = build(); restored.loadState(snapshot);
    assert.deepEqual([...restored.ula.rows], Array(8).fill(0x1f));
    assert.deepEqual(restored.ula.speakerEdges, []);
    assert.equal(restored.ula.in(0xfdfe) & 0x40, 0x40);
    assert.equal(restored.ula.tStates, original.ula.tStates);
});
