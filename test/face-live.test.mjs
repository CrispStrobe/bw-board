// Live-mode resolver goldens: the frame convention, streaming
// reassembly, text passthrough, null-before-telemetry honesty — and
// the contract's point: the SAME descriptor resolves in both worlds.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFaceResolver } from '../src/face-live.js';
import { YL39_FACE } from '../src/face.js';

describe('live face resolver', () => {
    const DESC = {
        id: 't',
        elements: [
            { id: 'led1', kind: 'led', bind: { source: 'pin', ref: 'P1.0', activeLow: true } },
            { id: 'seg', kind: 'digits', bind: { source: 'device', ref: 'SEG1', field: 'digits' } },
            { id: 'pot', kind: 'level', bind: { source: 'net', ref: 'POT' } },
        ],
    };

    it('frames update the world; unknown state is null, not a guess', () => {
        const r = createLiveFaceResolver(DESC);
        assert.deepEqual(r.snapshot(), { led1: null, seg: null, pot: null },
            'no telemetry yet means UNKNOWN — a live face must not invent lows');
        r.feed('~p,P1.0,0\n~a,POT,2.47\n~d,SEG1,digits,[1,2,3,4]\n');
        const s = r.snapshot();
        assert.equal(s.led1, 1, 'low + activeLow = lit, same convention as sim');
        assert.deepEqual(s.seg, [1, 2, 3, 4]);
        assert.ok(Math.abs(s.pot - 2.47) < 1e-9);
    });

    it('frames interleave with program text; text passes through clean', () => {
        let text = '';
        const r = createLiveFaceResolver(DESC, { onText: (t) => { text += t; } });
        r.feed('Hello ');
        r.feed('world\n~p,P1.0,1\npart');
        r.feed('ial\n~a,POT,1.0\n');
        assert.equal(text, 'Hello world\npartial\n');
        assert.equal(r.snapshot().led1, 0, 'high + activeLow = dark');
    });

    it('split frames reassemble; a dangling partial flushes as text', () => {
        let text = '';
        const r = createLiveFaceResolver(DESC, { onText: (t) => { text += t; } });
        r.feed('~p,P1');
        r.feed('.0,0\n');
        assert.equal(r.snapshot().led1, 1, 'split frame reassembled');
        r.feed('~broken without newline');
        r.flush();
        assert.ok(text.includes('~broken without newline'), 'dangling partial became text');
    });

    it('the SAME descriptor serves both worlds — the contract\'s point', () => {
        const live = createLiveFaceResolver(YL39_FACE);
        live.feed('~p,P1.0,0\n~d,SEG1,digits,[8,8,8,8]\n');
        const s = live.snapshot();
        assert.equal(s.D1, 1, 'YL-39 D1 lights from live telemetry');
        assert.deepEqual(s.SEG, [8, 8, 8, 8]);
        assert.equal(s.D2, null, 'unreported pins stay honest nulls');
    });

    it('diff reports only changes across feeds', () => {
        const r = createLiveFaceResolver(DESC);
        r.feed('~p,P1.0,0\n');
        const d1 = r.diff();
        assert.equal(d1.led1, 1);
        assert.deepEqual(r.diff(), {}, 'quiet stream, quiet diff');
        r.feed('~p,P1.0,1\n');
        const d3 = r.diff();
        assert.deepEqual(Object.keys(d3), ['led1']);
        assert.equal(d3.led1, 0);
    });
});
