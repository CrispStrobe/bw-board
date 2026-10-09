import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

const net = (id, ...terminals) => ({id,
  terminals: terminals.map(([part, terminal]) => ({part, terminal}))});

// Electrical reduction of the motor-driver startup: the motor's initial
// back-EMF is zero, leaving its 5 mH winding and 10 ohm winding resistance.
// No UI, mechanics, breadboard, fixture download or emulator is required.
function winding({baseOhms = 1000, mode = 'quasi', vceSat = .2,
  transistorParams = vceSat === null ? {} : {vceSat}} = {}) {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'M',kind:'mcu',params:{},terminals:['P1.4']},
    {id:'RB',kind:'resistor',params:{ohms:baseOhms},terminals:['a','b']},
    {id:'Q',kind:'npn',params:transistorParams,terminals:['base','collector','emitter']},
    {id:'L',kind:'inductor',params:{henrys:.005},terminals:['a','b']},
    {id:'RW',kind:'resistor',params:{ohms:10},terminals:['a','b']},
    {id:'D',kind:'diode',params:{vf:.7},terminals:['anode','cathode']},
  ],[
    net('supply',['V','vcc'],['L','a'],['D','cathode']),
    net('zero',['G','gnd'],['Q','emitter']),
    net('pin',['M','P1.4'],['RB','a']),
    net('base',['RB','b'],['Q','base']),
    net('winding',['L','b'],['RW','a']),
    net('collector',['RW','b'],['Q','collector'],['D','anode']),
  ]);
  b.setPower(true); b.reset(); b.setPin('P1.4',mode,true);
  return b;
}

test('weak-drive NPN winding crosses saturation into current limiting without false failed history', () => {
  const b = winding();
  const receipt = b.advanceToLive(1000000n,{maxSteps:16});
  assert.equal(receipt.completed,true);
  assert.equal(b.getTime(),1000000n);
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  // Independent base-network solution in the specified C1 PWL knee band:
  // Ib=(Vbe-.675)^2, and 5=Ib*(21700+1000)+Vbe.
  const u = (Math.sqrt(1+4*22700*4.325)-1)/(2*22700);
  const limit = 100*u*u;
  const current = b.inductorCurrents.get('L');
  assert.ok(Math.abs(current-limit)<2e-6, `winding ${current} A, beta*Ib ${limit} A`);
  const wantCollector = 5-10*limit;
  assert.ok(Math.abs(b.nodeVoltage('collector')-wantCollector)<.002,
    'settled collector follows supply minus winding resistance drop');
});

test('strong-drive winding retains its independent saturated RL step response', () => {
  const b = winding({baseOhms:100,mode:'pushpull'});
  b.advanceToLive(100000n,{maxSteps:16});
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  // Fixed Vce=.2 plus the existing .1 ohm saturated clamp and 10 ohm winding.
  const want = 4.8/10.1*(1-Math.exp(-10.1*.0001/.005));
  assert.ok(Math.abs(b.inductorCurrents.get('L')-want)<2e-5,
    `actual ${b.inductorCurrents.get('L')} A; independent RL ${want} A`);
});

test('default NPN winding startup completes without clearing or ignoring failed history', () => {
  const b = winding({vceSat:null});
  assert.equal(b.advanceToLive(1000000n,{maxSteps:16}).completed,true);
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  assert.ok(b.inductorCurrents.get('L') > .018, 'the winding is actually energized');
});

test('weak-drive fixed-clamp startup agrees with independent RL before its calculated boundary', () => {
  const u = (Math.sqrt(1+4*22700*4.325)-1)/(2*22700);
  const limit = 100*u*u;
  const crossing = -.005/10.1*Math.log(1-limit/(4.8/10.1));
  assert.ok(crossing > 20.18e-6 && crossing < 20.20e-6);
  // Current is continuous at this ideal-model boundary, but collector voltage
  // jumps by >4.6 V: saturated clamp -> ideal beta*Ib current source. Comparing
  // node-voltage LTE across that event is not a smooth-ODE error estimate.
  const before = .2+.1*limit;
  const after = 5-10*limit;
  assert.ok(after-before > 4.6);
  const b = winding();
  b.advanceToLive(19000n,{maxSteps:16});
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  const want = 4.8/10.1*(1-Math.exp(-10.1*19e-6/.005));
  assert.ok(Math.abs(b.inductorCurrents.get('L')-want)<2e-6);
  assert.ok(Math.abs(b.nodeVoltage('collector')-(.2+.1*want))<1e-4);
});

test('explicit finite-Early-voltage control matches independent ngspice startup samples', () => {
  // This is a separate authored model, NOT a replacement for the failing
  // generic-model tests above and NOT an undeclared addition to a part card.
  // Deck, ngspice version, integration settings and differences are in the
  // adjacent specification. Fresh instances avoid sample-boundary perturbation.
  const reference = [
    [10000n, .009724297, .1218993],
    [20000n, .01903418, 1.933247],
    [50000n, .01957415, 4.804258],
    [100000n, .01957415, 4.804258],
    [1000000n, .01957415, 4.804258],
  ];
  for (const [ns, amps, volts] of reference) {
    const b = winding({transistorParams:{model:'shockley',vaf:100}});
    assert.equal(b.advanceToLive(ns,{maxSteps:16}).completed,true);
    assert.equal(b.transientAnalysisStatus().accuracyMet,true);
    assert.ok(Math.abs(b.inductorCurrents.get('L')-amps)<1e-6, `current at ${ns} ns`);
    assert.ok(Math.abs(b.nodeVoltage('collector')-volts)<.001, `voltage at ${ns} ns`);
  }
});

test('motor flyback current readback satisfies collector KCL before switching', () => {
  const b = winding({vceSat:null});
  b.advanceToLive(19000n,{maxSteps:16});
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  const r = b._mnaCache;
  const volts = b.nodeVoltage('collector')-5;
  assert.ok(volts < -4, 'flyback diode is actually reverse biased');
  const diode = r.branchCurrents.get('D');
  assert.ok(Math.abs(diode.get('anode') + 1e-9*volts)<1e-15,
    'out-of-part anode current matches the existing reverse conductance');
  assert.equal(diode.get('anode')+diode.get('cathode'),0);
  const residual = r.branchCurrents.get('Q').get('collector')
    +r.branchCurrents.get('RW').get('b')+diode.get('anode');
  assert.ok(Math.abs(residual)<1e-10,`collector KCL residual ${residual} A`);
});

test('off-state BJT base and controlled collector readback match their stamps', () => {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'RB',kind:'resistor',params:{ohms:1e10},terminals:['a','b']},
    {id:'RC',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'Q',kind:'npn',params:{},terminals:['base','collector','emitter']},
  ],[
    net('supply',['V','vcc'],['RB','a'],['RC','a']),
    net('base',['RB','b'],['Q','base']),
    net('collector',['RC','b'],['Q','collector']),
    net('zero',['G','gnd'],['Q','emitter']),
  ]);
  b.advanceTo(1n);
  const vb = b.nodeVoltage('base');
  assert.ok(vb > .1 && vb < .65,'base is below the PWL knee, but not at zero');
  const currents = b._mnaCache.branchCurrents.get('Q');
  assert.ok(Math.abs(currents.get('base')+1e-9*vb)<1e-15);
  assert.ok(Math.abs(currents.get('collector')+100e-9*vb)<1e-15);
  assert.ok(Math.abs([...currents.values()].reduce((sum,i)=>sum+i,0))<1e-15);
});
