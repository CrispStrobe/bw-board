import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeDeviceEventsCoreProof} from
  '../scripts/bochs-cpu3-native-device-events-compare.mjs';

// Actual initial four-arm capture from committed source 081e44ce. This free
// fixture is mutation input, not the final qualification receipt. The full
// source-bound runner separately verifies the raw files and native binary.
const captureBytes=gunzipSync(readFileSync(new URL(
  './fixtures/i80386-bochs-cpu3-native-device-events-initial-capture.json.gz',
  import.meta.url)));
assert.equal(createHash('sha256').update(captureBytes).digest('hex'),
  '9478b91dcb12786a050c5db70f5be13e5e81470928ba0b5627e1764773e13a83');
const capture=JSON.parse(captureBytes);
const armNames=['continuous','budget1','budget2','budget257'];
const eachArm=(report,change)=>{
  for(const name of armNames)change(report.arms[name]);
};
const first=(arm,tag)=>arm.native.events.find(event=>event.tag===tag);

test('actual initial free capture satisfies the bounded PIT/PIC proof',()=>{
  assert.equal(capture.source.boardRevision,
    '081e44ce677ab74737fa7bad5d89d118160b4003');
  const result=assertNativeDeviceEventsCoreProof(capture);
  assert.equal(result.status,'native-device-events-self-parity');
  assert.equal(result.nativeTicks,92);
  assert.equal(result.boardCycles,21044);
  assert.deepEqual(result.slices,
    {continuous:20,budget1:95,budget2:50,budget257:20});
});

const mutations=[
  ['one-arm board clock drift',report=>{
    report.arms.budget1.host.final.boardCycles++;
  }],
  ['all-arm board clock drift',report=>eachArm(report,arm=>{
    arm.host.final.boardCycles++;
  })],
  ['all-arm host quantum schedule drift with unchanged final clock',report=>
    eachArm(report,arm=>{
      const quantum=arm.host.journal.find(event=>event.kind==='quantum');
      assert(quantum,'ordinary host quantum absent');
      quantum.boardCycles++;
    })],
  ['one-arm native tick attribution',report=>{
    first(report.arms.budget2,'TICK').preTick++;
  }],
  ['all-arm RAM class substitution',report=>eachArm(report,arm=>{
    first(arm,'MEM').class='rom';
  })],
  ['all-arm RAM read value substitution',report=>eachArm(report,arm=>{
    const read=arm.native.events.find(event=>event.tag==='MEM'&&event.rw==='R');
    assert(read,'owned memory read absent');
    read.value^=1;
  })],
  ['one-arm RAM commit removed',report=>{
    const write=report.arms.budget257.native.events.find(event=>
      event.tag==='MEM'&&event.rw==='W');
    assert(write,'owned memory write absent');
    write.effect='ignored';
  }],
  ['all-arm PIO reply precedes its request completion',report=>eachArm(report,arm=>{
    const events=arm.native.events;
    const portIndex=events.findIndex(event=>event.tag==='PORT');
    assert.equal(events[portIndex-1].tag,'RPC_REP');
    [events[portIndex-1],events[portIndex]]=
      [events[portIndex],events[portIndex-1]];
    events[portIndex-1].ordinal=portIndex;
    events[portIndex].ordinal=portIndex+1;
  })],
  ['one-arm native callback count',report=>{
    report.arms.budget1.native.callbacks.tickCallbacks--;
  }],
  ['all-arm missing callback API refusal',report=>eachArm(report,arm=>{
    delete arm.native.apiProbes['line-reentry'];
  })],
  ['one-arm saved IRQ frame EIP',report=>{
    report.arms.budget2.native.ramFinal.copiedEip++;
  }],
  ['all-arm missing zero-tick HLT boundary',report=>eachArm(report,arm=>{
    const idle=arm.native.slices.find(slice=>slice.reason===4&&
      slice.chargedTicks===0&&slice.exit.eip===0x7e9c);
    assert(idle,'first zero-tick HLT absent');
    idle.reason=1;
  })],
  ['all-arm PIT fractional clock outside range',report=>eachArm(report,arm=>{
    arm.host.final.pitFraction=2;
  })],
  ['all-arm plausible PIT fractional drift in quantum and final state',report=>
    eachArm(report,arm=>{
      const quantum=arm.host.journal.find(event=>event.kind==='quantum');
      assert(quantum,'ordinary host quantum absent');
      quantum.pitFractionAfter+=0.001;
      arm.host.final.pitFraction+=0.001;
    })],
  ['all-arm PIT reload substituted',report=>eachArm(report,arm=>{
    arm.host.final.pit.counters[0].reload=4095;
  })],
  ['all-arm PIT read/write phase changed with same reload',report=>
    eachArm(report,arm=>{
      arm.host.final.pit.counters[0].rwPhase=1;
    })],
  ['all-arm PIC in-service bit retained',report=>eachArm(report,arm=>{
    arm.host.final.pic.isr=1;
  })],
  ['source binary identity substituted',report=>{
    report.source.binarySha256='0'.repeat(64);
  }],
  ['native guard did not abort as named',report=>{
    report.probes['bochs-pio'].exit.signal='SIGTERM';
  }],
];

for(const [name,change] of mutations){
  test(`rejects ${name} in the actual capture`,()=>{
    const altered=structuredClone(capture);
    change(altered);
    assert.throws(()=>assertNativeDeviceEventsCoreProof(altered),
      /native device proof/,`${name} must not satisfy the proof`);
  });
}
