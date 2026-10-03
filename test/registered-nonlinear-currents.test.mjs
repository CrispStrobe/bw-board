import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoardImpl} from '../src/board.js';
import {registerDevice, unregisterDevice} from '../src/devices.js';

const kind = 'proof-nonlinear-multiport';
const terminals = ['out', 'in', 'gnd'];
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});
const near = (a, b, label, tolerance = 1e-8) => assert.ok(Math.abs(a-b) < tolerance,
  `${label}: ${a} versus ${b}`);

function law(read, scale, {upper = true, lower = true} = {}) {
  const demand = (5*scale - (read('out')-read('gnd')))/.05;
  const limit = .36*scale, knee = .2*scale;
  const q = Math.min(upper ? limit : Infinity, lower ? Math.max(0,demand) : demand);
  const iq = 50e-6*scale + 130e-6*Math.min(q,knee)/.2;
  const linear = (!lower || demand > 0) && (!upper || demand < limit);
  const dq = linear ? -20 : 0;
  const alpha = q < knee ? .00065 : 0;
  const row = factor => new Map([['out',factor*dq],['gnd',-factor*dq]]);
  return {region: demand <= 0 && lower ? 'zero' : demand >= limit && upper ? 'limit'
    : q < knee ? 'linear-low-iq' : 'linear-high-iq',
  currents: new Map([['out',q],['in',-q-iq],['gnd',iq]]),
  jacobian: new Map([['out',row(1)],['in',row(-1-alpha)],['gnd',row(alpha)]]),
  residualOhms: .05};
}

function rig({load = 1000, force = null, shift = 0, mutate = null, missing = null,
  overrides = false, disappear = false, keyMode = null, customLaw = law, lawOptions = {}, evaluations = []} = {}) {
  let stampCount = 0;
  registerDevice(kind, {
    terminals,
    init: () => ({drives: {}, sentinel: {unchanged: true}}),
    stamp(ctx) {
      // Deliberately malformed model: probe removal of a previously authored
      // authority without mutating the device's persistent state.
      stampCount++;
      if (disappear && stampCount > 1) return;
      const evaluate = (read, scale) => {
        const result = customLaw(read,scale,lawOptions);
        if (mutate) mutate(result);
        evaluations.push({region:result.region, scale, out:read('out'), gnd:read('gnd')});
        return result;
      };
      ctx.nonlinearCurrents(keyMode === 'empty' ? '' :
        keyMode === 'replace' && stampCount > 1 ? 'replacement' : 'supply-output', evaluate);
      if (keyMode === 'duplicate') ctx.nonlinearCurrents('supply-output', evaluate);
      if (keyMode === 'add' && stampCount > 1) ctx.nonlinearCurrents('late-authority', evaluate);
    },
    ...(overrides ? {branchCurrents: () => new Map(terminals.map(t => [t,123]))} : {}),
  });
  const b = new BoardImpl(5);
  const parts = [
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'REF',kind:'vsource',params:{volts:shift},terminals:['pos','neg']},
    {id:'VS',kind:'vsource',params:{volts:8},terminals:['pos','neg']},
    {id:'RS',kind:'resistor',params:{ohms:4},terminals:['a','b']},
    {id:'U',kind,params:{},terminals},
    {id:'RL',kind:'resistor',params:{ohms:load},terminals:['a','b']},
    ...(force === null ? [] : [{id:'FORCE',kind:'vsource',params:{volts:force},terminals:['pos','neg']}]),
  ];
  const nets = [net('zero',['G','gnd'],['REF','neg']),
    net('gnd',['REF','pos'],['VS','neg'],['U','gnd'],['RL','b'],
      ...(force === null ? [] : [['FORCE','neg']])),
    net('source',['VS','pos'],['RS','a']),net('vin',['RS','b'],['U','in']),
    net('out',['U','out'],['RL','a'],...(force === null ? [] : [['FORCE','pos']]))];
  for (const n of nets) n.terminals = n.terminals.filter(t => !(t.part === 'U' && t.terminal === missing));
  b.setNetlist(parts,nets);
  b.advanceTo(1n);
  return b;
}

function coherent(b, expectedQ) {
  const q = b.branchCurrent('U','out');
  const iq = 50e-6 + 130e-6*Math.min(expectedQ,.2)/.2;
  near(q,expectedQ,'output law');
  near(b.branchCurrent('U','in'),-expectedQ-iq,'simultaneous input');
  near(b.branchCurrent('U','gnd'),iq,'ground IQ');
  near(terminals.reduce((s,t) => s+b.branchCurrent('U',t),0),0,'device KCL');
  near(b.nodeVoltage('vin')-b.nodeVoltage('gnd'),8-4*(expectedQ+iq),'finite source resistance');
  near(b.branchCurrent('RS','b'),expectedQ+iq,'source resistor actual current');
}

// Deliberately discontinuous generic law: the full GMIN circuit has a valid
// low-voltage root; removing its shunt leaves no self-consistent root. This
// probes restoration authority, not a physical regulator operating law.
function fallbackLaw(read) {
  const on = read('out')-read('gnd') < 3;
  const q = on ? 1e-12 : 0;
  return {region:on?'low':'off',currents:new Map([['out',q],['in',-q],['gnd',0]]),
    jacobian:new Map(terminals.map(t => [t,new Map()])),residualOhms:1};
}

function restoredFallback(b) {
  near(b.nodeVoltage('out')-b.nodeVoltage('gnd'),1e-12/(1e-12+1e-14),
    'accepted shunted point',1e-9);
  near(b.branchCurrent('U','out'),1e-12,'restored output companion',1e-24);
  near(b.branchCurrent('U','in'),-1e-12,'restored input companion',1e-24);
}

test('registered nonlinear multiport solves both IQ slopes and ceiling without a diode/opamp', () => {
  try {
    for (const load of [1000,500,24.95,20,10]) {
      const b = rig({load});
      const q = Math.min(.36,5/(load+.05));
      near(b.nodeVoltage('out')-b.nodeVoltage('gnd'),q*load,'load line');
      coherent(b,q);
    }
  } finally {unregisterDevice(kind);}
});

test('forced output qualifies zero clamp and IQ knee for the primitive only', () => {
  try {
    for (const [force,q] of [[6,0],[4.992,.16],[4.99,.2],[4.987,.26],[4,.36]]) {
      const b = rig({force});
      coherent(b,q);
      near(b.nodeVoltage('out')-b.nodeVoltage('gnd'),force,'forced voltage');
    }
  } finally {unregisterDevice(kind);}
});

test('common-mode shift and bogus branchCurrent hooks preserve recorded multiport authority', () => {
  try {
    for (const shift of [0,2.5,-3]) {
      const b = rig({load:20,shift,overrides:true});
      coherent(b,5/20.05);
      near(b.nodeVoltage('gnd'),shift,'floating reference');
    }
  } finally {unregisterDevice(kind);}
});

test('final candidate matches extracted law and observation never mutates live device state', () => {
  try {
    const evaluations = [];
    const b = rig({load:10,evaluations});
    const before = structuredClone(b.getDeviceState('U'));
    b.biasPointVoltages();
    assert.deepEqual(b.getDeviceState('U'),before);
    assert.deepEqual(before,{drives:{},sentinel:{unchanged:true},_staticDrives:new Set()});
    const final = evaluations.at(-1);
    assert.equal(final.region,'limit');
    near(final.out-final.gnd,b.nodeVoltage('out')-b.nodeVoltage('gnd'),'final evaluated voltage');
    coherent(b,.36);
  } finally {unregisterDevice(kind);}
});

test('invalid registered nonlinear authorities refuse instead of dropping rows or reporting currents', () => {
  try {
    for (const missing of terminals) assert.throws(() => rig({missing}),/nonlinear|terminal|mapped/i);
    const mutations = [
      r => r.currents.set('out',NaN), r => r.currents.set('out',Infinity),
      r => r.jacobian.get('out').set('out',NaN), r => r.jacobian.delete('out'),
      r => r.jacobian.get('out').set('unmapped',1), r => {r.residualOhms=0;},
      r => {r.residualOhms=Infinity;}, r => {r.region='';},
    ];
    for (const mutate of mutations) assert.throws(() => rig({mutate}),/nonlinear|Jacobian|jacobian|residual|region|terminal/i);
  } finally {unregisterDevice(kind);}
});

test('a malformed model cannot silently remove its authority after the first Newton stamp', () => {
  try {
    assert.throws(() => rig({disappear:true}),/authority keys must remain constant within a solve/);
  } finally {unregisterDevice(kind);}
});

test('authority keys, current dimensions and residual scale cannot drift during candidate checks', () => {
  try {
    for (const keyMode of ['empty', 'duplicate', 'replace', 'add']) {
      assert.throws(() => rig({keyMode}), /key.*(unique|constant|nonempty)/);
    }
    let evaluations = 0;
    assert.throws(() => rig({mutate(result) {
      if (++evaluations > 1) {
        result.currents.delete('in'); result.jacobian.delete('in');
      }
    }}), /terminal-current dimensions must remain constant/);
    evaluations = 0;
    assert.throws(() => rig({mutate(result) {
      if (++evaluations > 1) result.residualOhms = .1;
    }}), /residualOhms must remain constant/);
    coherent(rig(), 5/1000.05);
  } finally {unregisterDevice(kind);}
});

test('failed refinement restores the accepted shunted solution and its matching current records', () => {
  try {
    restoredFallback(rig({load:1e14,customLaw:fallbackLaw}));
  } finally {unregisterDevice(kind);}
});

test('executable clamp mutants red actual Board callers and registry is restored', () => {
  try {
    for (const [name,options,load,force,q] of [
      ['upper clamp',{upper:false},10,null,.36],
      ['reverse clamp',{lower:false},1000,6,0],
    ]) {
      const b = rig({load,force,lawOptions:options});
      assert.throws(() => coherent(b,q),{name:'AssertionError'},`${name} must fail a real current/voltage observation`);
    }
    coherent(rig({load:10}),.36);
  } finally {unregisterDevice(kind);}
});

test('production convergence and extraction mutants red real Board callers and restore dispatcher', async () => {
  const pristine = readFileSync(new URL('../src/mna.js',import.meta.url),'utf8');
  const original = BoardImpl.prototype._solveLiveMNA;
  const mutations = [
    ['nonlinear convergence omitted','&& !deviceCheck.present','',{},5/1000.05],
    ['final affine extraction stale','add(t, nonlinearAffineCurrent(r, t, read));',
      'add(t, r.intercepts.get(t));',{load:20},5/20.05],
    ['legacy hook overrides nonlinear authority','if (!authoritativeTerminals.has(t)) currents.set(t, i);',
      'currents.set(t, i);',{load:20,overrides:true},5/20.05],
    ['tiny refinement ignores crossed IQ region',
      'moved > 1e-6 || (nonlinearPresent && !nonlinearDevicesValid().valid)',
      'moved > 1e-6',{load:24.95},.2],
    ['failed refinement keeps rejected current records',
      'const deviceSnap = nonlinearPresent ? new Map(deviceStamps) : null;',
      'const deviceSnap = null;',
      {load:1e14,customLaw:fallbackLaw,prove:restoredFallback},null],
  ];
  try {
    for (const [name,anchor,replacement,options,q] of mutations) {
      assert.equal(pristine.split(anchor).length-1,1,`${name}: unique production anchor`);
      const source = pristine.replace(anchor,replacement).replace(/from '(\.\/[^']+)'/g,
        (_,relative) => `from ${JSON.stringify(new URL(relative,new URL('../src/mna.js',import.meta.url)).href)}`);
      const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      BoardImpl.prototype._solveLiveMNA = function(pinSources,opts) {
        return mutant.solveMNA(this._solveParts,this._solveNets,pinSources,this.controls,this.vcc,opts);
      };
      assert.throws(() => assert.doesNotThrow(() => (options.prove ?? coherent)(rig(options),q)),
        {name:'AssertionError'},`${name}: actual Board current caller must red`);
      BoardImpl.prototype._solveLiveMNA = original;
      coherent(rig({load:20,overrides:true}),5/20.05);
    }
  } finally {
    BoardImpl.prototype._solveLiveMNA = original;
    unregisterDevice(kind);
  }
  assert.equal(BoardImpl.prototype._solveLiveMNA,original);
  assert.equal(readFileSync(new URL('../src/mna.js',import.meta.url),'utf8'),pristine);
});
