import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386Adapter} from '../src/i80386-adapter.js';
import {PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP as config} from '../src/experimental/i80386-at-machine.js';
import {createDebugGuestObserver,reconstructBefore,eligible,direct} from '../scripts/i80386-debug-guest/observer.mjs';

function fixture(){
 const adapter=createI80386Adapter({config});const machine=adapter.machine,rom=new Uint8Array(65536);rom.fill(0x90);machine.loadRom(rom,0xffff0000);machine.loadRom(rom,0xf0000);machine.reset();
 // Authored tiny protected32 flat NOP window; no BIOS/OS executed.
 const c=machine.cpu;c.cr0=1;c.cs=3;c.ss=3;c.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,readable:true,writable:false,dpl:3};c.eip=0;machine.mem.fill(0x90,0,128);c.eflags=2;
 return machine;
}
test('64 ordinary machine steps retire a bounded real protected32 ring3 window',()=>{
 const m=fixture(),observer=createDebugGuestObserver(m),cycles=m.cycles,cpu=m.cpu.cycles;
 for(let i=0;i<64;i++){observer.before(i);m.step();observer.retired(i);}
 const r=JSON.parse(observer.report());assert.equal(r.complete,true);assert.equal(r.instructionEvents,64);assert.equal(r.ring3Retirements,64);assert.equal(m.cpu.cycles-cpu,64);assert.equal(m.cycles-cycles,384);assert.equal(m.cpu.eip,64);assert.equal(r.closed,true);
});
test('observer reads preserve direct state and cleanup is once-only',()=>{
 const m=fixture(),before=direct(m),observer=createDebugGuestObserver(m);observer.before(0);assert.deepEqual(direct(m),before);observer.finish();observer.finish();const r=JSON.parse(observer.report());assert.equal(r.closed,true);assert.equal(r.complete,false);assert.equal(m.cpu.eip,0);
});
test('IRQ before-state cannot be inferred from a prior user boundary',()=>{
 const event={registersAfter:{cr0:1,eflags:0x202,cpl:0,halted:false,csCacheDefault32:true,eip:0x80100000,csCacheBase:0},changes:{registers:{eip:{before:0x80001000,after:0x80100000}}}};
 assert.equal(eligible(reconstructBefore(event)),false);
});
test('IRET kernel-to-user after-state is not a ring3 instruction and zero before values are retained',()=>{
 const event={registersAfter:{cr0:1,eflags:0x202,cpl:3,halted:false,csCacheDefault32:true,eip:7,csCacheBase:0},changes:{registers:{cpl:{before:0,after:3},eflags:{before:0,after:0x202},eip:{before:0x80001000,after:7}}}};
 const pre=reconstructBefore(event);assert.equal(pre.cpl,0);assert.equal(pre.eflags,0);assert.equal(eligible(pre),false);
});
test('missing eligibility fails without changing original stepping',()=>{
 const m=fixture();m.cpu.cs=0;const o=createDebugGuestObserver(m),before=m.cpu.eip;o.before(0);m.step();o.retired(0);const r=JSON.parse(o.report());assert.equal(r.complete,false);assert.equal(r.started,false);assert.equal(m.cpu.eip,before+1);
});
function interruptFixture(){
 const m=fixture(),c=m.cpu;
 const descriptor=(access)=>[0xff,0xff,0,0,0,access,0xcf,0];
 c.gdtr={base:0x200,limit:0x2f};
 for(const [at,access] of [[0x208,0x9a],[0x210,0x92],[0x218,0xfa],[0x220,0xf2]])m.mem.set(descriptor(access),at);
 c.cs=0x1b;c.ss=0x23;c.esp=0x3000;c.eflags=0x202;
 c.segmentCaches[1]=c._ringCodeDescriptor(0x1b);c.segmentCaches[2]=c._ringStackDescriptor(0x23,3,{returnPath:true});
 c.tr={selector:0x28,base:0x600,limit:0x67,present:true,type:11};m.mem.set([0,0x20,0,0,0x10,0],0x604);
 c.idtr={base:0x800,limit:0x107};m.mem.set([0,0x10,8,0,0,0x8e,0,0],0x900);
 m.mem[0x1000]=0x90;m.mem[0x1001]=0xcf;
 return m;
}
test('ordinary machine IRQ-before-wrapper and real IRET retain kernel before-state',()=>{
 const m=interruptFixture(),o=createDebugGuestObserver(m);o.before(0);
 m._lapic[0x320/4]=32;m._lapicTimerPending=true;
 m.step();o.retired(0);
 assert.equal(m.cpu.currentPrivilegeLevel,0);assert.equal(m.cpu.eip,0x1001);
 o.before(1);m.step();o.retired(1);
 assert.equal(m.cpu.currentPrivilegeLevel,3);assert.equal(m.cpu.eip,0);
 const r=JSON.parse(o.report());
 const events=Buffer.from(r.eventsBase64,'base64').toString().trim().split('\n').map(s=>JSON.parse(s));
 const retired=events.filter(e=>e.kind==='instruction'&&e.phase==='retire');
 assert.equal(retired.length,2);assert.equal(reconstructBefore(retired[0]).cpl,0);
 assert.equal(reconstructBefore(retired[1]).cpl,0);assert.equal(retired[1].registersAfter.cpl,3);
 assert.equal(r.ring3Retirements,0);assert.equal(r.complete,false);
});
