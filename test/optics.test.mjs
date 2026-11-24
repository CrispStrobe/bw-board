// Optical links (src/optics.js): light from a placed emitter to a placed
// receiver along a `light_path` part with learner-controlled geometry.
//
// Gap (2026-11-23, round 4): a phototransistor saw only a scalar light
// control and an LED's light went nowhere, so a light guide, an optical bench,
// a lens, a coloured surface or a prism could not be built. Here the receiver's
// light follows the emitter's SIMULATED current through the path.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import {
  emitterCard, emitterPower, lambertOrder, discOverlap, prismDeviation, refractiveIndex,
  pathTransfer, receiverCard,
} from '../src/optics.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const rel = (a, e, tol, what) => assert.ok(Math.abs(a / e - 1) < tol, `${what}: ${a} vs ${e}`);

/**
 * 9 V -> Rs -> emitter; phototransistor with RL to 9 V. Optional extra
 * parts/nets, emitter kind/params, receiver params, light path params.
 */
function link(path, { em = { kind: 'led', params: { color: 'red' } }, rs = 330, rl = 1000, rx = {},
  extraParts = [], extraNets = [], drive = null } = {}) {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    ...(drive ? [{ id: 'VM', kind: 'vsource', params: drive, terminals: ['pos', 'neg'] }] : []),
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RS', kind: 'resistor', params: { ohms: rs }, terminals: ['a', 'b'] },
    { id: 'D', ...em, terminals: ['anode', 'cathode'] },
    { id: 'Q', kind: 'phototransistor', params: rx, terminals: ['collector', 'emitter'] },
    { id: 'RL', kind: 'resistor', params: { ohms: rl }, terminals: ['a', 'b'] },
    ...(path ? [{ id: 'P', kind: 'light_path', params: { from: 'D', to: 'Q', ...path }, terminals: [] }] : []),
    ...extraParts,
  ], [
    net('v', ['VS', 'pos'], ['RL', 'a'], ...(drive ? [] : [['RS', 'a']])),
    ...(drive ? [net('m', ['VM', 'pos'], ['RS', 'a'])] : []),
    net('g', ['G', 'gnd'], ['VS', 'neg'], ['D', 'cathode'], ['Q', 'emitter'], ...(drive ? [['VM', 'neg']] : [])),
    net('a', ['RS', 'b'], ['D', 'anode']),
    net('c', ['RL', 'b'], ['Q', 'collector']),
    ...extraNets,
  ]);
  b.setPower(true);
  return b;
}
const light = (b) => b.opticalReport().receivers.Q.light;
const settle = (b, ms = 2) => { b.advanceTo(BigInt(ms * 1e6)); return b; };

describe('optical links: building blocks', () => {
  it('lambert order: cos^m halves at the half angle', () => {
    const m = lambertOrder(15);
    rel(Math.pow(Math.cos(15 * Math.PI / 180), m), 0.5, 1e-9, 'cos^m(15°)');
  });
  it('an LED emits eta x I, falling with temperature; a laser only above threshold', () => {
    const red = emitterCard({ kind: 'led', params: { color: 'red' } });
    rel(emitterPower(red, 0.02), 0.8, 1e-9, 'red 20 mA mW');
    assert.ok(emitterPower(red, 0.02, 75) < 0.6 * emitterPower(red, 0.02), 'red LED loses half its light at +50 K');
    const laser = emitterCard({ kind: 'laser_diode', params: {} });
    assert.equal(emitterPower(laser, 0.015), 0, 'below threshold');
    rel(emitterPower(laser, 0.03), 5, 1e-9, '10 mA above threshold x 0.5 W/A');
  });
  it('disc overlap: full, none, half-ish', () => {
    rel(discOverlap(1, 1, 0), Math.PI, 1e-12, 'coincident');
    assert.equal(discOverlap(1, 1, 2.5), 0);
    rel(discOverlap(1, 1, 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2, 1e-9, 'lens of two unit discs one radius apart');
  });
  it('dispersion: blue is bent more than red', () => {
    const red = prismDeviation(refractiveIndex('acrylic', 650));
    const blue = prismDeviation(refractiveIndex('acrylic', 455));
    assert.ok(blue > red + 0.6, `blue ${blue} vs red ${red}`);
  });
});

describe('optical links on the board', () => {
  it('a circuit without a light_path builds no optics and no hidden element', () => {
    const b = settle(link(null));
    assert.equal(b.opticalReport(), null);
    assert.ok(!b._solveParts.some(p => p.kind === 'optical_rx'));
    rel(b.nodeVoltage('c'), 9, 1e-3, 'dark receiver');
  });

  it('inverse square: twice the distance, a quarter of the light', () => {
    const at = (d) => light(settle(link({ medium: 'air', distanceCm: d })));
    rel(at(10) / at(20), 4, 0.02, '10 cm vs 20 cm');
    rel(at(20) / at(40), 4, 0.01, '20 cm vs 40 cm');
  });

  it('emission angle: half the light at the half angle, little at 3x it', () => {
    const at = (deg) => light(settle(link({ medium: 'air', distanceCm: 10, angleDeg: deg })));
    rel(at(15) / at(0), 0.5, 1e-6, '15° of a 15° LED');
    assert.ok(at(45) / at(0) < 0.01);
  });

  it('the light follows the emitter current: a smaller series resistor, more light', () => {
    const a = settle(link({ medium: 'air', distanceCm: 10 }, { rs: 680 }));
    const b = settle(link({ medium: 'air', distanceCm: 10 }, { rs: 330 }));
    const ratio = b.opticalReport().emitters.D / a.opticalReport().emitters.D;
    rel(light(b) / light(a), ratio, 1e-6, 'light tracks emitted power');
    assert.ok(ratio > 1.8, `ratio ${ratio}`);
    // and the phototransistor carries it: VC drop = light x 5 mA x RL
    rel(9 - b.nodeVoltage('c'), light(b) * 0.005 * 1000, 0.01, 'collector drop');
  });

  it('the knob moves the path geometry; getControls lists it', () => {
    const b = settle(link({ medium: 'air', distanceCm: 4, knob: 'distanceCm', knobMin: 2, knobMax: 20 }));
    const ctl = b.getControls().find(c => c.id === 'P');
    rel(ctl.value, (4 - 2) / 18, 1e-9, 'rest position');
    const v4 = b.nodeVoltage('c');
    b.setControl('P', 1);
    assert.ok(b.nodeVoltage('c') > v4 + 0.5, 'farther: less light, collector rises');
  });

  it('a blocked path passes nothing; a shielded receiver loses the room light', () => {
    const b = settle(link({ medium: 'air', distanceCm: 3, blocked: 1 }));
    assert.equal(light(b), 0);
    const s = settle(link({ medium: 'air', distanceCm: 50, shield: 0.9 }, { rx: { light: 0.5 } }));
    const o = settle(link({ medium: 'air', distanceCm: 50 }, { rx: { light: 0.5 } }));
    assert.ok(9 - s.nodeVoltage('c') < 0.2 * (9 - o.nodeVoltage('c')), 'shield cuts ambient');
  });

  it('a modulated LED sends its tone through the air; a blocked beam silences it', () => {
    const swing = (path) => {
      const b = link(path, { drive: { wave: 'sine', freq: 1000, amplitude: 1, offset: 3 }, rs: 100, rl: 1000 });
      b.advanceTo(3_000_000n);
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i <= 40; i++) {
        b.advanceTo(3_000_000n + BigInt(i * 50_000));
        const v = b.nodeVoltage('c'); lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    assert.ok(swing({ medium: 'air', distanceCm: 2.5 }) > 0.8, 'tone at the receiver');
    assert.ok(swing({ medium: 'air', distanceCm: 2.5, blocked: 1 }) < 1e-3, 'blocked');
  });

  it('a 100 kHz square wave crosses the fibre edge for edge', () => {
    const b = link({ medium: 'fibre', lengthM: 1, outGapMm: 1 },
      { drive: { wave: 'square', freq: 100000, amplitude: 5, offset: 0 }, rs: 150, rl: 1000 });
    b.advanceTo(50_000n);
    const vs = [];
    for (let i = 1; i <= 40; i++) { b.advanceTo(50_000n + BigInt(i * 500)); vs.push(b.nodeVoltage('c')); }
    const hi = vs.filter(v => v > 7).length, lo = vs.filter(v => v < 3.5).length;
    assert.ok(hi >= 10 && lo >= 10, `collector toggles: ${vs.map(v => v.toFixed(1)).join(' ')}`);
  });
});

describe('step control at optical edges', () => {
  it('a 555 flashing an LED at 100 kHz: the receiver\'s light switches in the emitter\'s seed step', () => {
    // Before 2026-11-24 the receiver saw the new light only at the NEXT
    // accepted step, the trapezoidal rule took that jump as error, and the
    // controller halved its way down to ~10 ps on every edge: 993 attempts
    // for this 0.1 ms, against 703 now.
    const b = new BoardImpl(9);
    b.setNetlist([
      { id: 'VS', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U', kind: 'timer_555', params: {}, terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 6800 }, terminals: ['a', 'b'] },
      { id: 'CT', kind: 'capacitor', params: { farads: 1e-9 }, terminals: ['a', 'b'] },
      { id: 'RS', kind: 'resistor', params: { ohms: 150 }, terminals: ['a', 'b'] },
      { id: 'D', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'Q', kind: 'phototransistor', params: {}, terminals: ['collector', 'emitter'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'CP', kind: 'capacitor', params: { farads: 100e-12 }, terminals: ['a', 'b'] },
      { id: 'RP', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'P', kind: 'light_path', params: { from: 'D', to: 'Q', medium: 'fibre', lengthM: 1, outGapMm: 1 }, terminals: [] },
    ], [
      net('v', ['VS', 'pos'], ['RL', 'a'], ['U', 'vcc'], ['U', 'reset'], ['R1', 'a']),
      net('m', ['U', 'output'], ['RS', 'a']), net('d', ['R1', 'b'], ['U', 'discharge'], ['R2', 'a']),
      net('t', ['R2', 'b'], ['U', 'threshold'], ['U', 'trigger'], ['CT', 'a']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['U', 'gnd'], ['CT', 'b'], ['D', 'cathode'], ['Q', 'emitter'], ['RP', 'b']),
      net('a', ['RS', 'b'], ['D', 'anode']), net('c', ['RL', 'b'], ['Q', 'collector'], ['CP', 'a']), net('p', ['CP', 'b'], ['RP', 'a']),
    ]);
    b.setPower(true);
    b.advanceTo(100_000n);
    assert.equal(b.transientAnalysisStatus().failure, null);
    const { attempts } = b._transientAnalysisWork;
    assert.ok(attempts < 850, `attempts ${attempts}`);
  });
});

describe('fibre losses', () => {
  const fib = (p, color = 'red') => light(settle(link({ medium: 'fibre', lengthM: 1, outGapMm: 1, ...p },
    { em: { kind: 'led', params: { color } } })));
  it('a tight bend, a rough cut, a gap, an offset and an angle each cost light', () => {
    const straight = fib({});
    assert.ok(fib({ bendRadiusCm: 5 }) > 0.9 * straight);
    rel(fib({ bendRadiusCm: 1 }) / straight, 0.8, 0.01, '1 cm bend: 20 % lost');
    assert.ok(fib({ bendRadiusCm: 0.5 }) < fib({ bendRadiusCm: 1 }));
    assert.ok(fib({ cutQuality: 0 }) < 0.5 * straight, 'rough cut');
    const j0 = fib({ jointGapMm: 0 });
    assert.ok(fib({ jointGapMm: 1 }) < 0.5 * j0, 'joint gap');
    assert.ok(fib({ jointOffsetMm: 0.5 }) < 0.7 * j0, 'joint offset');
    assert.ok(fib({ jointAngleDeg: 20 }) < 0.85 * j0, 'joint angle');
    assert.ok(fib({ outGapMm: 10 }) < 0.1 * straight, 'receiver far from the fibre end');
  });
  it('a lens focuses a distant LED into the fibre: most light where the face sits at the image', () => {
    const em = emitterCard({ kind: 'led', params: { color: 'red' } });
    const rx = receiverCard({ kind: 'phototransistor' });
    const g = (P) => pathTransfer({ medium: 'fibre', lengthM: 1, outGapMm: 1, ...P }, em, rx).gain(640);
    // f = 2 cm, LED 6 cm in front: image 3 cm behind the lens, 9 cm from the LED.
    const lens = { lensFocalCm: 2, lensAtCm: 6, lensRadiusCm: 1.5 };
    let best = 0, bestAt = 0;
    for (let at = 7; at <= 14.001; at += 0.25) { const v = g({ ...lens, fibreAtCm: at }); if (v > best) { best = v; bestAt = at; } }
    assert.equal(bestAt, 9);
    // The same 9 cm without the lens: a hundred times less.
    assert.ok(best > 100 * g({ inGapMm: 90 }), `lens ${best} vs bare ${g({ inGapMm: 90 })}`);
    // A fast lens (R/v beyond the fibre's NA) wastes the outer cone.
    const fast = g({ lensFocalCm: 1, lensAtCm: 1.5, lensRadiusCm: 1.5, fibreAtCm: 4.5 });
    const slow = g({ lensFocalCm: 1, lensAtCm: 1.5, lensRadiusCm: 0.75, fibreAtCm: 4.5 });
    assert.ok(fast < 1.6 * slow, `twice the aperture, not four times the light: ${fast} vs ${slow}`);
  });

  it('plastic fibre: infrared fades with length far faster than red', () => {
    const red = fib({ lengthM: 4 }, 'red') / fib({ lengthM: 0.5 }, 'red');
    const ir = fib({ lengthM: 4 }, 'ir') / fib({ lengthM: 0.5 }, 'ir');
    assert.ok(red > 0.8 && ir < 0.1, `red ${red}, ir ${ir}`);
  });
});

describe('lens, surface, prism, liquid, string', () => {
  it('a lens: the light peaks where 1/f = 1/u + 1/v puts the image', () => {
    // f = 10 cm, LED at u = 15 cm -> image at v = 30 cm -> receiver at 45 cm
    let best = 0, bestD = 0;
    for (let d = 25; d <= 70; d += 1) {
      const tr = pathTransfer({ medium: 'air', distanceCm: d, lensFocalCm: 10, lensAtCm: 15 },
        emitterCard({ kind: 'led', params: { color: 'red' } }), receiverCard({ kind: 'phototransistor' }));
      const g = tr.gain(640);
      if (g > best) { best = g; bestD = d; }
    }
    assert.equal(bestD, 45);
  });

  it('red light tells a red surface from a green one; infrared cannot', () => {
    const on = (surface, color) => light(settle(link({ medium: 'reflect', distanceCm: 1, surface },
      { em: { kind: 'led', params: { color } } })));
    assert.ok(on('red', 'red') > 5 * on('green', 'red'), 'red LED');
    rel(on('red', 'ir') / on('green', 'ir'), 1, 0.1, 'IR LED sees both alike');
  });

  it('a prism: the slit angle picks a colour out of a white LED', () => {
    const at = (slit, color) => light(settle(link({ medium: 'prism', slitAngleDeg: slit },
      { em: { kind: 'led', params: { color } } })));
    const devBlue = prismDeviation(refractiveIndex('acrylic', 455));
    const devYellow = prismDeviation(refractiveIndex('acrylic', 565));
    assert.ok(at(devBlue, 'white') > 5 * at(devBlue, 'red'), 'blue slit: white has blue, red has none');
    assert.ok(at(devYellow, 'white') > 3 * at(devBlue + 0.5, 'white'), 'between the lines it is dark');
  });

  it('a laser keeps its light over distance where an LED fades', () => {
    const laser = { kind: 'laser_diode', params: {} };
    const L = (d) => light(settle(link({ medium: 'air', distanceCm: d }, { em: laser, rs: 150 })));
    const E = (d) => light(settle(link({ medium: 'air', distanceCm: d })));
    assert.ok(L(100) / L(10) > 0.5, 'laser over 10x the distance');
    assert.ok(E(100) / E(10) < 0.02, 'LED over 10x the distance');
  });

  it('a full glass bends the beam away from the receiver', () => {
    const at = (level) => light(settle(link({ medium: 'liquid', level, distanceCm: 15 })));
    assert.ok(at(1) < 0.3 * at(0), `empty ${at(0)}, full ${at(1)}`);
  });

  it('a plucked string modulates the light at its pitch', () => {
    const b = link({ medium: 'string', distanceCm: 2, stringHz: 200, decayS: 5, pluckPeriodS: 0 },
      { extraParts: [{ id: 'CX', kind: 'capacitor', params: { farads: 1e-8 }, terminals: ['a', 'b'] }],
        extraNets: [] });
    b.advanceTo(1_000_000n);
    let crossings = 0, prev = null;
    const vs = [];
    for (let i = 1; i <= 200; i++) { b.advanceTo(1_000_000n + BigInt(i * 100_000)); vs.push(b.nodeVoltage('c')); }
    const mid = (Math.max(...vs) + Math.min(...vs)) / 2;
    for (const v of vs) { const s = v > mid; if (prev !== null && s !== prev) crossings++; prev = s; }
    // 20 ms at 200 Hz: 4 cycles, 8 crossings
    assert.ok(crossings >= 7 && crossings <= 9, `crossings ${crossings}`);
    assert.ok(Math.max(...vs) - Math.min(...vs) > 0.3);
  });
});

describe('temperature', () => {
  const heater = (target) => ({
    parts: [
      { id: 'VH', kind: 'vsource', params: { volts: 10 }, terminals: ['pos', 'neg'] },
      { id: 'RH', kind: 'resistor', params: { ohms: 100, rth: 100, thermalTau: 0.5 }, terminals: ['a', 'b'] },
    ],
    nets: [net('h', ['VH', 'pos'], ['RH', 'a']), net('hg', ['VH', 'neg'], ['RH', 'b'])],
    target,
  });
  it('a warmed LED gives less light; a warmed phototransistor is more sensitive', () => {
    const h = heater();
    const run = (em, rx) => {
      const b = link({ medium: 'air', distanceCm: 5 }, { em, rx, extraParts: h.parts, extraNets: h.nets, rl: 470 });
      b.advanceTo(5_000_000_000n);
      return b;
    };
    const cold = run({ kind: 'led', params: { color: 'red' } }, {});
    const hotLed = run({ kind: 'led', params: { color: 'red', heatedBy: 'RH', thermalCoupling: 1 } }, {});
    const hotRx = run({ kind: 'led', params: { color: 'red' } }, { heatedBy: 'RH', thermalCoupling: 1 });
    const T = hotLed.partTemperature('D');
    assert.ok(T > 55, `LED at ${T} °C`);
    assert.ok(hotLed.opticalReport().emitters.D < 0.75 * cold.opticalReport().emitters.D, 'LED output falls');
    assert.ok(light(hotRx) > 1.15 * light(cold), 'phototransistor gains');
  });
});

describe('path ends', () => {
  it('a path without from/to links the only emitter to the only receiver', () => {
    const b = new BoardImpl(9);
    b.setNetlist([
      { id: 'VS', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RS', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
      { id: 'D', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'Q', kind: 'phototransistor', params: {}, terminals: ['collector', 'emitter'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'P', kind: 'light_path', params: { medium: 'air', distanceCm: 3 }, terminals: [] },
    ], [
      net('v', ['VS', 'pos'], ['RL', 'a'], ['RS', 'a']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['D', 'cathode'], ['Q', 'emitter']),
      net('a', ['RS', 'b'], ['D', 'anode']),
      net('c', ['RL', 'b'], ['Q', 'collector']),
    ]);
    b.setPower(true);
    assert.ok(b.opticalReport().receivers.Q.light > 0.1);
  });
});
