// Op-amp input bias and offset current.
//
// Gap (2026-11-25, r12): the LM358/LM324 macromodel drew nothing at its
// inputs, so a gallery bench that teaches "a x10 meter stage reads 0.4 V with
// its probe open, because the chip's inputs leak current into the 1 MOhm"
// had to draw a labelled 45 nA current source as a stand-in for the chip.
//
// The ground-sensing family's input stage is a PNP pair: its base current
// flows OUT of each input pin, supplied from VCC. Card typicals: 45 nA bias,
// 5 nA offset (`params.inputBiasA`, `params.inputOffsetCurrentA`; the +
// input carries Ib + Ios/2, the - input Ib - Ios/2). It fades out within a
// few hundred millivolts of VCC (the input pair's tail source runs out of
// headroom), so an input left on nothing but a capacitor charges up to the
// rail and never past it.
//
// The precision cards (src/devices/analog-amps.js) take the same two params,
// opt-in: an NPN or JFET input's bias current flows INTO the pin.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

function board(parts, nets, vcc = 9) {
    const P = Object.entries(parts).map(([id, [kind, params]]) => ({ id, kind, params: params ?? {}, terminals: [] }));
    const N = nets.map((n, i) => ({ id: `n${i}`, terminals: n.map(s => { const [part, terminal] = s.split('.'); return { part, terminal }; }) }));
    for (const p of P) for (const n of N) for (const t of n.terminals) if (t.part === p.id && !p.terminals.includes(t.terminal)) p.terminals.push(t.terminal);
    const b = new BoardImpl(vcc);
    b.setNetlist(P, N);
    b.setPower(true);
    let tMs = 0;
    const netOf = (s) => { const [part, terminal] = s.split('.'); return b.getNets().find(n => n.terminals.some(x => x.part === part && x.terminal === terminal)).id; };
    return {
        b,
        v: (s) => b.nodeVoltages.get(netOf(s)) ?? 0,
        run(ms) {
            tMs += ms;
            b.advanceTo(BigInt(Math.round(tMs * 1e6)));
            assert.equal(b.transientAnalysisStatus().failure, null, `solver failed by ${tMs} ms`);
        },
    };
}

/** Section 1 a follower whose + input hangs on `r` to ground; the others parked. */
const follower = (kind, u = {}, r = 1e6) => board({
    bat: ['vsource', { volts: 9 }], g: ['gnd'], u: [kind, u], r: ['resistor', { ohms: r }],
}, [
    ['bat.pos', 'u.vcc'], ['u.1_pos', 'r.a'], ['u.1_out', 'u.1_neg'],
    ['bat.neg', 'g.gnd', 'u.gnd', 'r.b', ...(kind === 'lm324' ? ['u.2_pos', 'u.2_neg', 'u.2_out', 'u.3_pos', 'u.3_neg', 'u.3_out', 'u.4_pos', 'u.4_neg', 'u.4_out'] : ['u.2_pos', 'u.2_neg', 'u.2_out'])],
]);

describe('LM324 / LM358: input bias current', () => {
    for (const kind of ['lm324', 'lm358']) {
        it(`${kind}: a follower on 1 MOhm reads (Ib + Ios/2) x 1 MOhm = 47.5 mV`, () => {
            const x = follower(kind);
            x.run(5);
            close(x.v('u.1_pos'), 0.0475, 0.0005, '+ input');
            close(x.v('u.1_out'), 0.0475, 0.0006, 'output');
        });
    }

    it('the - input: a 1 MOhm feedback resistor alone gives -(Ib - Ios/2) x 1 MOhm', () => {
        const x = board({ bat: ['vsource', { volts: 9 }], bn: ['vsource', { volts: 9 }], g: ['gnd'], u: ['lm324', {}], rf: ['resistor', { ohms: 1e6 }] }, [
            ['bat.pos', 'u.vcc'], ['bn.neg', 'u.gnd'], ['u.1_neg', 'rf.a'], ['u.1_out', 'rf.b'],
            ['bat.neg', 'bn.pos', 'g.gnd', 'u.1_pos', 'u.2_pos', 'u.2_neg', 'u.2_out', 'u.3_pos', 'u.3_neg', 'u.3_out', 'u.4_pos', 'u.4_neg', 'u.4_out'],
        ]);
        x.run(5);
        close(x.v('u.1_out'), -0.0425, 0.0006, 'output');
    });

    it('params: inputBiasA and inputOffsetCurrentA set the two currents', () => {
        const none = follower('lm324', { inputBiasA: 0, inputOffsetCurrentA: 0 });
        none.run(5);
        close(none.v('u.1_pos'), 0, 1e-6, 'no bias: + input on ground');
        const big = follower('lm324', { inputBiasA: 100e-9, inputOffsetCurrentA: -20e-9 });
        big.run(5);
        close(big.v('u.1_pos'), 0.090, 0.0005, '100 nA - 10 nA into 1 MOhm');
    });

    it('an input on nothing but a capacitor charges to the rail and not past it', () => {
        const x = board({ bat: ['vsource', { volts: 9 }], g: ['gnd'], u: ['lm358', {}], c: ['capacitor', { farads: 1e-9 }] }, [
            ['bat.pos', 'u.vcc'], ['u.1_pos', 'c.a'], ['u.1_out', 'u.1_neg'],
            ['bat.neg', 'g.gnd', 'u.gnd', 'c.b', 'u.2_pos', 'u.2_neg', 'u.2_out'],
        ]);
        x.run(50);
        close(x.v('u.1_pos'), 0.05 * 47.5, 0.05, 'charging at Ib/C = 47.5 V/s');
        x.run(400);
        const v = x.v('u.1_pos');
        assert.ok(v > 8.3 && v < 9, `stops just below VCC: ${v}`);
    });
});
