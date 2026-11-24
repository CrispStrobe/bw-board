// Radio front end, round 4 (src/radio.js, src/rf-bands.js): the carrier's
// complex envelope integrated in time around each circuit resonance, so RF
// can oscillate; FM and Morse stations; the ferrite rod as a directional
// antenna; near-field coupling between two rods; the varicap.
//
// Gap (2026-11-23): the round-3 front end solved the carrier as a linear
// phasor, so nothing could oscillate at RF: no regenerative receiver past
// its threshold, no super-regeneration, no transmitter, no heterodyne, no
// FM. Oracles: the LC resonance f = 1/(2π√(LC)); the Barkhausen condition
// (a tickler connected the wrong way round never oscillates); a rod's
// figure-eight pattern |cos(angle − bearing)|; the near field ∝ 1/d³; the
// SPICE junction-capacitance law; ∫ sin = (1 − cos)/ω.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createHash } from 'node:crypto';
import { DMath } from '../src/det-math.js';
import { normalizeStations, programmeValue, programmeIntegral, junctionCapacitance, stationModulation } from '../src/radio.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));
const tankAmp = (b, netId) => Math.max(0, ...b._radio.bandAmplitudes(netId).map(x => x.volts));

describe('radio bands: programmes', () => {
    it('FM phase is the integral of the programme; Morse keys the carrier', () => {
        for (const audio of [{ type: 'tone', hz: 400 }, { type: 'two-tone', hz: [600, 900], period: 0.01 },
            { type: 'chord', hz: [500, 700] }, { type: 'melody', notes: [[440, 0.004], [0, 0.002], [660, 0.003]] }]) {
            const [s] = normalizeStations([{ hz: 98e6, mod: 'fm', audio }]);
            for (const t of [0.0013, 0.0071, 0.0123]) {
                const d = 1e-7;
                const deriv = (programmeIntegral(s.audio, t + d) - programmeIntegral(s.audio, t - d)) / (2 * d);
                close(deriv, programmeValue(s.audio, t), 2e-3, `${audio.type}: d/dt ∫s at ${t}`);
            }
        }
        const [cw] = normalizeStations([{ hz: 6e6, mod: 'cw', audio: { type: 'morse', text: 'E', wpm: 12 } }]);
        // 'E' is one dot (0.1 s at 12 wpm) followed by the word gap.
        assert.equal(stationModulation(cw, 0.05)[0], 1, 'key down during the dot');
        assert.equal(stationModulation(cw, 0.3)[0], 0, 'key up in the gap');
        assert.throws(() => normalizeStations([{ hz: 1e6, mod: 'xx' }]), /mod/);
    });

    it('the varicap follows the SPICE junction-capacitance law', () => {
        const P0 = { cjo: 75e-12, vj: 0.7, m: 0.75 };
        close(junctionCapacitance(P0, 0), 75e-12, 1e-18, 'zero bias');
        close(junctionCapacitance(P0, -1), 75e-12 / (1 + 1 / 0.7) ** 0.75, 1e-15, '1 V reverse');
        assert.ok(junctionCapacitance(P0, -28) < 6e-12, 'a few pF at 28 V');
        assert.equal(junctionCapacitance({}, -1), 0, 'an ordinary diode has none unless it is given cjo');
    });
});

/** A ferrite-rod receiver without a long wire: the rod is the antenna. */
function rodSet({ angle = 0, stations, pos = 0.5, rod = {} }) {
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('L1', 'ferrite_coil', { rodHeightM: 0.05, angleDeg: angle, ...rod }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TC', 'tuning_cap', { position: pos }, ['a', 'b']), P('R1', 'resistor', { ohms: 1e6 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['L1', 'a'], ['TC', 'b'], ['R1', 'b']), net('tank', ['L1', 'b'], ['TC', 'a'], ['R1', 'a'])]);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

describe('radio bands: the ferrite rod is a directional antenna', () => {
    it('picks a station up with |cos(angle − bearing)|: broadside full, end-on a null', () => {
        const stations = [{ id: 'a', hz: 700e3, fieldVPerM: 0.05, bearingDeg: 30, audio: { type: 'none' } }];
        const b = rodSet({ stations });
        ms(b, 0.2);
        const at = (deg) => { b.setControl('L1', deg / 360); ms(b, Number(b.timeNs) / 1e6 + 0.05); return b.rfVoltage('tank')[0].volts; };
        const v30 = at(30), v75 = at(75), v120 = at(120), v210 = at(210);
        assert.ok(v30 > 0, 'it receives');
        close(v75 / v30, Math.cos(45 * Math.PI / 180), 0.02, 'at 45° from the bearing');
        assert.ok(v120 < 0.01 * v30, `pointing across (90° off) is the null: ${v120} vs ${v30}`);
        close(v210 / v30, 1, 0.01, 'the back of the figure eight is as strong as the front');
    });

    it('two rods couple in the near field: a twice-as-far receiver gets an eighth', () => {
        const build = (d) => {
            const b = new BoardImpl(5);
            b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('ANT', 'antenna', {}, ['a']), P('E', 'earth', {}, ['earth']),
                P('L1', 'ferrite_coil', { rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']), P('T1', 'tuning_cap', { position: 0.5 }, ['a', 'b']),
                P('L2', 'ferrite_coil', { rodHeightM: 0, linkTo: 'L1', distanceM: d }, ['a', 'tap', 'b', 'c1', 'c2']),
                P('T2', 'tuning_cap', { position: 0.5 }, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['E', 'earth'], ['L1', 'a'], ['T1', 'b'], ['L2', 'a'], ['T2', 'b']),
                net('ant', ['ANT', 'a'], ['L1', 'tap']), net('t1', ['L1', 'b'], ['T1', 'a']), net('t2', ['L2', 'b'], ['T2', 'a'])]);
            b.setBroadcast([{ id: 'a', hz: 760e3, fieldVPerM: 0.02, audio: { type: 'none' } }]);
            b.setPower(true);
            ms(b, 0.2);
            return b.rfVoltage('t2')[0].volts / b.rfVoltage('t1')[0].volts;
        };
        const near = build(1), far = build(2);
        assert.ok(near > 0, 'the second tank receives through the first');
        close(near / far, 8, 0.4, 'near field ∝ 1/d³');
    });
});

/**
 * A Meissner oscillator on the MW ferrite coil: tank (main winding + tuning
 * capacitor) in the collector, the coupling winding in the base circuit.
 * `sense` 1 connects the coupling winding for positive feedback, -1 the
 * other way round.
 */
function meissner({ sense = 1, re = 1000, pos = 0.3, cbias = 10e-9, ce = 1e-9, ratio = 0.05, henrys = 250e-6, stations = [], extra = [], extraNets = {} } = {}) {
    const b = new BoardImpl(9);
    const [cb, cbOther] = sense > 0 ? ['c1', 'c2'] : ['c2', 'c1'];
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('L1', 'ferrite_coil', { rodHeightM: 0, couplingRatio: ratio, henrys }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TC', 'tuning_cap', { position: pos }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
        P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']),
        P('CB', 'capacitor', { farads: cbias }, ['a', 'b']), P('RE', 'resistor', { ohms: re }, ['a', 'b']),
        P('CE', 'capacitor', { farads: ce }, ['a', 'b']), ...extra],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['RE', 'b'], ['CE', 'b'], ...(extraNets.g ?? [])),
        net('v', ['VS', 'pos'], ['L1', 'a'], ['TC', 'a'], ['R1', 'a']),
        net('col', ['Q1', 'collector'], ['L1', 'b'], ['TC', 'b']),
        net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['L1', cbOther], ...(extraNets.bias ?? [])),
        net('base', ['Q1', 'base'], ['L1', cb], ...(extraNets.base ?? [])), net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a'], ...(extraNets.e ?? [])),
        ...(extraNets.more ?? [])]);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}


/** An AM test transmitter (Meissner + modulator on one rod) and a crystal set on a second rod 0.5 m away. */
function transmitter(ratio = 0.02) {
    const b = new BoardImpl(9);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('LT', 'ferrite_coil', { rodHeightM: 0, couplingRatio: ratio }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TCT', 'tuning_cap', { position: 0.3 }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
        P('R1', 'resistor', { ohms: 22e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 22e3 }, ['a', 'b']),
        P('CB', 'capacitor', { farads: 10e-9 }, ['a', 'b']), P('RE', 'resistor', { ohms: 1000 }, ['a', 'b']),
        P('CE', 'capacitor', { farads: 1e-9 }, ['a', 'b']), P('Q2', 'npn', {}, ['base', 'collector', 'emitter']),
        P('RE2', 'resistor', { ohms: 470 }, ['a', 'b']), P('RIN', 'resistor', { ohms: 10e3 }, ['a', 'b']),
        P('FG', 'function_gen', { wave: 'sine', freq: 1000, amplitude: 0.1, offset: 1.2 }, ['out', 'gnd']),
        P('LR', 'ferrite_coil', { rodHeightM: 0, linkTo: 'LT', distanceM: 0.5 }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TCR', 'tuning_cap', { position: 0.309 }, ['a', 'b']), P('D', 'diode', { part: '1N34A' }, ['anode', 'cathode']),
        P('CD', 'capacitor', { farads: 2.2e-9 }, ['a', 'b']), P('RD', 'resistor', { ohms: 47e3 }, ['a', 'b'])],
    [net('v', ['VS', 'pos'], ['LT', 'a'], ['TCT', 'a'], ['R1', 'a']), net('col', ['Q1', 'collector'], ['LT', 'b'], ['TCT', 'b']),
        net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['LT', 'c2']), net('base', ['Q1', 'base'], ['LT', 'c1']),
        net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a']), net('m', ['RE', 'b'], ['Q2', 'collector']),
        net('e2', ['Q2', 'emitter'], ['RE2', 'a']), net('b2', ['Q2', 'base'], ['RIN', 'b']), net('fg', ['RIN', 'a'], ['FG', 'out']),
        net('rx', ['LR', 'b'], ['TCR', 'a'], ['D', 'anode']), net('det', ['D', 'cathode'], ['CD', 'a'], ['RD', 'a']),
        net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['CE', 'b'], ['RE2', 'b'], ['FG', 'gnd'], ['LR', 'a'], ['TCR', 'b'], ['CD', 'b'], ['RD', 'b'])]);
    b.setBroadcast([]);
    b.setPower(true);
    return b;
}

describe('radio bands: oscillation', () => {
    it('a short-wave oscillator beside a station still oscillates: the band resolves its offset', () => {
        // 5 µH, ~6.1 MHz. A carrier 20 kHz away puts the band's centre on the
        // station; the oscillation then rotates at the offset in the band's
        // frame, and a substep chosen for the station alone damped it away.
        const lEff = 5e-6, c = 10e-12 + 490e-12 * 0.27;
        const f0 = 1 / (2 * Math.PI * Math.sqrt(lEff * c));
        const b = meissner({ henrys: lEff, pos: 0.27, ratio: 0.15,
            stations: [{ id: 'cw', hz: f0 + 20e3, fieldVPerM: 0.005, mod: 'cw', audio: { type: 'morse', text: 'T', wpm: 5 } }] });
        let m = 0;
        for (const t of [2, 2.5, 3]) { ms(b, t); m = Math.max(m, tankAmp(b, 'col')); }
        assert.ok(m > 0.5, `oscillates at ~${(f0 / 1e6).toFixed(2)} MHz beside the station: ${m} V`);
    });

    it('a Meissner oscillator starts from noise at the LC frequency, limits, and is deterministic', () => {
        // Small bias capacitors (10 nF base, 1 nF emitter): with the bias
        // network much faster than the tank's envelope the oscillation runs
        // steadily. (With 100 nF / 100 nF it squegs — bursts and pauses —
        // as an over-coupled real one does.)
        const swing = (b) => { let m = 0; for (const t of [2, 2.5, 3]) { ms(b, t); m = Math.max(m, tankAmp(b, 'col')); } return m; };
        const b = meissner();
        const amp = swing(b);
        const rep = b.radioReport();
        const c = 10e-12 + 490e-12 * 0.3;
        const f0 = 1 / (2 * Math.PI * Math.sqrt(250e-6 * c));
        assert.ok(rep.bands.length >= 1, 'a band at the tank resonance');
        const band = rep.bands.reduce((a, x) => (Math.abs(x.hz - f0) < Math.abs(a.hz - f0) ? x : a));
        // Within a few per cent: the transistor's capacitances and the
        // coupling winding's load pull the resonance slightly.
        close(band.hz / f0, 1, 0.05, 'oscillation frequency against 1/(2π√LC)');
        assert.ok(amp > 0.5 && amp < 12, `the collector swings volts, limited below the supply's reach: ${amp} V`);
        // The same bench again: the same swing (seeded noise).
        close(swing(meissner()), amp, 1e-9, 'deterministic');
    });

    it('the tank capacitor is an RF part: not in the time-domain solve, so an oscillator stays cheap', () => {
        // Gap found building the AM transmitter: a capacitor across a winding
        // (whose time-domain view is its copper resistance) is a
        // sub-nanosecond mode that every change of the rectified current rang;
        // the transient step control chased it at ~38 000 solves per ms.
        const b = meissner();
        ms(b, 1);
        assert.ok(!b._solveParts.some(p => p.id === 'TC'), 'tuning capacitor left out of the transient solve');
        assert.ok(b._radio.rfView(b._solveParts, b._solveNets).parts.some(p => p.id === 'TC'), '…and kept in the RF view');
        // The oscillator squegs (bursts and pauses at the bias network's
        // pace); its cost follows the bursts, so it is averaged over 2 ms.
        // Before: ~38 000 per ms. Measured with the tank capacitor out:
        // 10 000–17 000 per ms across 1-ulp changes of the coil.
        const w0 = b.transientAnalysisStatus().work.solves;
        ms(b, 3);
        const perMs = (b.transientAnalysisStatus().work.solves - w0) / 2;
        assert.ok(perMs < 20000, `oscillating, ${perMs} solves per simulated ms`);
    });

    it('an RF-size capacitor (a Colpitts feedback cap) is an RF part too', () => {
        // Gap found building the super-regenerator: 3.3 pF and 10 pF around a
        // VHF transistor were sub-nanosecond modes in the transient solve,
        // the limiting state of most of its steps. Up to 47 pF they belong to
        // the RF view; the 10 nF bias capacitor stays where it is.
        const b = meissner({ extra: [P('CX', 'capacitor', { farads: 22e-12 }, ['a', 'b'])], extraNets: { base: [['CX', 'a']], e: [['CX', 'b']] } });
        ms(b, 0.5);
        assert.ok(!b._solveParts.some(p => p.id === 'CX'), '22 pF left out of the transient solve');
        assert.ok(b._radio.rfView(b._solveParts, b._solveNets).parts.some(p => p.id === 'CX'), '…and kept in the RF view');
        assert.ok(b._solveParts.some(p => p.id === 'CB'), 'the 10 nF bias capacitor stays in the transient solve');
    });

    it('a quenched oscillator: the band grows and collapses with the bias the quench sets', () => {
        // A 2 kHz sine (3 V peak) into the bias divider through 4.7 kΩ swings
        // the base past cut-off and back. The oscillation lives in the band,
        // the quench in the transient solve: each half cycle the stage gains
        // (the band grows from noise to volts) and loses (it dies away), and
        // the tank stays the band's while the stage is cut off.
        const b = meissner({ extra: [P('FQ', 'function_gen', { wave: 'sine', freq: 2000, amplitude: 3 }, ['out', 'gnd']), P('RQ', 'resistor', { ohms: 4700 }, ['a', 'b'])],
            extraNets: { bias: [['RQ', 'b']], g: [['FQ', 'gnd']], more: [net('q', ['FQ', 'out'], ['RQ', 'a'])] } });
        ms(b, 2);
        const w0 = b.transientAnalysisStatus().work.solves;
        let lo = Infinity, hi = 0;
        for (let k = 1; k <= 50; k++) { ms(b, 2 + k * 0.01); const a = tankAmp(b, 'col'); lo = Math.min(lo, a); hi = Math.max(hi, a); }
        assert.equal(b.transientAnalysisStatus().failure, null);
        assert.ok(hi > 0.5, `each quench cycle the oscillation builds up: ${hi.toFixed(3)} V`);
        assert.ok(lo < 0.01 * hi, `…and collapses: down to ${lo.toExponential(2)} V`);
        const perMs = (b.transientAnalysisStatus().work.solves - w0) / 0.5;
        assert.ok(perMs < 30000, `${perMs} solves per simulated ms (cut off: hundreds; oscillating while the quench sweeps the bias: tens of thousands)`);
    });

    it('the coupling winding the wrong way round: no oscillation', () => {
        const b = meissner({ sense: -1 });
        ms(b, 3);
        assert.ok(tankAmp(b, 'col') < 1e-3, `reversed feedback stays at the noise floor: ${tankAmp(b, 'col')} V`);
    });

    it('too little gain (heavy emitter degeneration): no oscillation', () => {
        const b = meissner({ re: 1e6 });
        ms(b, 3);
        assert.ok(tankAmp(b, 'col') < 1e-3, `starved transistor: ${tankAmp(b, 'col')} V`);
    });
});

describe('radio bands: which front end', () => {
    it('a receiver that cannot oscillate keeps the round-3 phasor front end; feedback, FM or a rod antenna get the bands', async () => {
        const { chooseFrontEnd } = await import('../src/radio.js');
        const T = (part, terminal) => ({ part, terminal });
        const crystal = [P('G', 'gnd', {}, ['gnd']), P('A', 'antenna', {}, ['a']), P('L', 'ferrite_coil', {}, ['a', 'tap', 'b', 'c1', 'c2']),
            P('D', 'diode', {}, ['anode', 'cathode'])];
        const cn = [net('g', ['G', 'gnd'], ['L', 'a']), net('ant', ['A', 'a'], ['L', 'tap']), net('t', ['L', 'b'], ['D', 'anode'])];
        assert.equal(chooseFrontEnd(crystal, cn), 'phasor');
        // A collector on a coil winding (tickler / tank in the collector).
        const q = [...crystal, P('Q', 'npn', {}, ['base', 'collector', 'emitter'])];
        const qn = cn.map(n => ({ ...n, terminals: [...n.terminals] }));
        qn.push({ id: 'c', terminals: [T('Q', 'collector'), T('L', 'c1')] });
        assert.equal(chooseFrontEnd(q, qn), 'envelope');
        // An FM station on the antenna.
        const fm = crystal.map(p => p.id === 'A' ? { ...p, params: { stations: [{ hz: 98e6, mod: 'fm' }] } } : p);
        assert.equal(chooseFrontEnd(fm, cn), 'envelope');
        // No long wire: the rod is the antenna.
        assert.equal(chooseFrontEnd(crystal.filter(p => p.id !== 'A'), cn), 'envelope');
    });
});

describe('radio bands: unphysical parameters and runaways', () => {
    it('a coupling winding with more turns than the main winding is clamped to it, with a warning', () => {
        const b = transmitter(1.074);
        ms(b, 0.05);
        const w = b.getWarnings().find(x => x.type === 'param-clamped' && x.partId === 'LT');
        assert.ok(w, `warned: ${JSON.stringify(b.getWarnings())}`);
        assert.match(w.message, /couplingRatio/);
    });

    it('an RF band that runs away is refused, and its history stays bounded', () => {
        // Gap found by sb3's circuit-params gate: lab-am-transmitter with the
        // coupling ratio at 1.074 grew without bound — the bands integrated
        // ahead of every rejected transient trial at 1 ns substeps, 200 000
        // history entries per call, past 3 GB within the first millisecond.
        const b = transmitter(1.074);
        let longest = 0;
        for (const t of [0.5, 1, 1.5, 2]) {
            ms(b, t);
            for (const band of b._radio._bands ?? []) longest = Math.max(longest, band.hist.length);
        }
        assert.ok(longest <= 20000, `band history bounded: ${longest} entries`);
        const err = b._radio.error;
        if (err) assert.ok(b.getWarnings().some(x => x.type === 'rf-refused'), 'a refused band is reported as a warning');
    });
});

describe('radio bands: the same answer on every platform', () => {
    it('the solvers\' transcendental functions are bit-reproducible (det-math)', () => {
        // V8's Math.exp/log/sin/cos/pow… are C++ that the compiler may fuse
        // into FMA instructions on arm64 and not on x64: one ulp apart on
        // macOS and Linux for a few inputs in 10^5. An oscillator starting
        // from noise turned that into a different trajectory within 70 µs
        // (bw-board CI on Linux at 20c29a77; sb3's lab-shortwave-regen
        // heard 10 kHz there, 5 kHz on macOS). src/det-math.js uses only
        // exactly rounded operations: this digest is the same everywhere.
        const xs = [];
        let s = 0x2545F491;
        for (let i = 0; i < 20000; i++) {
            s = (Math.imul(s, 1103515245) + 12345) >>> 0;
            const m = s / 4294967296 - 0.5, e = (i % 40) - 20;
            xs.push(m * (e >= 0 ? (1 << e) : 1 / (1 << -e)));
        }
        const h = createHash('sha256'), f = new Float64Array(1), u = new Uint8Array(f.buffer);
        const arg = { log: Math.abs, log10: Math.abs, log1p: Math.abs, asin: (x) => x / 1048576, acos: (x) => x / 1048576,
            exp: (x) => x / 2048, expm1: (x) => x / 2048, sinh: (x) => x / 2048, cosh: (x) => x / 2048 };
        let worst = 0;
        for (const name of ['exp', 'log', 'log1p', 'expm1', 'log10', 'sin', 'cos', 'tan', 'atan', 'tanh', 'sinh', 'cosh', 'asin', 'acos']) {
            for (const x of xs) {
                const a = (arg[name] ?? ((v) => v))(x);
                f[0] = DMath[name](a); h.update(u);
                const ref = Math[name](a);
                if (Number.isFinite(ref) && Math.abs(ref) > 1e-300 && !['sin', 'cos', 'tan'].includes(name)) worst = Math.max(worst, Math.abs(f[0] - ref) / Math.abs(ref) / 2 ** -52);
            }
        }
        for (let i = 0; i < xs.length; i++) {
            f[0] = DMath.atan2(xs[i], xs[(i + 7) % xs.length]); h.update(u);
            f[0] = DMath.pow(Math.abs(xs[i]), xs[i] / 4096); h.update(u);
        }
        assert.equal(h.digest('hex'), '871ef96a878137aa522a26eaf3fc5f7ea16e92c4a2d0f3071dff7568e41a66a0');
        assert.ok(worst < 3, `within ${worst.toFixed(2)} ulp of V8's own`);
    });

    it('an oscillator starting from noise: the same trajectory on every platform', () => {
        // Measured identically on macOS arm64 and Linux x64 (Node 24/26).
        // Without det-math the two parted at 67 µs (by 0.2 ms: 1750 against
        // 1657 solves, tank 3.41 V against 5.32 V).
        const b = meissner();
        ms(b, 0.3);
        assert.equal(b.transientAnalysisStatus().work.solves, 2158);
        assert.equal(b._radio.substeps, 2853);
        assert.equal(tankAmp(b, 'col'), 6.697898643480968);
    });

    it('1-ulp changes of the coil do not move the oscillator\'s outcome', () => {
        // What a 1-ulp change may not move: the resonance, when the
        // oscillation builds up out of the noise, and how big it is on
        // average. The burst pattern of this oscillator is another matter:
        // it squegs (the 10 nF bias capacitor charges from the rectified
        // swing, cuts the stage off, recovers), and when each burst restarts
        // from the noise floor is as sensitive to the state as in a real
        // one — the burst instants, the peak and the solve count are not
        // asserted. At build time: start 98 µs for all; mean swing over
        // 1–3 ms 5.27–6.32 V.
        const run = (ulps) => {
            const b = meissner({ henrys: 250e-6 * (1 + ulps * 2 ** -52) });
            let start = null;
            for (let k = 1; k <= 100 && start === null; k++) { ms(b, k * 0.002); if (tankAmp(b, 'col') > 1) start = k * 0.002; }
            ms(b, 1);
            let sum = 0;
            for (let k = 1; k <= 200; k++) { ms(b, 1 + k * 0.01); sum += tankAmp(b, 'col'); }
            return { start, mean: sum / 200, res: b._radio._resonances.map(r => r.hz) };
        };
        const base = run(0);
        assert.ok(base.start !== null && base.mean > 1, `oscillating: from ${base.start} ms, ${base.mean} V`);
        for (const u of [1, 2, 3]) {
            const p = run(u);
            assert.deepEqual(p.res, base.res, 'the same resonance');
            assert.equal(p.start, base.start, `${u} ulp: builds up at the same time`);
            assert.ok(Math.abs(p.mean / base.mean - 1) < 0.25, `${u} ulp: mean swing ${p.mean.toFixed(3)} against ${base.mean.toFixed(3)} V`);
        }
    });
});
