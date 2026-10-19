import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8254} from '../src/i8254.js';

// Reference the unchanged per-tick transition, independently of the optimized
// batch decision. This checks preservation of the current chip model, not a
// new claim of hardware timing accuracy.
function pair() {
    const traces = [[], []];
    const chips = traces.map((trace, index) => {
        const chip = new I8254({onOutput: (channel, level) => {
            trace.push({channel, level, state: chip.getState()});
        }});
        if (index) for (const counter of chip.counters) {
            counter.advance = function(ticks) {
                if (this.nullCount || (!this.gate && this.mode !== 1 && this.mode !== 5)) return;
                for (let t = 0; t < ticks; t++) this._tick();
            };
        }
        return chip;
    });
    return {
        chips,
        both(fn) { chips.forEach(fn); },
        check() {
            assert.deepEqual(chips[0].getState(), chips[1].getState());
            assert.equal(chips[0]._frac, chips[1]._frac);
            assert.deepEqual(traces[0], traces[1]);
            traces.forEach(trace => { trace.length = 0; });
        },
    };
}

test('batched PIT countdown matches individual ticks across modes, bases, counts and boundaries', () => {
    for (let mode = 0; mode < 8; mode++) for (const bcd of [0, 1]) {
        for (const count of [0, 1, 2, 3, 4, 17, 100, 0x9999]) {
            const p = pair();
            p.both(chip => {
                chip.write(3, 0x30 | mode << 1 | bcd);
                chip.write(0, count & 0xff);
                chip.write(0, count >> 8);
                chip.counters[0].setGate(0);
                chip.counters[0].setGate(1);
            });
            p.check();
            for (const ticks of [0, 1, 2, 3, 7, 31, 0.5, 1.5, -1, NaN, 100]) {
                p.both(chip => chip.advance(ticks));
                p.check();
                p.both(chip => chip.write(3, 0));
                for (let byte = 0; byte < 2; byte++) assert.equal(p.chips[0].read(0), p.chips[1].read(0));
                p.check();
            }
        }
    }
});

test('fractional clock, gates, reloads, latches and restores remain equivalent under interleaved operations', () => {
    const p = pair();
    let seed = 0x80868254;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < 1500; i++) {
        const action = random() % 6, channel = random() % 3, value = random() & 0xffff;
        if (action === 0) p.both(chip => chip.advanceMs((value % 53) / 1000));
        if (action === 1) p.both(chip => chip.counters[channel].setGate(value & 1));
        if (action === 2) p.both(chip => {
            chip.write(3, channel << 6 | 0x30 | (value % 6) << 1);
            chip.write(channel, value & 0xff);
            chip.write(channel, value >> 8);
        });
        if (action === 3) {
            p.both(chip => chip.write(3, channel << 6));
            assert.equal(p.chips[0].read(channel), p.chips[1].read(channel));
        }
        if (action === 4) p.both(chip => chip.setState(structuredClone(chip.getState())));
        if (action === 5) p.both(chip => chip.advance(value % 37));
        p.check();
    }
});

test('an output callback can reload the counter during an edge-crossing call', () => {
    const p = pair();
    p.both(chip => {
        const hooks = chip.counters[0].hooks;
        const original = hooks.onOutput;
        let edges = 0;
        hooks.onOutput = (channel, level) => {
            original(channel, level);
            if (++edges === 2) { chip.write(0, 20); chip.write(0, 0); }
        };
        chip.write(3, 0x36);
        chip.write(0, 4); chip.write(0, 0);
        chip.advance(32);
    });
    p.check();
});
