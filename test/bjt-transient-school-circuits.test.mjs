import test from 'node:test';
import assert from 'node:assert/strict';
import {organBench,amplifierBench,envelopeEdges} from './fixtures/school-circuits/benches.mjs';

test('manufacturer miniorgan oscillates with a pressed key, matched-model SPICE reference',()=>{
 const b=organBench();const ch=b.addScopeChannel({type:'voltage',netId:'out',sampleRateHz:100000,depth:4096});
 b.advanceTo(20_000_000n);const data=b.getScopeData(ch),edges=envelopeEdges(data);
 assert.ok(edges.length>=4,'multiple genuine periods, not a startup transient');
 const hz=(edges.length-1)/(edges.at(-1)-edges[0]);
 assert.ok(Math.abs(hz-255.66255)<1,`${hz} Hz against matched ngspice 255.66255 Hz`);
 const max=Math.max(...data.samples.filter(Number.isFinite));
 assert.ok(Math.abs(max-8.0212)<.005,`${max} V against matched ngspice 8.0212 V`);
});

test('released miniorgan key produces no continuing oscillation',()=>{
 const b=organBench({key:0}),ch=b.addScopeChannel({type:'voltage',netId:'out',sampleRateHz:100000,depth:4096});
 b.advanceTo(20_000_000n);assert.equal(envelopeEdges(b.getScopeData(ch)).length,0);
});

test('amplifier can start from its actual DC charge state without inventing a startup impulse',()=>{
 const b=amplifierBench();b.initializeTransientFromOperatingPoint();
 const initial=b.nodeVoltage('out');assert.ok(initial>.05&&initial<.3);
 b.advanceTo(1000n);assert.ok(Math.abs(b.nodeVoltage('out')-initial)<.002);
});
