import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

const net = (id, ...terminals) => ({id,
  terminals: terminals.map(([part, terminal]) => ({part, terminal}))});

// Electrical reduction of the motor-driver startup: the motor's initial
// back-EMF is zero, leaving its 5 mH winding and 10 ohm winding resistance.
// No UI, mechanics, breadboard, fixture download or emulator is required.
function winding({baseOhms = 1000, mode = 'quasi', vceSat = .2} = {}) {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'M',kind:'mcu',params:{},terminals:['P1.4']},
    {id:'RB',kind:'resistor',params:{ohms:baseOhms},terminals:['a','b']},
    {id:'Q',kind:'npn',params:vceSat === null ? {} : {vceSat},terminals:['base','collector','emitter']},
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
