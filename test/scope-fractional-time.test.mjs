import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardImpl } from '../src/board.js';

function divider(profile = 'precision-v1') {
  const board = new BoardImpl(5);
  board.configureTransientAnalysis(profile);
  board.setNetlist([
    {id:'V1',kind:'vsource',params:{wave:'spice-pulse',v1:0,v2:1,td:10e-6,tr:20e-6,tf:20e-6,pw:50e-6,per:200e-6},terminals:['pos','neg']},
    {id:'R1',kind:'resistor',params:{ohms:100000},terminals:['a','b']},
    {id:'R2',kind:'resistor',params:{ohms:1000000},terminals:['a','b']},
    {id:'GND',kind:'gnd',params:{},terminals:['gnd']},
  ],[
    {id:'signal',terminals:[{part:'V1',terminal:'pos'},{part:'R1',terminal:'a'}]},
    {id:'sense',terminals:[{part:'R1',terminal:'b'},{part:'R2',terminal:'a'}]},
    {id:'ground',terminals:[{part:'V1',terminal:'neg'},{part:'R2',terminal:'b'},{part:'GND',terminal:'gnd'}]},
  ]);
  return board;
}

test('a rounded-up fractional solve cannot flush a scope point early', () => {
  const board = divider();
  const handle = board.addScopeChannel({type:'voltage',netId:'sense',sampleRateHz:1e6,depth:4,capture:'sample'});
  board.nodeVoltages.set('sense',.499875);
  board._updateScopeChannels(1000n,.99975e-6);
  assert.equal(board.getScopeData(handle).count,0,'999.75 ns is before the 1000 ns sample');
  assert.equal(board._nextSampleGridSec(.99975e-6),1e-6,'the unconsumed sample remains a solver barrier');
  board.nodeVoltages.set('sense',.500125);
  board._updateScopeChannels(1000n,1.00025e-6);
  const data = board.getScopeData(handle);
  assert.equal(data.count,1);
  assert.equal(data.startTNs,1000n);
  assert.ok(Math.abs(data.samples[0]-.5)<1e-12,'interpolate using fractional times, not equal rounded labels');
});

test('integer-only sampling and envelope flush retain their historical behavior', () => {
  const board = divider();
  const sample = board.addScopeChannel({type:'voltage',netId:'sense',sampleRateHz:1e6,depth:4,capture:'sample'});
  const envelope = board.addScopeChannel({type:'voltage',netId:'sense',sampleRateHz:1e6,depth:4});
  board.nodeVoltages.set('sense',1);
  board._updateScopeChannels(1000n);
  board.nodeVoltages.set('sense',3);
  board._updateScopeChannels(2000n);
  assert.deepEqual([...board.getScopeData(sample).samples.slice(0,4)],[1,1,3,3]);
  assert.equal(board.getScopeData(sample).count,2);
  assert.equal(board.getScopeData(sample).startTNs,1000n);
  assert.equal(board.getScopeData(envelope).startTNs,0n);
  board.nodeVoltages.set('sense',4);
  board._updateScopeChannels(3000n,2.99975e-6);
  assert.equal(board.getScopeData(sample).count,2);
  assert.equal(board.getScopeData(envelope).count,3,'envelopes keep the integer bucket contract');
});

test('a control discontinuity discards fractional interpolation history', () => {
  const board = divider();
  const handle = board.addScopeChannel({type:'voltage',netId:'sense',sampleRateHz:1e6,depth:4,capture:'sample'});
  board.nodeVoltages.set('sense',.499875);
  board._updateScopeChannels(1000n,.99975e-6);
  board.timeNs = 1000n;
  board.nodeVoltages.set('sense',1);
  board._feedScopeVoltages();
  board.nodeVoltages.set('sense',1.2);
  board._updateScopeChannels(1000n,1.00025e-6);
  assert.equal(board.getScopeData(handle).samples[0],1,
    'sample at the event uses the post-edge value, not a ramp from the old fractional instant');
});

// Independent closed form: a first-order R/C response to four ramp corners.
// The probe load is in parallel with the authored 1 Mohm resistor.
function expectedVolts(time, ohms, farads) {
  const parallel = 1/(1/1e6+1/ohms);
  const gain = parallel/(100000+parallel);
  const tau = 100000*gain*farads;
  return gain*[[10e-6,50000],[30e-6,-50000],[80e-6,-50000],[100e-6,50000]]
    .reduce((sum,[start,slope]) => {
      const elapsed = time-start;
      return sum+(elapsed>0?slope*(elapsed+tau*Math.expm1(-elapsed/tau)):0);
    },0);
}

for (const [probe,ohms,farads] of [['10x',1e7,15e-12],['1x',1e6,100e-12]]) {
  test(`${probe} precision probe capture agrees with all 400 analytical RC observations`, () => {
    const board = divider();
    const handle = board.addScopeChannel({type:'voltage',netId:'sense',referenceNetId:'ground',
      inputOhms:ohms,inputFarads:farads,sampleRateHz:2e6,depth:402,capture:'sample'});
    board.advanceTo(200000n);
    const data = board.getScopeData(handle);
    assert.equal(data.count,400);
    assert.equal(data.startTNs,500n);
    for (let index=0;index<400;index++) {
      const time = Number(data.startTNs+BigInt(index)*data.sampleIntervalNs)/1e9;
      const expected = expectedVolts(time,ohms,farads);
      const actual = data.samples[index*2];
      assert.ok(Math.abs(actual-expected)<=1e-6+1e-6*Math.max(Math.abs(actual),Math.abs(expected)),
        `${probe} sample ${index} at ${time}: ${actual} vs analytical ${expected}`);
    }
    assert.equal(board.transientAnalysisStatus().accuracyMet,true);
    const status = board.transientAnalysisStatus();
    assert.ok(status.work.attempts < status.profile.maxAttempts,'no attempt-budget relaxation');
    assert.ok(status.work.solves <= status.work.attempts*3+1);
  });
}

const ngspice = process.env.NGSPICE || 'ngspice';
const ngspicePresent = spawnSync(ngspice,['--version'],{encoding:'utf8',timeout:10000}).status === 0;
for (const [probe,ohms,farads] of [['10x',1e7,15e-12],['1x',1e6,100e-12]]) {
  test(`${probe} precision samples agree with live ngspice and its analytical control`,
  {skip:ngspicePresent?false:'ngspice missing: install ngspice or set NGSPICE; no independent comparison ran'}, () => {
    const dir = mkdtempSync(join(tmpdir(),'bwb-fractional-scope-'));
    try {
      // Authored independently of Board/exporter output: the passive probe is
      // an explicit R/C across the lower divider resistor, with zero initial bias.
      writeFileSync(join(dir,'reference.cir'),`* Dynamic passive probe reference\n`
        + `V1 signal 0 PULSE(0 1 10u 20u 20u 50u 200u)\nR1 signal sense 100k\nR2 sense 0 1meg\n`
        + `RP sense 0 ${ohms}\nCP sense 0 ${farads}\n`
        + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n'
        + '.control\nset wr_vecnames\nset wr_singlescale\ntran 500n 200u 0 1n\n'
        + 'linearize v(sense)\nwrdata reference.csv time v(sense)\n.endc\n.end\n');
      const run = spawnSync(ngspice,['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:60000});
      assert.equal(run.status,0,run.stderr || run.stdout);
      const rows = readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
        .map(line => line.trim().split(/\s+/).map(Number));
      assert.ok(rows.every(row => row.length>=2 && row.every(Number.isFinite)),'finite oracle grid required');
      const reference = rows.filter(row => row[0]>0);
      assert.equal(reference.length,400);
      const board = divider();
      const handle = board.addScopeChannel({type:'voltage',netId:'sense',referenceNetId:'ground',
        inputOhms:ohms,inputFarads:farads,sampleRateHz:2e6,depth:402,capture:'sample'});
      board.advanceTo(200000n);
      const data = board.getScopeData(handle);
      assert.equal(data.count,400);
      reference.forEach((row,index) => {
        const time = Number(data.startTNs+BigInt(index)*data.sampleIntervalNs)/1e9;
        assert.ok(Math.abs(time-row[0])<=1e-12,`time alignment ${index}`);
        const expected = row.at(-1),actual = data.samples[index*2];
        assert.ok(Math.abs(expected-expectedVolts(time,ohms,farads))<=1e-6,`oracle analytical control ${index}`);
        assert.ok(Math.abs(actual-expected)<=1e-6+1e-6*Math.max(Math.abs(actual),Math.abs(expected)),
          `live ${probe} sample ${index}: ${actual} vs ngspice ${expected}`);
      });
    } finally {
      rmSync(dir,{recursive:true,force:true});
    }
  });
}

test('fractional publication leaves envelope solver work, state and capture unchanged', () => {
  const boards = [divider(),divider()];
  const update = boards[1]._updateScopeChannels.bind(boards[1]);
  boards[1]._updateScopeChannels = timeNs => update(timeNs);
  const handles = boards.map(board => board.addScopeChannel({type:'voltage',netId:'sense',referenceNetId:'ground',
    inputOhms:1e7,inputFarads:15e-12,sampleRateHz:2e6,depth:402,capture:'envelope'}));
  boards.forEach(board => board.advanceTo(200000n));
  assert.deepEqual(boards[0].transientAnalysisStatus().work,boards[1].transientAnalysisStatus().work);
  assert.deepEqual(boards[0].capVoltages,boards[1].capVoltages);
  assert.deepEqual(boards[0].nodeVoltages,boards[1].nodeVoltages);
  assert.deepEqual(boards[0].getScopeData(handles[0]),boards[1].getScopeData(handles[1]));
});
