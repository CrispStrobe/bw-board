// A Meissner transmitter with a slow (1 µF) emitter bypass, against its
// full-carrier ngspice reference (test/golden/run_ngspice_meissner.py,
// docs/RF-MEISSNER-REFERENCE-2026-11-27.md). The circuit oscillates
// steadily: the collector bottoming out holds the swing, so the bias cannot
// over-run. The envelope bands used to squeg it at ~2.8 kHz whenever the
// transient solve took small steps (20 µs advances, any outer-step cap): the
// band's gain came from a collector current smoothed over 5 µs, which kept
// a cut-off stage pumping its tank.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const fx = JSON.parse(readFileSync(new URL('./fixtures/meissner-squegg-netlist.json', import.meta.url), 'utf8'));
const ref = JSON.parse(readFileSync(new URL('./golden/ngspice_meissner_squegg.json', import.meta.url), 'utf8'))
    .results.find(r => r.name === 'sq gear 10 ns');

const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));
const tankAmp = (b) => Math.max(0, ...b._radio.bandAmplitudes(fx.tank).map(x => x.volts));

/** Swing over 5–6 ms, the first `warm` ms advanced in `chunk` ms calls. */
function swing(warm, chunk) {
    const b = new BoardImpl(fx.vcc);
    b.setNetlist(structuredClone(fx.parts), structuredClone(fx.nets));
    b.setPower(true);
    b.setControl(fx.bypass, 0);
    for (let t = chunk; t <= warm + 1e-9; t += chunk) ms(b, t);
    let lo = Infinity, hi = 0;
    for (let k = 1; k <= 50; k++) {
        ms(b, warm + k * 0.02);
        assert.equal(b._radio.error, null);
        const a = tankAmp(b);
        lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    return { lo, hi, emitter: b.nodeVoltages.get(fx.emitter) };
}

it('a slow emitter bypass: the swing the full-carrier reference has, whatever the advance schedule', () => {
    // REFERENCE (ngspice 47, gear, 10 ns): 8.9725–8.9843 V, emitter 0.0517 V;
    // the 20 ns / trapezoidal / 5 ns runs agree within 0.15 %.
    // MEASURED 2026-11-27 after the repair, 6–9 ms: 8.895–8.915 V (one
    // 6 ms advance), 8.895–8.908 V (20 µs advances), 8.901 V (outer step
    // <= 1 µs); emitter 0.062 V in all three (the generic transistor's knee,
    // as before the repair). Before it, 20 µs advances squegged
    // (0.0001–9.84 V, 2784 Hz) and so did any outer-step cap.
    const runs = [[5, 5], [5, 0.02]].map(([warm, chunk]) => ({ chunk, ...swing(warm, chunk) }));
    for (const s of runs) {
        assert.ok(s.lo > 0.98 * ref.envelopeMinV && s.hi < 1.02 * ref.envelopeMaxV,
            `${s.chunk} ms advances: ${s.lo.toFixed(3)}–${s.hi.toFixed(3)} V against ${ref.envelopeMinV.toFixed(3)}–${ref.envelopeMaxV.toFixed(3)} V`);
        assert.ok(s.hi / s.lo < 1.005, `${s.chunk} ms advances: a steady swing, ${s.lo.toFixed(4)}–${s.hi.toFixed(4)} V`);
        assert.ok(Math.abs(s.emitter - ref.emitterV[0]) < 0.015, `${s.chunk} ms advances: emitter ${s.emitter.toFixed(4)} V against ${ref.emitterV[0].toFixed(4)} V`);
    }
    assert.ok(Math.abs(runs[0].emitter - runs[1].emitter) < 0.002, `the advance schedule does not move the bias (${runs[0].emitter.toFixed(4)} against ${runs[1].emitter.toFixed(4)} V)`);
});
