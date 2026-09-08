import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8254} from '../src/i8254.js';

test('nextWake names the first output edge in ticks, including BCD and low-gate one-shots', () => {
    for (let mode = 0; mode <= 5; mode++) for (const bcd of [0, 1])
    for (const count of [2, 3, 0x20]) for (const gate of [0, 1]) {
        let edges = 0;
        const pit = new I8254({onOutput: () => edges++});
        pit.write(3, 0x30 | mode << 1 | bcd);
        pit.write(0, count); pit.write(0, 0);
        pit.counters[0].setGate(0); pit.counters[0].setGate(1);
        pit.counters[0].setGate(gate);
        for (const elapsed of [0, 1, 2]) {
            pit.advance(elapsed);
            const state = structuredClone(pit.getState());
            const predicted = pit.nextWake();
            edges = 0;
            let observed = Infinity;
            for (let tick = 1; tick <= 64; tick++) {
                pit.advance(1);
                if (edges) { observed = tick; break; }
            }
            assert.equal(predicted, observed, `mode=${mode} bcd=${bcd} count=${count} gate=${gate}`);
            pit.setState(state);
        }
    }
});

test('coalescing counter calls is not automatically callback-observation equivalent', () => {
    const traces = [false, true].map(batched => {
        const seen = [];
        const pit = new I8254({onOutput: () => seen.push(pit.counters[1].ce)});
        for (const channel of [0, 1]) {
            pit.write(3, channel << 6 | 0x30);
            pit.write(channel, channel ? 20 : 3); pit.write(channel, 0);
        }
        seen.length = 0;
        if (batched) pit.advance(3);
        else for (let i = 0; i < 3; i++) pit.advance(1);
        return seen;
    });
    assert.notDeepEqual(traces[0], traces[1], 'a scheduler must flush pre-edge debt before processing the edge');
});
