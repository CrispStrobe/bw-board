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
function meissner({ sense = 1, re = 1000, pos = 0.3, cbias = 10e-9, ce = 1e-9, ratio = 0.05 } = {}) {
    const b = new BoardImpl(9);
    const [cb, cbOther] = sense > 0 ? ['c1', 'c2'] : ['c2', 'c1'];
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('L1', 'ferrite_coil', { rodHeightM: 0, couplingRatio: ratio }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TC', 'tuning_cap', { position: pos }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
        P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']),
        P('CB', 'capacitor', { farads: cbias }, ['a', 'b']), P('RE', 'resistor', { ohms: re }, ['a', 'b']),
        P('CE', 'capacitor', { farads: ce }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['RE', 'b'], ['CE', 'b']),
        net('v', ['VS', 'pos'], ['L1', 'a'], ['TC', 'a'], ['R1', 'a']),
        net('col', ['Q1', 'collector'], ['L1', 'b'], ['TC', 'b']),
        net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['L1', cbOther]),
        net('base', ['Q1', 'base'], ['L1', cb]), net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a'])]);
    b.setBroadcast([]);
    b.setPower(true);
    return b;
}

describe('radio bands: oscillation', () => {
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
