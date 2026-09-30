import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {assertNativeEventsArm,assertNativeEventsSelfParity} from
  '../scripts/bochs-cpu3-native-events-compare.mjs';
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

// The compressed free-owned four-arm capture predates this test and has its
// path-bearing artifact index removed. It is a mutation input, not the final
// source-bound receipt. Add its own committed hash at test time to exercise the
// current exact source inventory without a self-referential fixture file.
const previousPath='test/fixtures/i80386-native-events-qualified-3e3b58cd.json.gz';
const previousBytes=readFileSync(new URL('./fixtures/i80386-native-events-qualified-3e3b58cd.json.gz',
  import.meta.url));
const previous=JSON.parse(gunzipSync(previousBytes).toString('utf8'));
assert.equal(previous.source.boardRevision,
  '3e3b58cdbffb578e09ecf12cce527a541a36e13a');
assert.equal(previous.artifacts,undefined);
previous.source.sourceHashes[previousPath]=createHash('sha256').update(previousBytes).digest('hex');
const checkReport=()=>assertNativeEventsSelfParity(previous);
const rejectsReport=(edit,pattern)=>{
  const report=structuredClone(previous);edit(report);
  assert.throws(()=>assertNativeEventsSelfParity(report),pattern);
};

test('accepts the prior free-owned four-arm capture as a mutation input',()=>{
  const result=checkReport();
  assert.equal(result.status,'native-host-event-self-parity');
  assert.equal(result.nativeTicks,1126);
  assert.deepEqual(result.slices,
    {continuous:15,budget1:1133,budget2:569,budget257:18});
});

test('full report rejects missing or changed source identity and seed parity',()=>{
  rejectsReport(r=>{delete r.source.sourceHashes[previousPath];},/source.sourceHashes inventory/);
  rejectsReport(r=>{delete r.source.configSha256;},/source: missing configSha256/);
  rejectsReport(r=>{r.source.bochsRevision='0'.repeat(40);},/pinned Bochs/);
  rejectsReport(r=>{r.armSeeds.budget1.ramSha256='0'.repeat(64);},/armSeeds.budget1/);
});

test('full report rejects missing API, fail-closed probe, or arm evidence',()=>{
  rejectsReport(r=>{delete r.apiProbes['due-now'];},/apiProbes keys/);
  rejectsReport(r=>{r.apiProbes['due-now']='rejected';},/due-now/);
  rejectsReport(r=>{delete r.probes.bochsPio;},/probes keys/);
  rejectsReport(r=>{r.probes.bochsPio.observedFailure='unrelated crash';},/probes.bochsPio/);
  rejectsReport(r=>{delete r.arms.budget257;},/arms keys/);
});

test('full report rejects cross-arm drift and shared false final checkpoint',()=>{
  rejectsReport(r=>{r.arms.budget2.final.selectedState.edx++;},/budget2.final/);
  rejectsReport(r=>{for(const arm of Object.values(r.arms))arm.final.selectedState.eip=0x7eb4;},
    /terminal selected CPU state/);
});

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
