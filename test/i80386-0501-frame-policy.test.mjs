import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {create0501Policy} from '../scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs';
import {admitFreshWrapper,compareWrapperSnapshot} from '../scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs';

const wrapper=Object.freeze({schema:'bw.cwsdpmi-0501.wrapper-comparison.v1',
  address:0x5700,bytes:0x30});
function fixture(override={}) {
  let phase='armed', armCount=0, drainCount=0, activeSteps=2;
  const entry={source:'decoded-software-int31',vector:0x31,width:32,
    instructionStart:0x571e,entryAx:0x0501,entryBx:0,entryCx:4096,returnCs:0xa7,
    returnEip:0x5720,returnSs:0xaf,returnEsp:0x2000,
    frameLinear:0x123450,frameBytes:20,savedFlags:0x202,
    oldCpl:3,newCpl:0,gateType:14,handlerCs:0x8,handlerEip:0x200,
    handlerSs:0x10,handlerEsp:0x3000};
  const returned={source:'decoded-protected-iret',width:32,
    returnedBx:0x4a,returnedCx:0,
    handlerCs:entry.handlerCs,handlerSs:entry.handlerSs,
    handlerEsp:entry.handlerEsp,instructionStart:0x220,
    consumedCs:entry.returnCs,consumedEip:entry.returnEip,
    returnedCs:entry.returnCs,returnedEip:entry.returnEip,
    returnedSs:entry.returnSs,returnedEsp:entry.returnEsp,
    returnedCpl:3,consumedFrameLinear:entry.frameLinear,
    consumedFlags:0x202,returnedFlags:0x202};
  const cpu={
    armOwned0501FrameJournal(options) {
      armCount++;
      assert.deepEqual(options,{cs:0xa7,startEip:0x5700,endEip:0x5730,
        maxActiveSteps:1000000});
      return Object.freeze({});
    },
    owned0501FrameStatus(){return {phase,failure:phase==='invalid'?'synthetic-invalid':null,
      activeSteps};},
    takeOwned0501FrameObservation(){drainCount++;return {phase,
      failure:phase==='invalid'?'synthetic-invalid':null,activeSteps,entry,returned};},
  };
  return {cpu,entry,returned,
    policy:create0501Policy(cpu),
    complete(){phase='complete';},invalid(steps=2){phase='invalid';activeSteps=steps;},
    counts(){return {armCount,drainCount};}, ...override};
}
const arm=f=>f.policy.arm({mainCut:true,comparison:wrapper,cs:0xa7});
const finish=f=>f.policy.finish({clientPassed:true,diagnostic:{address:0x4a0000}});

test('one complete CPU-owned pair is required before client result',()=>{
  const f=fixture();
  assert.equal(arm(f).phase,'armed');
  assert.equal(f.policy.afterStep().phase,'armed');
  assert.equal(f.policy.finish({clientPassed:true,diagnostic:{address:0x4a0000}}).phase,'invalid');
  assert.deepEqual(f.counts(),{armCount:1,drainCount:0});
});
test('drains one committed pair after step and compares returned address and CF',()=>{
  const f=fixture();arm(f);f.complete();
  assert.equal(f.policy.afterStep().phase,'complete');
  assert.equal(f.policy.afterStep().phase,'complete');
  assert.equal(finish(f).phase,'passed');
  assert.deepEqual(f.counts(),{armCount:1,drainCount:1});
});
test('invalid CPU observation cannot be rescued by client output or second arm',()=>{
  const f=fixture();arm(f);f.invalid();
  assert.equal(f.policy.afterStep().phase,'invalid');
  assert.equal(finish(f).phase,'invalid');
  assert.equal(arm(f).phase,'invalid');
  assert.deepEqual(f.counts(),{armCount:1,drainCount:1});
});
test('preserves CPU reset and active-step-cap invalidation counters',()=>{
  const reset=fixture();arm(reset);reset.invalid(0);
  assert.deepEqual(reset.policy.afterStep(),
    {phase:'invalid',firstFailure:'synthetic-invalid'});
  const cap=fixture();arm(cap);cap.invalid(1000001);
  assert.deepEqual(cap.policy.afterStep(),
    {phase:'invalid',firstFailure:'synthetic-invalid'});
});
test('refuses inconsistent status and drained counters',()=>{
  let reads=0;
  const cpu={armOwned0501FrameJournal:()=>({}),
    owned0501FrameStatus:()=>({phase:'complete',failure:null,activeSteps:2}),
    takeOwned0501FrameObservation:()=>({phase:'complete',failure:null,
      activeSteps:++reads,entry:{},returned:{}})};
  const policy=create0501Policy(cpu);
  policy.arm({mainCut:true,comparison:wrapper,cs:0xa7});
  assert.equal(policy.afterStep().firstFailure,'cpu-drain-mismatch');
});
test('refuses pre-main or forged opportunity and does not arm',()=>{
  const f=fixture();
  assert.equal(f.policy.arm({mainCut:false,comparison:wrapper,cs:0xa7}).phase,'invalid');
  assert.deepEqual(f.counts(),{armCount:0,drainCount:0});
  const g=fixture();
  assert.equal(g.policy.arm({mainCut:true,comparison:{...wrapper,bytes:0},cs:0xa7}).phase,'invalid');
});
test('distinct valid diagnostic and returned BX:CX are refused',()=>{
  const f=fixture();arm(f);f.complete();f.policy.afterStep();
  assert.equal(f.policy.finish({clientPassed:true,diagnostic:{address:0x4b0000}}).phase,'invalid');
  const g=fixture();arm(g);g.complete();g.policy.afterStep();
  g.returned.returnedFlags=0x203;
  assert.equal(finish(g).phase,'invalid');
});
test('decoded instruction must fit the admitted wrapper including prefixes',()=>{
  const f=fixture();arm(f);f.complete();f.policy.afterStep();
  f.entry.instructionStart=0x572f;
  f.entry.returnEip=0x5731;
  assert.equal(finish(f).phase,'invalid');
});
test('missing frame context cannot pass via undefined equality',()=>{
  const f=fixture();arm(f);f.complete();f.policy.afterStep();
  delete f.entry.handlerSs;
  delete f.returned.handlerSs;
  assert.equal(finish(f).phase,'invalid');
  const g=fixture();arm(g);g.complete();g.policy.afterStep();
  g.returned.consumedEip=0x5721;
  assert.equal(finish(g).phase,'invalid');
  const h=fixture();arm(h);h.complete();h.policy.afterStep();
  h.entry.handlerCs=0xb;
  h.returned.handlerCs=0xb;
  assert.equal(finish(h).phase,'invalid');
});
test('reentrant arm from CPU admission poisons the outer operation',()=>{
  let policy;
  const cpu={
    armOwned0501FrameJournal(){
      assert.equal(policy.arm({mainCut:true,comparison:wrapper,cs:0xa7}).phase,'invalid');
      return {};
    },
    owned0501FrameStatus(){throw new Error('must not poll');},
    takeOwned0501FrameObservation(){throw new Error('must not drain');},
  };
  policy=create0501Policy(cpu);
  assert.equal(policy.arm({mainCut:true,comparison:wrapper,cs:0xa7}).phase,'invalid');
  assert.equal(policy.status().firstFailure,'policy-reentry');
});
test('saved, consumed and actual returned flags remain distinct diagnostics',()=>{
  const f=fixture();arm(f);f.complete();f.policy.afterStep();
  f.entry.savedFlags=0x203;
  f.returned.consumedFlags=0x40202;
  const result=finish(f);
  assert.deepEqual([result.entrySavedFlags,result.returnConsumedFlags,
    result.actualReturnedFlags],[0x203,0x40202,0x202]);
  const g=fixture();arm(g);g.complete();g.policy.afterStep();
  g.returned.consumedFlags=0x203;
  assert.equal(finish(g).phase,'invalid');
});

test('admitted wrapper bytes survive public-layout mutation on exact and mismatch paths',()=>{
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const exe=Buffer.alloc(4096),coff=512,raw=128,textAt=0x1000,textSize=0x800;
  exe.write('MZ');exe.writeUInt16LE(1,4);exe.writeUInt16LE(4,8);
  exe.writeUInt16LE(0x14c,coff);exe.writeUInt16LE(1,coff+2);
  exe.writeUInt16LE(28,coff+16);exe.writeUInt16LE(0x102,coff+18);
  exe.writeUInt16LE(0x010b,coff+20);
  const sh=coff+48;exe.write('.text',sh);
  exe.writeUInt32LE(textAt,sh+8);exe.writeUInt32LE(textAt,sh+12);
  exe.writeUInt32LE(textSize,sh+16);exe.writeUInt32LE(raw,sh+20);
  exe.writeUInt32LE(0x20,sh+36);
  for(let i=0;i<textSize;i++)exe[coff+raw+i]=i%251;
  const specs=[
    ['main','main',0x1400,0x100,'client.o','.text.startup'],
    ['allocateMemory','__dpmi_allocate_memory',0x1100,0x40,'libc.a(d0501.o)','.text'],
    ['allocateLdt','__dpmi_allocate_ldt_descriptors',0x1140,0x30,'libc.a(d0000.o)','.text'],
    ['setBase','__dpmi_set_segment_base_address',0x1170,0x30,'libc.a(d0007.o)','.text'],
    ['setLimit','__dpmi_set_segment_limit',0x11a0,0x30,'libc.a(d0008.o)','.text'],
    ['simulateInt','__dpmi_int',0x11d0,0x90,'libc.a(d0300_z.o)','.text'],
    ['freeLdt','__dpmi_free_ldt_descriptor',0x1260,0x30,'libc.a(d0001.o)','.text'],
    ['freeMemory','__dpmi_free_memory',0x1290,0x30,'libc.a(d0502.o)','.text'],
    ['getBase','__dpmi_get_segment_base_address',0x12c0,0x30,'libc.a(d0006.o)','.text'],
    ['getLimit','__dpmi_get_segment_limit',0x12f0,0x20,'libc.a(dpmi_lsl.o)','.text'],
  ];
  const map=Buffer.from('.text 0x1000 0x800\n'+specs.map(([,symbol,at,n,member,section])=>
    ` ${section} 0x${at.toString(16)} 0x${n.toString(16)} /owned/${member}\n`+
    `  0x${at.toString(16)} ${symbol}\n`).join(''));
  const compile={schema:'bw.cwsdpmi-owned.compile-only.v1',
    status:'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION',
    ownedSource:{path:'scripts/i80386-cwsdpmi-highmem-timer/client.c',
      sha256:'77b41b9c9633d8fea932786230ee24facc8d05549a8912a36afb0f55b71afc07'},
    toolchain:{sha256:'8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'},
    sourceArchives:{
      'djcrx205.zip':{sha256:'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'},
      'djdev205.zip':{sha256:'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'},
      'djlsr205.zip':{sha256:'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'}},
    compileArgv:['/owned/i586-pc-msdosdjgpp-gcc','-std=gnu11','-O2','-march=i386',
      '-mtune=i386','-Wall','-Wextra','-Werror','-fno-lto','-c','client.c','-o','client.o'],
    linkArgv:['/owned/i586-pc-msdosdjgpp-gcc','-march=i386','-mtune=i386',
      '-Wl,-Map,client.map','-o','client.exe','client.o'],
    resolvedImplicitRoles:Object.fromEntries(['assembler','linker','stubify','crt0.o','libc.a','libgcc.a']
      .map(name=>[name,{admitted:true}])),
    executable:{bytes:exe.length,sha256:sha(exe),uploaded:false},
    map:{bytes:map.length,sha256:sha(map)}};
  const {layout,token}=admitFreshWrapper(exe,map,compile);
  const copied=Buffer.from(exe.subarray(coff+raw,coff+raw+textSize));
  const exact=compareWrapperSnapshot(token,copied);
  assert.equal(exact.wholeText,'EXACT');
  layout.roles.allocateMemory.address=0x1400;
  layout.textBytes.fill(0);
  layout.text.address=0x1234;
  assert.equal(compareWrapperSnapshot(token,copied).wholeText,'EXACT');
  const runtime=Buffer.from(copied);runtime[0x500]^=1;
  assert.equal(compareWrapperSnapshot(token,runtime).wholeText,'DIFFERS');
  runtime[0x100]^=1;
  assert.throws(()=>compareWrapperSnapshot(token,runtime),/wrapper code differs/);
  assert.throws(()=>compareWrapperSnapshot({},copied),/unadmitted/);
});
