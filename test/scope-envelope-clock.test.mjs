import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

function constantBench() {
  const board=new BoardImpl(5);
  board.setNetlist([
    {id:'V',kind:'vsource',params:{volts:5},terminals:['pos','neg']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
  ],[
    {id:'signal',terminals:[{part:'V',terminal:'pos'},{part:'R',terminal:'a'}]},
    {id:'ground',terminals:[{part:'V',terminal:'neg'},{part:'R',terminal:'b'},{part:'G',terminal:'gnd'}]},
  ]);
  board.setPower(true);return board;
}

for(const origin of [0n,123450n])for(const rate of [100000,25000])
test(`voltage ring labels bucket starts and sample instants across wrap: origin ${origin}, rate ${rate}`,()=>{
  const board=constantBench(),depth=8,interval=BigInt(1e9/rate);
  board.advanceTo(origin);
  const envelope=board.addScopeChannel({type:'voltage',netId:'signal',sampleRateHz:rate,depth});
  const sample=board.addScopeChannel({type:'voltage',netId:'signal',sampleRateHz:rate,depth,capture:'sample'});
  for(const count of [1,depth,depth+1,depth*3+3]){
    const end=origin+BigInt(count)*interval;
    board.advanceTo(end);
    const e=board.getScopeData(envelope),s=board.getScopeData(sample);
    const retained=Math.min(count,depth);
    assert.equal(e.count,count);assert.equal(s.count,count);
    assert.equal(e.sampleIntervalNs,interval);assert.equal(s.sampleIntervalNs,interval);
    assert.equal(e.capture,'envelope');assert.equal(s.capture,'sample');
    assert.equal(e.startTNs,end-BigInt(retained)*interval,
      'oldest envelope begins one interval before its closing sample, even after wrap');
    assert.equal(s.startTNs,end-BigInt(retained-1)*interval,
      'sample series keeps the actual acquisition instant, not a bucket start');
    assert.equal(s.startTNs-e.startTNs,interval,'the two clock contracts remain distinct');
    for(const data of [e,s])for(let i=0;i<retained;i++){
      const index=((data.writeIndex-retained+i)%depth+depth)%depth;
      assert.equal(data.samples[2*index],5);assert.equal(data.samples[2*index+1],5);
    }
    // A partial new bucket must not advance either published ring clock.
    board.advanceTo(end+interval/3n);
    assert.equal(board.getScopeData(envelope).startTNs,e.startTNs);
    assert.equal(board.getScopeData(sample).startTNs,s.startTNs);
  }
});
