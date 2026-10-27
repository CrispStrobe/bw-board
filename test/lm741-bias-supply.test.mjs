// SPDX-License-Identifier: MIT
// Opt-in nominal 25 C LM741 bias/supply domain. Expectations below are
// independent closed-form equations written from the TI SNOSC25D TYPICAL
// values (Ib 80 nA, Ios 20 nA, Is 1.7 mA at 25 C, +/-15 V); they are not
// copied from solver output and are not guaranteed device limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LM741_NOMINAL_25C, lm741LinearParameters, lm741BiasSupply,
    expandLm741LinearPoles} from '../src/lm741-linear-pole.js';
import {registerAnalogAmps} from '../src/devices/analog-amps.js';
import {BoardImpl} from '../src/board.js';

const IB = 80e-9, IOS = 20e-9, IQ = 1.7e-3, VS = 15, A0 = 200000, ROUT = 600;
const RS = 100000;
const terminals = ['offset_1','inn','inp','vneg','offset_5','out','vpos','nc'];

function fixture({vin, rl, sign, domain = true}) {
    const net = (id,...pins) => ({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
    const params = {transientModel:'linear-pole',inputOffsetV:0,supplyPositiveV:VS,supplyNegativeV:-VS,
        ...(domain ? {biasSupplyDomain:'ti-snosc25d-typical-25c',inputOffsetCurrentSign:sign} : {})};
    const parts = [
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'VP',kind:'vsource',params:{volts:VS},terminals:['pos','neg']},
        {id:'VN',kind:'vsource',params:{volts:VS},terminals:['pos','neg']},
        {id:'VIN',kind:'vsource',params:{volts:vin},terminals:['pos','neg']},
        {id:'RS',kind:'resistor',params:{ohms:RS},terminals:['a','b']},
        {id:'U',kind:'lm741',params,terminals},
    ];
    const zero = [['G','gnd'],['VP','neg'],['VN','pos'],['VIN','neg']];
    const out = [['U','out'],['U','inn']];
    if (rl) { parts.push({id:'RL',kind:'resistor',params:{ohms:rl},terminals:['a','b']}); zero.push(['RL','b']); out.push(['RL','a']); }
    return {parts, nets:[net('zero',...zero),net('positive',['VP','pos'],['U','vpos']),
        net('negative',['VN','neg'],['U','vneg']),net('src',['VIN','pos'],['RS','a']),
        net('input',['RS','b'],['U','inp']),net('out',...out)]};
}
function board(f) {
    registerAnalogAmps();
    const b = new BoardImpl(5); b.configureTransientAnalysis('precision-v1'); b.setNetlist(f.parts,f.nets); return b;
}
const RD = 2e6; // nominal card differential input resistance
/** Independent nominal DC follower equations (exact two-node solve). */
function expected({vin, rl, sign}) {
    const ibp = IB + sign*IOS/2, ibn = IB - sign*IOS/2;
    const g = rl ? 1/rl : 0, G = g + 1/ROUT;
    // d = vinp - out; KCL at inp through RS and at the output/pole buffer.
    const d = ((vin - RS*ibp)*G + ibn)/(A0/ROUT + 1/RD + (1 + RS/RD)*G);
    const out = vin - d - RS*ibp - RS*d/RD, vinp = out + d;
    const iout = out*g + ibn - d/RD;                  // out of package output lead
    const vposIn = IQ + Math.max(iout, 0);
    const vnegOut = IQ + ibp + ibn + Math.max(-iout, 0);
    return {ibp, ibn, vinp, out, iout, vposIn, vnegOut, railPowerW: VS*vposIn + VS*vnegOut};
}
const near = (actual, want, tol, what) => assert.ok(Math.abs(actual-want) <= tol,
    `${what}: ${actual} vs ${want} (tol ${tol})`);

const CASES = [];
for (const sign of [1, -1]) for (const rl of [0, 1000]) for (const vin of [.05, -.05]) CASES.push({sign, rl, vin});

test('card cites TI typical 25 C values and stays frozen', () => {
    assert.deepEqual({...LM741_NOMINAL_25C}, {domain:'ti-snosc25d-typical-25c',temperatureC:25,supplyV:15,
        inputBiasA:80e-9,inputOffsetA:20e-9,supplyCurrentA:1.7e-3,valueKind:'typical'});
    assert.ok(Object.isFrozen(LM741_NOMINAL_25C));
    assert.notEqual(LM741_NOMINAL_25C.supplyCurrentA, 2.8e-3, '2.8 mA warning budget is not the law');
});

for (const c of CASES) {
    test(`nominal follower sign ${c.sign} load ${c.rl || 'none'} vin ${c.vin}: equations, KCL, rails, energy`, () => {
        const e = expected(c), b = board(fixture(c));
        b.advanceTo(20000n);
        near(b.nodeVoltage('input'), e.vinp, 1e-9, 'inp shifted by bias through RS');
        near(b.nodeVoltage('out'), e.out, 1e-9, 'output');
        const I = t => b.branchCurrent('U', t);      // out of package
        near(I('out'), e.iout, 1e-11, 'output lead');
        near(-I('inp'), e.ibp, 1e-11, 'bias into inp');
        near(-I('inn'), e.ibn, 1e-11, 'bias into inn');
        near(-I('vpos'), e.vposIn, 1e-11, 'V+ lead');
        near(I('vneg'), e.vnegOut, 1e-11, 'V- lead');
        const kcl = terminals.reduce((sum, t) => sum + (Number.isFinite(I(t)) ? I(t) : 0), 0);
        near(kcl, 0, 1e-12, 'package terminal KCL');
        // Rail sources see exactly the package rail currents (no ground leak).
        near(b.branchCurrent('VP','pos'), e.vposIn, 1e-11, 'VP rail return');
        near(-b.branchCurrent('VN','neg'), e.vnegOut, 1e-11, 'VN rail return');
        const railPower = () => VS*b.branchCurrent('VP','pos') + VS*(-b.branchCurrent('VN','neg'));
        near(railPower(), e.railPowerW, 1e-9, 'rail power');
        // Package power balance: rails + inputs in, load out.
        const into = terminals.reduce((sum, t) => {
            const i = I(t); return Number.isFinite(i) ? sum - b.nodeVoltage(netOf(t))*i : sum;
        }, 0);
        near(into, e.railPowerW + e.vinp*e.ibp + e.out*e.ibn - e.out*e.iout, 1e-9, 'package power');
        // Trapezoidal rail energy over a steady 10 us window.
        let energy = 0, last = railPower(), t0 = 20000n;
        for (let t = t0 + 1000n; t <= 30000n; t += 1000n) {
            b.advanceTo(t); const p = railPower(); energy += (last + p)/2*1e-6; last = p;
        }
        near(energy, e.railPowerW*10e-6, 1e-14, 'rail energy');
    });
}
function netOf(t) {
    return {inp:'input',inn:'out',out:'out',vpos:'positive',vneg:'negative'}[t] ?? 'zero';
}

test('both offset-current polarities differ by exactly Ios and keep average Ib', () => {
    const p = s => lm741BiasSupply(fixture({vin:0,rl:0,sign:s}).parts.find(x => x.id === 'U'));
    const a = p(1), b = p(-1);
    near(a.inpA - a.innA, IOS, 1e-20, '+ sign'); near(b.innA - b.inpA, IOS, 1e-20, '- sign');
    near((a.inpA + a.innA)/2, IB, 1e-20, 'avg'); near((b.inpA + b.innA)/2, IB, 1e-20, 'avg');
});

test('refusal negatives keep unsupported domains unavailable', () => {
    const u = edit => { const f = fixture({vin:0,rl:1000,sign:1}); edit(f.parts.find(p => p.id === 'U').params, f); return f; };
    for (const [edit, re] of [
        [p => { p.biasSupplyDomain = 'ti-snosc25d-typical-70c'; }, /unsupported bias\/supply domain/],
        [p => { delete p.inputOffsetCurrentSign; }, /inputOffsetCurrentSign/],
        [p => { p.inputOffsetCurrentSign = 0; }, /inputOffsetCurrentSign/],
        [p => { delete p.biasSupplyDomain; }, /unsupported bias\/supply domain/],
        [p => { p.supplyPositiveV = 12; p.supplyNegativeV = -12; }, /exactly \+\/-15 V/],
        [p => { delete p.transientModel; }, /requires transientModel linear-pole/],
    ]) assert.throws(() => lm741LinearParameters(u(edit).parts.find(p => p.id === 'U')), re);
    assert.throws(() => { const hot = board(fixture({vin:0,rl:1000,sign:1})); hot.temperatureC = 50; hot.advanceTo(1000n); },
        /25 C bench temperature/);
    assert.throws(() => board(u(p => { p.supplyPositiveV = 12; p.supplyNegativeV = -12; })), /\+\/-15 V/);
});

test('domain off: expansion, currents and voltages are unchanged', () => {
    const on = fixture({vin:.05,rl:1000,sign:1}), off = fixture({vin:.05,rl:1000,sign:1,domain:false});
    const view = expandLm741LinearPoles(off.parts, off.nets);
    assert.equal(view.parts.length, off.parts.length + 5);
    assert.ok(!view.parts.some(p => p.kind === 'lm741_rail_return'));
    assert.equal(expandLm741LinearPoles(on.parts, on.nets).parts.length, on.parts.length + 6);
    assert.equal(lm741BiasSupply(off.parts.find(p => p.id === 'U')), null);
    const b = board(off); b.advanceTo(20000n);
    assert.equal(b._mnaCache.branchCurrents.get('U').has('vpos'), false, 'no supply law when off');
    // Off: same exact equations with zero bias currents.
    const G = 1/1000 + 1/ROUT, d = (.05*G)/(A0/ROUT + 1/RD + (1 + RS/RD)*G);
    near(b.nodeVoltage('out'), .05 - d - RS*d/RD, 1e-9, 'unchanged follower');
    near(b.nodeVoltage('input'), .05 - RS*d/RD, 1e-9, 'no bias drop when off');
    // Signal-only model: rail sources carry no package current.
    near(b.branchCurrent('VP','pos'), 0, 1e-15, 'VP');
});
