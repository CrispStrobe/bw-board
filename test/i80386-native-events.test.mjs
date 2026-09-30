import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertNativeEventsArm} from '../scripts/bochs-cpu3-native-events-compare.mjs';
import {failureProbe,parseArm} from '../scripts/run-bochs-cpu3-native-events-compare.mjs';

// A normalized, freely authored exploratory arm tests the evidence contract.
// It is not a four-arm qualification receipt or a performance measurement.
const input=JSON.parse(readFileSync(new URL('./fixtures/i80386-native-events-smoke-arm.json',
  import.meta.url),'utf8'));
assert.equal(input.scope,'exploratory-normalized-test-input-not-a-proof-receipt');
const check=arm=>assertNativeEventsArm('continuous',arm,input.activation);
const rejects=(edit,pattern)=>{
  const arm=structuredClone(input.arm);edit(arm);
  assert.throws(()=>check(arm),pattern);
};
const first=(arm,kind)=>arm.journal.find(e=>e.kind===kind);

test('accepts the owned exploratory native event arm as a test input',()=>{
  const result=check(input.arm);
  assert.equal(result.totals.ticks,1126);
  assert.equal(result.journal.length,2195);
  assert.equal(result.slices,15);
});

test('rejects native tick and host-write schedule drift with the same final state',()=>{
  rejects(arm=>{first(arm,'write').tick++;},/charged tick ledger/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='tick').preTick++;},/tick schedule/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x9004).bytes='01000000';},
    /REP write coverage/);
  rejects(arm=>{arm.hostCallbacks.physicalWrites--;},/callback totals/);
});

test('rejects early IRQ, wrong frame bytes, vector and line ownership drift',()=>{
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x530&&
    e.bytes==='01').bytes='00';},/STI successor/);
  rejects(arm=>{const i=arm.journal.findIndex(e=>e.kind==='irq-ack');
    arm.journal[i].entry.eip=0x7e7c;},/irq\[0\].ack|protected IRQ frame/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x6ffc).bytes='00000000';},
    /ACK-frame-delivery/);
  rejects(arm=>{first(arm,'irq-line').vector=0x21;},/IRQ vector/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='irq-delivered').frame.eflags=0;},
    /protected IRQ frame/);
});

test('rejects missing idle return, charged idle reentry and masked wake',()=>{
  rejects(arm=>{const idle=arm.journal.filter(e=>e.kind==='halt-idle');
    idle[4].pendingEvent&=~0x400;},/idle or eligible wake/);
  rejects(arm=>{const idle=arm.journal.findIndex(e=>e.kind==='halt-idle');
    arm.journal.splice(idle,1);},/action and delivery order|idle or eligible wake/);
  rejects(arm=>{const zero=arm.slices.find(s=>s.reason==='halt'&&s.chargedTicks===0);
    zero.chargedTicks=1;},/tick charge differs/);
  rejects(arm=>{const last=arm.slices.at(-1);last.after.irqDeliveries++;},
    /count discontinuity|final count differs/);
});

test('rejects lost deadline, budget overrun, and final checkpoint corruption',()=>{
  rejects(arm=>{const due=arm.slices.find(s=>s.reason==='event-due');
    due.reason='budget';},/event\/IRQ\/HLT inventory/);
  rejects(arm=>{arm.slices[0].chargedTicks=arm.slices[0].effectiveTicks+1;},
    /budget invalid/);
  rejects(arm=>{arm.final.selectedState.eip=0x7eb4;},/terminal selected CPU state/);
  rejects(arm=>{arm.final.ramWords.irqCount=1;},/final.ramWords/);
});

test('raw BWS4 parser rejects fabricated completion and absent seed pages',()=>{
  assert.throws(()=>parseArm('BWS4\tDEACTIVATE\tproof-complete\n','continuous',null),
    /deactivation lacks final proof/);
  assert.throws(()=>parseArm('BWS4\tSEEDPAGE\t0\t00\n','continuous',null),
    /misplaced page/);
});

test('fail-closed probe requires exact SIGABRT guard',()=>{
  const raw='BWS4\tFAIL\tBochs-RAM-read-fallback\n';
  assert.deepEqual(failureProbe({code:null,signal:'SIGABRT',stderr:raw},'bochsRamRead'),
    {rejected:true,kind:'bochs-ram-read',observedFailure:'Bochs-RAM-read-fallback'});
  assert.throws(()=>failureProbe({code:null,signal:'SIGTERM',stderr:raw},'bochsRamRead'),
    /did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    'BWS4\tFAIL\tBochs-timer-fallback\n'},'bochsRamRead'),/exact active guard/);
});
