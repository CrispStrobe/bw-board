import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {assertNativePagedEventsArm,assertNativePagedEventsSelfParity} from
  '../scripts/bochs-cpu3-native-paged-events-compare.mjs';
import {failureProbe,parseArm} from
  '../scripts/run-bochs-cpu3-native-paged-events-compare.mjs';

// Actual free-owned continuous exploratory capture, normalized to omit paths.
// This arm is a mutation input, not a four-arm source-bound qualification.
const smoke=JSON.parse(gunzipSync(readFileSync(new URL(
  './fixtures/i80386-native-paged-events-smoke-arm.json.gz',import.meta.url))).toString());
assert.equal(smoke.scope,'exploratory-continuous-arm-mutation-input-not-qualification-receipt');
const check=arm=>assertNativePagedEventsArm('continuous',arm,smoke.activation);
const rejects=(edit,pattern)=>{
  const arm=structuredClone(smoke.arm);edit(arm);
  assert.throws(()=>check(arm),pattern);
};
const first=(arm,kind)=>arm.journal.find(event=>event.kind===kind);

// The first source-bound four-arm capture is retained as a free mutation input.
// Only its new fixture inventory entry below is synthetic: the original 99f1
// capture predates this test file and its own compressed regression input.
const actualInputPath=new URL(
  './fixtures/i80386-native-paged-events-qualified-99f1f660.json.gz',import.meta.url);
const actualInputBytes=readFileSync(actualInputPath);
const actualInput=JSON.parse(gunzipSync(actualInputBytes).toString());
assert.equal(actualInput.scope,
  'initial-99f1-four-arm-actual-capture-mutation-input-not-final-qualification-receipt');
assert.equal(actualInput.initialCaptureSha256,
  'e6c3b8c1faf3917932755aef98c1462ab8a2590ffda87518d1d2ce990c627dca');
const actualReport=structuredClone(actualInput.report);
actualReport.source.sourceHashes[
  'test/fixtures/i80386-native-paged-events-qualified-99f1f660.json.gz']=
  createHash('sha256').update(actualInputBytes).digest('hex');
const rejectsReport=(edit,pattern)=>{
  const report=structuredClone(actualReport);edit(report);
  assert.throws(()=>assertNativePagedEventsSelfParity(report),pattern);
};

test('accepts the owned combined exploratory arm as a mutation input',()=>{
  const result=check(smoke.arm);
  assert.equal(result.totals.ticks,4004);
  assert.equal(result.totals.faults,1);
  assert.equal(result.journal.length,6388);
  assert.equal(result.slices,16);
});

test('rejects a fabricated fault frame, lost fault tick or changed cause ordinal',()=>{
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x6ff0).bytes='00000000';},
    /fault.frame writes/);
  rejects(arm=>{first(arm,'fault-delivered').postTick++;},/fault cause, tick/);
  rejects(arm=>{first(arm,'fault-delivered').causeOrdinal++;},/fault cause, tick/);
  rejects(arm=>{first(arm,'fault-begin').cr2=0x5001;},/fault begin/);
});

test('rejects a handler attempt before the fault delivery cut',()=>{
  rejects(arm=>{
    const begin=first(arm,'fault-begin'),index=arm.journal.indexOf(begin),ordinal=begin.ordinal+1;
    for(const event of arm.journal)if(event.ordinal>=ordinal)event.ordinal++;
    for(const slice of arm.slices)if(slice.journalEndOrdinal>=ordinal)slice.journalEndOrdinal++;
    arm.journal.splice(index+1,0,{kind:'attempt',cursor:{cs:8,eip:0x7f58},
      tick:begin.tick,ordinal});
  },/executed handler/);
});

test('rejects absent PTE/repaired PTE, lost retry, or premature IRQ',()=>{
  rejects(arm=>{first(arm,'pte5-read').bytes='03500000';},/absent\/repaired PTE5/);
  rejects(arm=>{arm.journal.filter(e=>e.kind==='pte5-read')[1].bytes='02500000';},
    /absent\/repaired PTE5/);
  rejects(arm=>{const retry=arm.journal.filter(e=>e.kind==='attempt'&&
    e.cursor.eip===0x7ee8)[1];arm.journal.splice(arm.journal.indexOf(retry),1);},
  /guest handler\/CR3 reload\/IRETD\/retry/);
  rejects(arm=>{first(arm,'irq-ack').entry.eip=0x7f17;},/irq\[0\].ack/);
});

test('rejects a lost pending CLI IRQ and malformed fault-cut flags',()=>{
  rejects(arm=>{arm.slices.find(s=>s.reason==='fault').after.pendingIrq=false;},
    /CLI IRQ pending/);
  rejects(arm=>{arm.slices.find(s=>s.reason==='fault').after.pendingFault=1;},
    /boolean required/);
  rejects(arm=>{arm.slices.find(s=>s.reason==='fault').after.ifFlag=true;},
    /CLI IRQ pending/);
  rejects(arm=>{arm.slices.find(s=>s.reason==='fault').after.irqDeliveries=1;},
    /CLI IRQ pending|count discontinuity/);
});

test('rejects final paging state and a matching-looking corrupt store',()=>{
  rejects(arm=>{arm.final.selectedState.cr0&=~0x80000000;},
    /terminal selected CPU state/);
  rejects(arm=>{first(arm,'write').tick++;},/charged tick ledger/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x5000).bytes='00000000';},
    /failed store wrote data/);
});

test('rejects deadline, REP write, and tick budget drift',()=>{
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0xb004).bytes='01000000';},
    /REP write coverage/);
  rejects(arm=>{arm.slices.find(s=>s.reason==='event-due').reason='budget';},
    /fault\/event\/IRQ\/HLT inventory/);
  rejects(arm=>{arm.slices[0].chargedTicks=arm.slices[0].effectiveTicks+1;},
    /budget invalid/);
  rejects(arm=>{first(arm,'tick').preTick++;},/tick schedule/);
});

test('rejects IRQ shadow, frame, idle, and marker corruption',()=>{
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x530&&
    e.bytes==='01').bytes='00';},/STI successor/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='write'&&e.address===0x6ffc&&
    e.ordinal>first(arm,'irq-ack').ordinal).bytes='00000000';},
  /ACK-frame-delivery/);
  rejects(arm=>{arm.journal.filter(e=>e.kind==='halt-idle')[4].pendingEvent&=~0x400;},
    /idle or eligible wake/);
  rejects(arm=>{arm.journal.find(e=>e.kind==='port').value='F'.charCodeAt(0);},
    /marker changed/);
});

test('BWS5 parser refuses a fabricated completion and absent seed pages',()=>{
  assert.throws(()=>parseArm('BWS5\tDEACTIVATE\tproof-complete\n','continuous',null),
    /deactivation lacks final proof/);
  assert.throws(()=>parseArm('BWS5\tSEEDPAGE\t0\t00\n','continuous',null),
    /misplaced page/);
  assert.throws(()=>parseArm('BWS4\tDEACTIVATE\tproof-complete\n','continuous',null),
    /no BWS5 records/);
});

test('exact fail-closed probe requires SIGABRT and its named guard',()=>{
  const raw='BWS5\tFAIL\tBochs-RAM-read-fallback\n';
  assert.deepEqual(failureProbe({code:null,signal:'SIGABRT',stderr:raw},'bochsRamRead'),
    {rejected:true,kind:'bochs-ram-read',observedFailure:'Bochs-RAM-read-fallback'});
  assert.throws(()=>failureProbe({code:null,signal:'SIGTERM',stderr:raw},'bochsRamRead'),
    /did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    'BWS5\tFAIL\tBochs-timer-fallback\n'},'bochsRamRead'),/exact active guard/);
});

test('full proof refuses missing source and activation evidence',()=>{
  assert.throws(()=>assertNativePagedEventsSelfParity({}),/missing schema/);
});

test('accepts the initial actual four-arm report as a mutation input',()=>{
  const result=assertNativePagedEventsSelfParity(actualReport);
  assert.equal(result.nativeTicks,4004);
  assert.equal(result.faults,1);
  assert.equal(result.irqDeliveries,2);
  assert.equal(result.haltIdleCuts,5);
  assert.deepEqual(result.slices,{continuous:16,budget1:4011,budget2:2008,budget257:30});
});

test('full report rejects missing or substituted source and media pins',()=>{
  rejectsReport(report=>{delete report.source.sourceHashes[
    'scripts/bochs-cpu3-native-paged-events/runtime.inc'];},/sourceHashes inventory/);
  rejectsReport(report=>{report.source.bochsRevision='0'.repeat(40);},/pinned Bochs/);
  rejectsReport(report=>{report.source.imageSha256='0'.repeat(64);},/pinned Bochs/);
});

test('full report rejects unequal arm seeds and missing API or guard evidence',()=>{
  rejectsReport(report=>{report.armSeeds.budget1.ramSha256='0'.repeat(64);},
    /armSeeds.budget1/);
  rejectsReport(report=>{delete report.apiProbes['due-now'];},/apiProbes keys/);
  rejectsReport(report=>{report.apiProbes['callback-reentry']='accepted';},
    /callback-reentry/);
  rejectsReport(report=>{delete report.probes.bochsTimer;},/probes keys/);
  rejectsReport(report=>{report.probes.bochsTimer.observedFailure='host-port-out';},
    /probes.bochsTimer/);
});

test('full report rejects missing arms and cross-arm final or journal drift',()=>{
  rejectsReport(report=>{delete report.arms.budget2;},/arms keys/);
  rejectsReport(report=>{report.arms.budget1.final.selectedState.edx++;},
    /budget1.final/);
  rejectsReport(report=>{report.arms.budget257.journal.find(e=>
    e.kind==='port').value++;},/marker changed/);
});
