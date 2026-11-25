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
import { readFileSync } from 'node:fs';
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
        // The state moved with the engine on 2026-11-24 (the transistor's
        // large-signal input capacitance, the band's bias-loop step bound;
        // was 2149 solves, 2596 substeps, 0.8028 V), checked identical on
        // both platforms again. Moved again 2026-11-25: the junction stamps
        // are made consistent with each band step's end (the collector's
        // swing no longer collapses where it reaches the base–collector
        // junction); was 3136 solves, 2533 substeps, 7.826 V. Then 832
        // solves, 8.670 V until a step's upward correction was capped at
        // the swing it started from (same day). Checked identical on macOS
        // arm64 and Linux x64.
        assert.equal(b.transientAnalysisStatus().work.solves, 892);
        assert.equal(b._radio.substeps, 470);
        assert.equal(tankAmp(b, 'col'), 8.671373858807078);
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

describe('radio bands: the cost of a quenched receiver', () => {
    it('a super-regenerator\'s band steps follow the growth the quench sets, not a runaway extrapolation of it', () => {
        // The band's substep is bounded by the growth rate at the bias the
        // transient solve sets. It was extrapolated linearly from the
        // current at the last bound; the quench drives the current far past
        // that, the extrapolated rate ran away, and the band was held at
        // 1 ns substeps: ~160 000 per simulated ms, 40 % of the run time.
        // Now the rate is estimated afresh when the current or the swing has
        // moved: ~5 300 per ms.
        const fx = JSON.parse(readFileSync(new URL('./fixtures/superregen-vhf-netlist.json', import.meta.url), 'utf8'));
        const b = new BoardImpl(fx.vcc);
        b.setNetlist(fx.parts, fx.nets);
        b.setPower(true);
        ms(b, 1);
        const s0 = b._radio.substeps;
        let hi = 0;
        for (let k = 1; k <= 25; k++) { ms(b, 1 + k * 0.01); hi = Math.max(hi, ...b._radio._bands.map(x => Math.max(...x.portVoltages().map(p => Math.hypot(p[0], p[1]))))); }
        assert.equal(b.transientAnalysisStatus().failure, null);
        assert.ok(hi > 1, `it still bursts: ${hi.toFixed(2)} V`);
        const perMs = (b._radio.substeps - s0) / 0.25;
        assert.ok(perMs < 20000, `${perMs} band substeps per simulated ms`);
    });
});

describe('radio bands: an audio amplifier\'s input rectifies', () => {
    // A short wire straight on an LM386's +IN (gain 200, loudspeaker), no
    // earth. The input is the base of a PNP follower; a strong AM station's
    // swing there is rectified by that junction like any other and the
    // programme comes out of the loudspeaker (RF interference into an
    // LM386). A weak station barely does: the junction is square-law there.
    function wireAmp(stations) {
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
            P('ANT', 'antenna', { heightM: 0.3, farads: 10e-12 }, ['a']),
            P('U', 'lm386', {}, ['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8']),
            P('CG', 'capacitor', { farads: 10e-6 }, ['a', 'b']), P('CB', 'capacitor', { farads: 10e-6 }, ['a', 'b']),
            P('CO', 'capacitor', { farads: 220e-6 }, ['a', 'b']), P('SPK', 'speaker', { ohms: 8 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['VS', 'neg'], ['U', 'gnd'], ['U', 'inn'], ['CB', 'b'], ['SPK', 'b']),
            net('v', ['VS', 'pos'], ['U', 'vs']), net('in', ['ANT', 'a'], ['U', 'inp']),
            net('g1', ['U', 'gain1'], ['CG', 'a']), net('g8', ['U', 'gain8'], ['CG', 'b']), net('by', ['U', 'bypass'], ['CB', 'a']),
            net('o', ['U', 'vout'], ['CO', 'a']), net('s', ['CO', 'b'], ['SPK', 'a'])]);
        b.setBroadcast(stations);
        b.setPower(true);
        ms(b, 60);
        return b.buzzerTone('SPK');
    }

    it('a strong station plays through an LM386 with a bare wire on its input', () => {
        const strong = wireAmp([{ id: 'local', hz: 1e6, fieldVPerM: 0.1, depth: 0.8, audio: { type: 'tone', hz: 400 } }]);
        assert.ok(strong.on && Math.abs(strong.hz - 400) < 5, `the programme: ${JSON.stringify(strong)}`);
        assert.ok(strong.amps > 0.05, `loud: ${strong.amps} A rms`);
        const weak = wireAmp([{ id: 'far', hz: 1e6, fieldVPerM: 0.01, depth: 0.8, audio: { type: 'tone', hz: 400 } }]);
        assert.ok(weak.amps < strong.amps / 5, `a tenth of the field, far less than a tenth of the sound: ${weak.amps} A`);
    });
});

describe('radio bands: MOSFET stages and hand-wound coils', () => {
    const fixture = (name, edit) => {
        const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
        if (edit) edit(fx);
        const b = new BoardImpl(fx.vcc);
        b.setNetlist(fx.parts, fx.nets);
        b.setPower(true);
        return b;
    };
    const swing = (b) => Math.max(0, ...b._radio._bands.map(x => Math.max(...x.portVoltages().map(p => Math.hypot(p[0], p[1])))));

    it('a MOSFET oscillator limits at its drain\'s headroom instead of growing without bound', () => {
        // The square law only gains with the gate swing; nothing limited it,
        // and the MOSFET regenerative receiver's band ran to 14 kV and was
        // refused. The drain's own swing past its headroom to the triode
        // edge now levels the fundamental off, and the rectified drain
        // current fades as the channel enters triode.
        const b = fixture('mosfet-regen-netlist.json', (fx) => {
            fx.parts.find(p => p.kind === 'potentiometer').params.position = 0.2;     // gate ≈ 7 V: hard on
            fx.parts.find(p => p.kind === 'ferrite_coil').params.couplingRatio = 0.04;
        });
        ms(b, 1.5);
        assert.equal(b._radio.error, null, `no refused band: ${b._radio.error}`);
        const a = swing(b);
        assert.ok(a > 1 && a < 30, `it oscillates, limited: ${a.toFixed(2)} V`);
    });

    it('a hand-wound air coil in an RF circuit is an RF winding: a metal detector\'s oscillators run near 96 kHz', () => {
        // Before, the air coil was a plain inductor in the time domain and a
        // Colpitts oscillator at ~100 kHz had to be run at 1.5 kHz instead.
        // Now its inductance (moved by metal, live) lives in the RF bands.
        const b = fixture('metal-detector-netlist.json');
        ms(b, 6);
        const r = b._radio;
        assert.ok(r._resonances.some(x => x.hz > 90e3 && x.hz < 102e3), `a resonance near 96 kHz: ${r._resonances.map(x => Math.round(x.hz))}`);
        assert.ok(swing(b) > 1, `oscillating: ${swing(b).toFixed(2)} V`);
        const coin = fixture('metal-detector-netlist.json', (fx) => { fx.parts.find(p => p.kind === 'air_coil').params.metalCm = 0; });
        ms(coin, 6);
        const f0 = Math.min(...r._resonances.map(x => x.hz)), f1 = Math.min(...coin._radio._resonances.map(x => x.hz));
        assert.ok(f1 > f0 * 1.015, `a coin on the coil raises the search oscillator's tank: ${Math.round(f0)} -> ${Math.round(f1)} Hz`);
    });
});


describe('radio bands: a short-wave regenerative receiver hears a Morse beacon (heterodyne)', () => {
    // Gap (2026-11-24): the short-wave regenerative receiver never heard its
    // beacon. Two engine faults stood behind it. (1) A transistor's input
    // capacitance was τF·Ic/VT at its DC current even when its own swing had
    // driven it into class C: tens of picofarads its junction does not
    // have, hung on the tank through the 100 pF grid capacitor, put the
    // oscillation 8 % below the tank (5.58 against 6.07 MHz), 480 kHz from
    // the beacon. The diffusion charge is τF times the collector current, so
    // the capacitance a swing sees is τF times the large-signal
    // transconductance. (2) The band exchanges its swing and the bias with
    // the transient solve once per substep; at substeps of 1–2 µs against
    // the envelope's ~5 µs time constant that exchange itself oscillated,
    // and the receiver's own amplitude jitter (tens of per cent, step to
    // step) was 50–200 mV of noise in the earphone, beacon or not.
    const fixture = (edit) => {
        const fx = JSON.parse(readFileSync(new URL('./fixtures/shortwave-regen-netlist.json', import.meta.url), 'utf8'));
        if (edit) edit(fx);
        const b = new BoardImpl(fx.vcc);
        b.setNetlist(fx.parts, fx.nets);
        b.setPower(true);
        const netOf = (part, term) => fx.nets.find(n => n.terminals.some(t => t.part === part && t.terminal === term)).id;
        return { b, fx, tank: netOf('tuning_cap_7', 'a'), ep: [netOf('earphone_14', 'a'), netOf('earphone_14', 'b')] };
    };
    const noBeacon = (fx) => { const a = fx.parts.find(p => p.kind === 'antenna'); a.params.stations = a.params.stations.filter(s => s.id !== 'cw'); };
    const record = (x, from, to, tr) => {
        for (let t = from + 0.02; t <= to + 1e-9; t += 0.02) {
            ms(x.b, t);
            tr.push([t, x.b.nodeVoltages.get(x.ep[0]) - x.b.nodeVoltages.get(x.ep[1])]);
        }
        return tr;
    };
    /** Strongest line of a trace (V, Hz) and its rms, mean removed. */
    const listen = (tr) => {
        const m = tr.reduce((a, p) => a + p[1], 0) / tr.length;
        const z = tr.map(([t, v]) => [t, v - m]);
        let best = [0, 0];
        for (let f = 200; f <= 8000; f += 25) {
            let re = 0, im = 0;
            for (const [t, v] of z) { re += v * Math.cos(2 * Math.PI * f * t / 1000); im += v * Math.sin(2 * Math.PI * f * t / 1000); }
            const a = 2 * Math.hypot(re, im) / z.length;
            if (a > best[1]) best = [f, a];
        }
        return { hz: best[0], line: best[1], rms: Math.sqrt(z.reduce((a, p) => a + p[1] * p[1], 0) / z.length) };
    };

    it('past its threshold it oscillates steadily at its tank\'s frequency, and quietly', () => {
        const x = fixture(noBeacon);
        x.b.setControl('potentiometer_10', 0.75);
        ms(x.b, 3);
        const w0 = x.b.transientAnalysisStatus().work.solves;
        let lo = Infinity, hi = 0;
        for (let k = 1; k <= 100; k++) { ms(x.b, 3 + k * 0.002); const a = tankAmp(x.b, x.tank); lo = Math.min(lo, a); hi = Math.max(hi, a); }
        // Measured: 5.38 V, steady to 1e-4 (before: 1.8–3.5 V step to step).
        assert.ok(lo > 3 && hi / lo < 1.01, `a steady swing: ${lo.toFixed(3)}–${hi.toFixed(3)} V`);
        // Its frequency: the band's centre plus the rotation of its envelope.
        const band = x.b._radio._bands.find(q => q.hz > 5e6 && q.hz < 7e6);
        const i = x.b._radio._sys.builder.nodeIndex.get(x.tank);
        const h = band.hist.filter(e => e.X);
        const rot = [];
        for (let k = 1; k < h.length; k++) {
            const a = h[k - 1].X, c = h[k].X;
            const d = DMath.atan2(c.im[i] * a.re[i] - c.re[i] * a.im[i], c.re[i] * a.re[i] + c.im[i] * a.im[i]);
            rot.push(d / (2 * Math.PI * (h[k].t - h[k - 1].t)));
        }
        rot.sort((p, q) => p - q);
        const f = band.hz + rot[rot.length >> 1];
        // The tank's resonance as the scan finds it with the stage's gain off
        // (6.07 MHz: 5 µH against 10 + 490·0.2506 pF is 6.18 MHz, the grid
        // capacitor and the antenna on the tap load it). Measured 6.0604 MHz,
        // 0.2 % below it; before, 5.58 MHz.
        const f0 = x.b._radio._resonances.find(r => r.hz > 5e6 && r.hz < 7e6).hz;
        close(f / f0, 1, 0.01, `oscillation ${(f / 1e6).toFixed(4)} MHz against the tank's ${(f0 / 1e6).toFixed(4)} MHz`);
        const tr = record(x, 3.2, 8, []);
        const s = listen(tr);
        assert.ok(s.rms < 1e-4, `no beacon, no sound: ${s.rms.toExponential(2)} V rms in the earphone (before: 0.05–0.2 V)`);
        const perMs = (x.b.transientAnalysisStatus().work.solves - w0) / 5;
        assert.ok(perMs < 3000, `oscillating, ${perMs} solves per simulated ms`);
    });

    it('a resonance scan sees the tank, not the swing the oscillation has at that instant', () => {
        // The scan looks for tanks with the transistors' gain off, but it
        // saw the junctions at the bands' present swing: a collector
        // swinging volts forward-biases its base–collector junction, and a
        // scan taken mid-burst moved the tank (a squegging short-wave stage
        // retuned while it squegged showed a peak at 4.5 MHz for its 6.1 MHz
        // tank, and its band went there). Now: the same resonance whether
        // the stage oscillates or is quiet when the tuning capacitor moves.
        const scanAfterRetune = (pot) => {
            const x = fixture(noBeacon);
            x.b.setControl('potentiometer_10', pot);
            ms(x.b, 2);
            x.b.setControl('tuning_cap_7', 0.2507);
            ms(x.b, 2.1);
            return { hz: x.b._radio._resonances.find(r => r.hz > 5e6 && r.hz < 7e6)?.hz, swing: tankAmp(x.b, x.tank) };
        };
        const osc = scanAfterRetune(0.75), quiet = scanAfterRetune(0.95);
        assert.ok(osc.swing > 3 && quiet.swing < 0.01, `oscillating ${osc.swing.toFixed(2)} V, quiet ${quiet.swing.toExponential(1)} V`);
        close(osc.hz / quiet.hz, 1, 1e-5, `the tank found while oscillating (${osc.hz}) and while quiet (${quiet.hz})`);
    });

    it('key down: the beat with the beacon whistles in the earphone; key up: silence', () => {
        // Below the threshold (pot 0.95) the beacon's bare carrier is
        // inaudible. Past it (0.75) the oscillation, 1.9 kHz from the beacon,
        // beats with it while the key is down (the first 60 ms); key up (and
        // its last beat rung out of the earphone), the oscillation alone makes
        // no sound.
        const x = fixture();
        const below = listen(record(x, 0, 12, []).filter(p => p[0] > 5));
        x.b.setControl('potentiometer_10', 0.75);
        ms(x.b, 18);
        const down = listen(record(x, 18, 40, []));
        ms(x.b, 70);
        const up = listen(record(x, 70, 86, []));
        // Measured: below 1e-5 V rms; key down 1850 Hz at 0.40 mV; key up
        // 1.2 µV rms. Before: no line, 0.05–0.6 V of the receiver's own noise.
        assert.ok(below.rms < 3e-5, `below the threshold, silent: ${below.rms.toExponential(2)} V rms`);
        close(down.hz, 1850, 300, 'the beat (Hz)');
        assert.ok(down.line > 1e-4, `key down, the beat: ${down.line.toExponential(2)} V`);
        assert.ok(up.rms < down.line / 30, `key up, silence: ${up.rms.toExponential(2)} V rms against ${down.line.toExponential(2)} V`);
        // Tuned a hair higher, the beat drops in pitch (the oscillation moves towards the beacon).
        const y = fixture((fx) => { fx.parts.find(p => p.kind === 'tuning_cap').params.position = 0.2507; });
        y.b.setControl('potentiometer_10', 0.75);
        ms(y.b, 18);
        const lower = listen(record(y, 18, 40, []));
        assert.ok(lower.hz < down.hz - 500 && lower.line > 1e-4, `retuned: ${down.hz} -> ${lower.hz} Hz`);
    });
});

describe('radio bands: band steps converge', () => {
    it('a super-regenerator\'s bursts reach the same peak at every band step', () => {
        // The adaptive band step overshot each burst's limiting by up to 40 %
        // (bursts 2.97–4.20 V where 1 ns steps give 3.00 V): the exchange
        // between the band's swing and the bias the transient solve sets
        // closed once per substep, and at the burst's top the substep was a
        // sizeable part of the envelope's time scale. It is now at most a
        // 32nd of max(2Q/ω, the bias currents' smoothing) while the swing
        // drives its junctions. Measured: 2.651–2.665 V over 25 bursts, 1 ns
        // steps 2.670–2.672 V (the level itself moved with the input
        // capacitance's large-signal value, see the short-wave receiver).
        const fx = JSON.parse(readFileSync(new URL('./fixtures/superregen-vhf-netlist.json', import.meta.url), 'utf8'));
        const ant = fx.parts.find(p => p.kind === 'antenna');
        if (ant) ant.params.stations = [];
        const b = new BoardImpl(fx.vcc);
        b.setNetlist(fx.parts, fx.nets);
        b.setPower(true);
        ms(b, 3);
        const peaks = [];
        let cur = 0;
        for (let k = 1; k <= 1000; k++) {
            ms(b, 3 + k * 0.001);
            cur = Math.max(cur, ...b._radio._bands.map(x => Math.max(...x.portVoltages().map(p => Math.hypot(p[0], p[1])))));
            if (k % 40 === 0) { peaks.push(cur); cur = 0; }
        }
        const lo = Math.min(...peaks), hi = Math.max(...peaks);
        assert.ok(hi / lo < 1.03, `burst peaks ${lo.toFixed(3)}–${hi.toFixed(3)} V`);
        close((lo + hi) / 2, 2.67, 0.05, 'burst peak against 1 ns steps (V)');
    });
});

describe('radio bands: a MOSFET regenerative receiver past its threshold', () => {
    const fixture = (edit) => {
        const fx = JSON.parse(readFileSync(new URL('./fixtures/mosfet-regen-netlist.json', import.meta.url), 'utf8'));
        if (edit) edit(fx);
        const b = new BoardImpl(fx.vcc);
        b.setNetlist(fx.parts, fx.nets);
        b.setPower(true);
        const netOf = (part, term) => fx.nets.find(n => n.terminals.some(t => t.part === part && t.terminal === term)).id;
        return { b, ep: [netOf('earphone_14', 'a'), netOf('earphone_14', 'b')] };
    };
    const lineAt = (x, from, to) => {
        const tr = [];
        for (let t = from + 0.02; t <= to + 1e-9; t += 0.02) { ms(x.b, t); tr.push([t, x.b.nodeVoltages.get(x.ep[0]) - x.b.nodeVoltages.get(x.ep[1])]); }
        const m = tr.reduce((a, p) => a + p[1], 0) / tr.length;
        const amp = (f) => {
            let re = 0, im = 0;
            for (const [t, v] of tr) { re += (v - m) * Math.cos(2 * Math.PI * f * t / 1000); im += (v - m) * Math.sin(2 * Math.PI * f * t / 1000); }
            return 2 * Math.hypot(re, im) / tr.length;
        };
        let best = [0, 0];
        for (let f = 200; f <= 8000; f += 25) { const a = amp(f); if (a > best[1]) best = [f, a]; }
        return { hz: best[0], line: best[1], programme: amp(400) };
    };

    it('just past the threshold it whistles against the station; without the station, no whistle', () => {
        // Pot 0.75: the gate a little further on than where the 400 Hz
        // programme is detected (0.77). The square-law stage starts
        // oscillating with the station's carrier in its tank, ~6 kHz from it,
        // and the beat whistles. Measured: 6000 Hz at 56 mV against the
        // programme's 4.6 mV; with no station on the air the tank stays at
        // the noise floor and the earphone is quiet.
        const x = fixture();
        x.b.setControl('potentiometer_10', 0.75);
        ms(x.b, 15);
        const w = lineAt(x, 15, 21);
        close(w.hz, 6000, 500, 'the whistle (Hz)');
        assert.ok(w.line > 5 * w.programme && w.line > 0.01, `the whistle ${w.line.toExponential(2)} V over the programme ${w.programme.toExponential(2)} V`);
        const y = fixture((fx) => { for (const p of fx.parts) if (p.kind === 'antenna') p.params.stations = []; });
        y.b.setBroadcast([]);
        y.b.setControl('potentiometer_10', 0.75);
        ms(y.b, 15);
        const q = lineAt(y, 15, 21);
        assert.ok(q.line < w.line / 20, `no station, no whistle: ${q.line.toExponential(2)} V at ${q.hz} Hz`);
    });

    it('oscillating hard, it costs a few thousand steps per simulated millisecond', () => {
        // Pot 0.72: oscillating at volts, its own rectified current runs the
        // drain down to the source. The band's transconductance was cut off
        // outright below 50 mV of drain while the rectified current faded
        // smoothly (tanh(vds/0.2)); the stage sat on that switch and the
        // transient solve chattered across it: 13 000–20 000 solves (7–10 s)
        // per simulated ms. Both now fade by the same law. Measured: ~4 000.
        const x = fixture();
        x.b.setControl('potentiometer_10', 0.72);
        ms(x.b, 1.5);
        const w0 = x.b.transientAnalysisStatus().work.solves;
        ms(x.b, 2.5);
        const perMs = x.b.transientAnalysisStatus().work.solves - w0;
        assert.equal(x.b._radio.error, null);
        assert.ok(Math.max(0, ...x.b._radio._bands.map(q => Math.max(...q.portVoltages().map(p => Math.hypot(p[0], p[1]))))) > 1, 'oscillating');
        assert.ok(perMs < 7000, `${perMs} solves per simulated ms`);
    });
});

describe('radio bands: a VHF Colpitts oscillator holds its swing', () => {
    // A BF199 in common base: tank 0.15 µH ‖ 8 pF from the collector to 9 V
    // (~120 MHz), 6.8 pF collector→emitter, 6.8 pF emitter→ground, 1 kΩ
    // emitter resistor, base on 10 kΩ / 10 kΩ held by 1 nF.
    const colpitts = () => {
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
            P('Q1', 'npn', { part: 'BF199' }, ['base', 'collector', 'emitter']), P('L', 'vhf_coil', {}, ['a', 'b']), P('C2', 'capacitor', { farads: 8e-12 }, ['a', 'b']),
            P('CF', 'capacitor', { farads: 6.8e-12 }, ['a', 'b']), P('CE', 'capacitor', { farads: 6.8e-12 }, ['a', 'b']), P('RE', 'resistor', { ohms: 1000 }, ['a', 'b']),
            P('R1', 'resistor', { ohms: 10e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']), P('CB', 'capacitor', { farads: 1e-9 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['VS', 'neg'], ['CE', 'b'], ['RE', 'b'], ['R2', 'b'], ['CB', 'b']),
            net('v', ['VS', 'pos'], ['L', 'a'], ['C2', 'a'], ['R1', 'a']), net('c', ['Q1', 'collector'], ['L', 'b'], ['C2', 'b'], ['CF', 'a']),
            net('e', ['Q1', 'emitter'], ['CF', 'b'], ['CE', 'a'], ['RE', 'a']), net('bb', ['Q1', 'base'], ['R1', 'b'], ['R2', 'a'], ['CB', 'a'])]);
        b.setBroadcast([]);
        b.setPower(true);
        return b;
    };
    const us = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e3)));

    it('limits smoothly where its collector swings into the base–collector junction, at a few thousand substeps per simulated ms', () => {
        // Gap (2026-11-25): the band stepped with the junctions' describing
        // functions taken at the swing each substep started from. Its
        // collector limits where the swing forward-biases the base–collector
        // junction, whose conductance grows as e^{A/VT}: a substep that
        // ended a few tens of millivolts past that edge carried a conductance
        // ~e^{30} too small, the next one a conductance its own end did not
        // have, and the swing fell by volts within one substep (5.9 → 2.9 V,
        // against the tank's ~0.1 µs envelope time constant), then grew back
        // over ~30 substeps of 1–8 ns: ~860 000 substeps per simulated ms,
        // ~40 s of wall time per ms. The junction stamps are now made
        // consistent with the step's end (BandIntegrator.step). MEASURED: a
        // steady 8.29 V, ~7 800 substeps per ms.
        const b = colpitts();
        for (let t = 10; t <= 100; t += 10) us(b, t);
        const s0 = b._radio.substeps;
        let lo = Infinity, hi = 0, worst = 0, prev = null;
        for (let k = 1; k <= 400; k++) {
            us(b, 100 + k * 0.25);
            const a = tankAmp(b, 'c');
            lo = Math.min(lo, a); hi = Math.max(hi, a);
            if (prev !== null) worst = Math.max(worst, Math.abs(a / prev - 1));
            prev = a;
        }
        assert.equal(b.transientAnalysisStatus().failure, null);
        assert.equal(b._radio.error, null);
        const f0 = b.radioReport().bands[0].hz;
        assert.ok(f0 > 100e6 && f0 < 140e6, `oscillating near the tank: ${(f0 / 1e6).toFixed(2)} MHz`);
        assert.ok(lo > 5, `the collector swings volts: ${lo.toFixed(3)} V`);
        assert.ok(hi / lo < 1.02, `a steady swing, ${lo.toFixed(3)}–${hi.toFixed(3)} V`);
        assert.ok(worst < 0.005, `no jumps between 0.25 µs samples: worst ${(worst * 100).toFixed(2)} %`);
        const perMs = (b._radio.substeps - s0) / 0.1;
        assert.ok(perMs < 20000, `${perMs} band substeps per simulated ms`);
    });
});
