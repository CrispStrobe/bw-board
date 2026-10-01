import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeDeviceQuantaProof} from
  '../scripts/bochs-cpu3-native-device-quanta-compare.mjs';

// Actual initial four-arm capture from historical source 683e5662. Preserve
// its original bytes as mutation input; this is not a final qualification
// receipt. Source-bound execution separately verifies artifacts and binary.
const bytes=gunzipSync(readFileSync(new URL(
  './fixtures/i80386-bochs-cpu3-native-device-quanta-initial-capture.json.gz',
  import.meta.url)));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'b2fd1c74579760e52cffc0a34fe1b2ac78ec23e6424c2fae9a4329ed0f8521bb');
const capture=JSON.parse(bytes);
const names=['continuous','budget1','budget2','budget257'];
const each=(report,change)=>names.forEach(name=>change(report.arms[name]));
const event=(arm,tag,predicate=()=>true)=>{
  const found=arm.native.events.find(e=>e.tag===tag&&predicate(e));
  assert(found,`${tag} mutation witness missing`);
  return found;
};

test('actual historical four-arm capture passes successful-work PIT/PIC proof',()=>{
  assert.equal(capture.source.boardRevision,'683e56623e6baed05dfb76bb330caab0740f8523');
  const result=assertNativeDeviceQuantaProof(capture);
  assert.equal(result.status,'native-device-quanta-proof-pass');
  assert.equal(result.successfulQuanta,4041);
  assert.equal(result.nativeTicks,4043);
  assert.equal(result.boardCycles,24246);
});

const mutations=[
  ['one-arm double charge of final REP element',r=>{
    const a=r.arms.budget1;
    const final=event(a,'QUANTUM',e=>e.eip===0x7fcf);
    const extra=structuredClone(final);
    extra.kind=0;extra.preQ++;extra.successfulQuanta++;
    a.native.events.splice(a.native.events.indexOf(final)+1,0,extra);
    a.native.events.forEach((e,i)=>{e.ordinal=i+1;});
  }],
  ['all-arm zero-count REP charge lost with plausible totals',r=>each(r,a=>{
    event(a,'QUANTUM',e=>e.eip===0x7f64).eip=0x7f84;
  })],
  ['all-arm fault receives a successful charge with unchanged totals',r=>each(r,a=>{
    event(a,'FAULT_DELIVERED').successfulQuanta++;
  })],
  ['one-arm committed REP progress lost',r=>{
    event(r.arms.budget257,'QUANTUM',e=>e.successfulQuanta===2985).postCX++;
  }],
  ['all-arm active PIT cut delayed',r=>each(r,a=>{
    a.native.slices.find(s=>s.eventDue).afterQuanta++;
  })],
  ['all-arm active interrupt line delayed',r=>each(r,a=>{
    const line=a.host.journal.find(e=>e.kind==='line-stage'&&e.asserted===true);
    assert(line,'active line witness missing');line.successfulQuanta++;
  })],
  ['all-arm premature PIC acknowledgement',r=>each(r,a=>{
    a.host.journal.find(e=>e.kind==='pic-ack').successfulQuanta=3998;
  })],
  ['all-arm terminal HLT idle state changed',r=>each(r,a=>{
    event(a,'HALT_IDLE').eip++;
  })],
  ['one-arm raw idle duplicate removed despite restored ordinals',r=>{
    const a=r.arms.continuous;
    const idle=event(a,'HALT_IDLE');
    a.native.events.splice(a.native.events.indexOf(idle),1);
    a.native.events.forEach((e,i)=>{e.ordinal=i+1;});
  }],
  ['one-arm RPC completion ordering changed',r=>{
    r.arms.budget2.rpc.dones[0].seq++;
  }],
  ['all-arm RPC request clock tuple changed',r=>each(r,a=>{
    a.rpc.requests.find(e=>e.operation==='QUANTUM').successfulQuanta++;
  })],
  ['all-arm in-range PIT fractional state drift',r=>each(r,a=>{
    a.host.final.pitFraction=(a.host.final.pitFraction+0.125)%1;
  })],
  ['all-arm plausible PIT internal phase changed',r=>each(r,a=>{
    a.host.final.pit.counters[0].rwPhase^=1;
  })],
  ['all-arm RAM read byte changed',r=>each(r,a=>{
    event(a,'MEM',e=>e.rw==='R').value^=1;
  })],
  ['all-arm RAM write commit removed',r=>each(r,a=>{
    event(a,'MEM',e=>e.rw==='W').effect='ignored';
  })],
  ['all-arm fallback counters missing',r=>each(r,a=>{
    a.native.fallback={};
  })],
  ['all-arm physical callback count changed',r=>each(r,a=>{
    assert.equal(typeof a.native.callbacks.physicalReads,'number');
    a.native.callbacks.physicalReads++;
  })],
  ['all-arm RAM seed identity changed',r=>each(r,a=>{
    a.native.seed.ramSha256='0'.repeat(64);
  })],
  ['source binary identity changed',r=>{r.source.binarySha256='0'.repeat(64);}],
  ['compiled native runtime identity changed',r=>{
    r.source.sourceHashes['scripts/bochs-cpu3-native-device-quanta/runtime.inc']='0'.repeat(64);
  }],
  ['native ROM include identity changed',r=>{r.source.romIncludeSha256='0'.repeat(64);}],
  ['source configuration artifact identity changed',r=>{
    r.source.bochsrcSha256='0'.repeat(64);
  }],
  ['one-arm artifact mirror changed',r=>{
    r.arms.budget1.artifacts.files.stderr.sha256='0'.repeat(64);
  }],
  ['missing native guard',r=>{delete r.probes[Object.keys(r.probes)[0]];}],
  ['native guard named FAIL changed',r=>{
    r.probes[Object.keys(r.probes)[0]].observedFailure='wrong-failure';
  }],
  ['native guard signal changed',r=>{
    r.probes[Object.keys(r.probes)[0]].exit.signal='SIGTERM';
  }],
  ['transport guard named FAIL changed',r=>{
    r.transportProbes[Object.keys(r.transportProbes)[0]].observedFailure='wrong-failure';
  }],
];

// Keep full report clones serial: the actual RAM seed and event streams are
// deliberately retained rather than replaced with a synthetic small report.
for(const [name,change] of mutations){
  test(`rejects ${name} in actual capture`,()=>{
    const altered=structuredClone(capture);
    change(altered);
    assert.throws(()=>assertNativeDeviceQuantaProof(altered),
      /native quanta proof/,`${name} must fail proof validation`);
  });
}
