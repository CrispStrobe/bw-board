import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

const net = (id, ...terminals) => ({id,
  terminals: terminals.map(([part, terminal]) => ({part, terminal}))});

for (const kind of ['diode','led']) for (const volts of [-5,0,.1]) {
  test(`${kind} off-junction readback is signed at ${volts} V`, () => {
    const b = new BoardImpl(5);
    b.setNetlist([
      {id:'V',kind:'vsource',params:{volts},terminals:['pos','neg']},
      {id:'G',kind:'gnd',params:{},terminals:['gnd']},
      {id:'D',kind,params:{vf:kind === 'led' ? 2 : .7},terminals:['anode','cathode']},
    ],[
      net('source',['V','pos'],['D','anode']),
      net('zero',['V','neg'],['D','cathode'],['G','gnd']),
    ]);
    b.advanceTo(1n);
    assert.ok(Math.abs(b.nodeVoltage('source')-volts)<1e-9);
    const current = b._mnaCache.branchCurrents.get('D');
    assert.ok(Math.abs(current.get('anode')+1e-9*volts)<1e-15);
    assert.equal(current.get('anode')+current.get('cathode'),0);
  });
}

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

for (const kind of ['npn','pnp']) test(`off-state ${kind} base and controlled collector readback match their stamps`, () => {
  const source = kind === 'npn' ? 'supply' : 'zero';
  const emitter = kind === 'npn' ? 'zero' : 'supply';
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'RB',kind:'resistor',params:{ohms:1e10},terminals:['a','b']},
    {id:'RC',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'Q',kind,params:{},terminals:['base','collector','emitter']},
  ],[
    net('supply',['V','vcc'],...(source === 'supply' ? [['RB','a'],['RC','a']] : []),
      ...(emitter === 'supply' ? [['Q','emitter']] : [])),
    net('base',['RB','b'],['Q','base']),
    net('collector',['RC','b'],['Q','collector']),
    net('zero',['G','gnd'],...(source === 'zero' ? [['RB','a'],['RC','a']] : []),
      ...(emitter === 'zero' ? [['Q','emitter']] : [])),
  ]);
  b.advanceTo(1n);
  const vb = kind === 'npn' ? b.nodeVoltage('base') : 5-b.nodeVoltage('base');
  assert.ok(vb > .1 && vb < .65,'base is below the PWL knee, but not at zero');
  const currents = b._mnaCache.branchCurrents.get('Q');
  const sign = kind === 'npn' ? 1 : -1;
  assert.ok(Math.abs(currents.get('base')+sign*1e-9*vb)<1e-15);
  assert.ok(Math.abs(currents.get('collector')+sign*100e-9*vb)<1e-15);
  assert.ok(Math.abs([...currents.values()].reduce((sum,i)=>sum+i,0))<1e-15);
});
