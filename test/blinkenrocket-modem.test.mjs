import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { textPattern, frameMessage, encodeAudio, hamming2416, syncSignal } from '../src/blinkenrocket-modem.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/**
 * The encoder is validated the way the rocket validates it: a
 * demodulator built on the firmware's own principle — classify
 * 8-sample windows by activity, run-length them, long burst-or-gap
 * = 1, short = 0, LSB first — recovers the exact framed bytes.
 */
const demodulate = (samples) => {
    const win = 8;
    const active = [];
    for (let i = 0; i + win <= samples.length; i += win) {
        let e = 0;
        for (let k = 0; k < win; k++) e += Math.abs(samples[i + k]);
        active.push(e > 1.0 ? 1 : 0);
    }
    // run-length → symbols → bits
    const bits = [];
    let run = 1;
    for (let i = 1; i <= active.length; i++) {
        if (i < active.length && active[i] === active[i - 1]) { run++; continue; }
        bits.push(run > 13 ? 1 : 0);   // 72/8=9 windows vs 144/8=18
        run = 1;
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        let b = 0;
        for (let k = 0; k < 8; k++) b |= bits[i + k] << k; // LSB first
        bytes.push(b);
    }
    return bytes;
};

describe('blinkenrocket modem encoder', () => {
    it('framing: start/end codes and Hamming(24,16) parity per pair', () => {
        const framed = frameMessage(textPattern('A', { speed: 8, delay: 0, direction: 0 }));
        assert.deepEqual(framed.slice(0, 2), [0xa5, 0xa5]);
        assert.equal(framed[2], hamming2416(0xa5, 0xa5), 'parity follows each pair');
        assert.equal(framed.length % 3, 0, 'pairs + parity');
        const raw = [];
        for (let i = 0; i < framed.length; i += 3) raw.push(framed[i], framed[i + 1]);
        assert.deepEqual(raw.slice(-4).filter((b) => b === 0x84).length >= 2, true, 'END codes present');
    });

    it('the audio round-trips through a firmware-principled demodulator', () => {
        const framed = frameMessage(textPattern('HI', { speed: 8 }));
        const audio = encodeAudio(framed, { sync: 0 });
        const got = demodulate(audio);
        assert.deepEqual(got, framed, 'every framed byte recovered from the sound');
    });

    it('sync prefix has the documented shape', () => {
        const s = syncSignal(10);
        assert.equal(s.length, 3600);
        assert.ok(Math.abs(s[3]) > 0, 'slow sine at the head');
        assert.equal(s[3599], 0, 'mute at the tail');
    });
});

describe("the 'pcm' source wave — audio into a net", () => {
    it('a sample buffer plays out as node voltage over time', () => {
        // 1 kHz "rate", ramp 0→1 over 10 samples: at t=5 ms the node
        // should sit near 2.5 V with gain 5.
        const samples = Array.from({ length: 11 }, (_, i) => i / 10);
        const b = new BoardImpl(5.0);
        b.setNetlist([
            { id: 's1', kind: 'vsource', params: { wave: 'pcm', samples, rate: 1000, gain: 5 }, terminals: ['pos', 'neg'] },
            { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ], [
            { id: 'n_s', terminals: [{ part: 's1', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
            { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 's1', terminal: 'neg' }, { part: 'r1', terminal: 'b' }] },
        ]);
        const at = (ms) => { b.advanceTo(BigInt(ms) * 1_000_000n); return b.nodeVoltages.get('n_s'); };
        assert.ok(Math.abs(at(1) - 0.5) < 0.15, `t=1ms ≈ 0.5 V, got ${at(1)}`);
        assert.ok(Math.abs(at(5) - 2.5) < 0.15, `t=5ms ≈ 2.5 V, got ${at(5)}`);
        assert.ok(Math.abs(at(9) - 4.5) < 0.15, `t=9ms ≈ 4.5 V, got ${at(9)}`);
        assert.ok(Math.abs(at(20) - 0) < 0.05, 'past the buffer: silence');
    });
});
