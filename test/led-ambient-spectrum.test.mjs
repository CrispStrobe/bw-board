// An LED used as a light sensor under coloured room light (src/optics.js,
// ambientSpectralShare; params.ambientSpectrum on the sensing LED).
//
// Gap (2026-11-24): along a light_path an LED sensor already saw only light
// shorter than its own wavelength, but the plain room `light` was colourless,
// so a red LED and an IR LED under one lamp differed only by the
// photoSensitivity typed for each. Oracle: the share of a black body (Planck)
// or of the white LED's lines inside the LED's response, computed here
// independently by trapezoid integration on a 1 nm grid.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { ambientSpectralShare } from '../src/optics.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** Photocurrent of an LED sensor into 10 kΩ (well below its open-circuit voltage). */
function photoAmps(params) {
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('D', 'led', { photoSensitivity: 10e-6, ...params }, ['anode', 'cathode']),
        P('R', 'resistor', { ohms: 10000 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['D', 'cathode'], ['R', 'b']), net('o', ['D', 'anode'], ['R', 'a'])]);
    b.setPower(true);
    b.setControl('D', 1);
    return b.nodeVoltages.get('o') / 10000;
}

describe('LED sensor under coloured room light', () => {
    it('without ambientSpectrum nothing changes: photoSensitivity at full light', () => {
        close(photoAmps({ color: 'red' }) * 1e6, 10, 0.2, 'red, colourless light (µA)');
        close(photoAmps({ color: 'ir' }) * 1e6, 10, 0.2, 'IR, colourless light (µA)');
    });

    it('under a bulb (2850 K) the IR LED sees five times what the red one sees', () => {
        const red = photoAmps({ color: 'red', ambientSpectrum: 'incandescent' });
        const ir = photoAmps({ color: 'ir', ambientSpectrum: 'incandescent' });
        assert.ok(ir > 4 * red, `IR ${ir} vs red ${red}`);
        close(red / 10e-6, ambientSpectralShare({ kind: 'led', params: { color: 'red' } }, 'incandescent'), 0.01, 'red share');
    });

    it('the share is the Planck spectrum weighted by the LED response (independent 1 nm integration)', () => {
        const planck = (nm, T) => { const l = nm * 1e-9; return 1 / (l ** 5 * (Math.exp(1.438777e-2 / (l * T)) - 1)); };
        const resp = (nm, own) => 1 / (1 + Math.exp((nm - (own - 15)) / 10));
        for (const [color, own] of [['red', 640], ['ir', 940], ['green', 568]]) {
            let n = 0, d = 0;
            for (let nm = 350; nm <= 1100; nm += 1) { const s = planck(nm, 2850); n += s * resp(nm, own); d += s; }
            close(ambientSpectralShare({ kind: 'led', params: { color } }, 'incandescent'), n / d, 0.01, color);
        }
    });

    it('white LED light holds almost nothing a red LED cannot see, and little for a blue one', () => {
        close(ambientSpectralShare({ kind: 'led', params: { color: 'red' } }, 'white-led'), 1, 0.02, 'red');
        assert.ok(ambientSpectralShare({ kind: 'led', params: { color: 'blue' } }, 'white-led') < 0.25);
    });
});
