import {pathToFileURL} from 'node:url';
export const CODE=Uint8Array.from([0x40,0x89,0x06,0,0x20,0x8b,0x1e,0,0x20,0x01,0xd8,0xe9,0xf2,0xff]);
export function make(kind,CPU,Machine,config){
  if(!['core','at'].includes(kind))throw Error('fixed path');
  let interrupts=0;
  const machine=kind==='at'?new Machine({...config,clockHz:16000000},{onInterrupt:()=>{interrupts++;}}):null;
  const mem=machine?machine.mem:new Uint8Array(1<<20);mem.set(CODE);
  const cpu=machine?machine.cpu:new CPU({read:a=>mem[a&0xfffff],fetch:a=>mem[a&0xfffff],write:(a,v)=>{mem[a&0xfffff]=v;}});
  cpu.cs=0;cpu.eip=0;cpu.ds=0;cpu.ss=0x4000;cpu.esp=0xfffe;
  return {kind,mem,cpu,machine,interrupts:()=>interrupts};
}
export function observe(s,steps,charges){
  const {cpu:c,machine:m,mem}=s;
  if(c.halted||c.shutdown||c.lastFault||c._translationCacheEnabled!==(s.kind==='at')||c.cpuProfile!=='compatibility')throw Error('ordinary healthy CPU');
  const state={ax:c.eax&65535,bx:c.ebx&65535,ip:c.eip,word:mem[8192]|mem[8193]<<8};
  const value={schema:'bw.at-profile-child.v1',kind:s.kind,steps,charges,cpuCycles:c.cycles,state,ifEnabled:!!(c.eflags&512),interrupts:s.interrupts(),ordinarySettings:{translationCache:c._translationCacheEnabled,deliverFaults:c.deliverFaults,cpuProfile:c.cpuProfile},devices:null};
  if(m){
    const pit=m.chips.pit1,rtc=m.chips.rtc1;
    const pic=p=>({irr:p.irr,isr:p.isr,imr:p.imr,vectorBase:p.vectorBase,intActive:p.intActive});
    value.devices={machineCycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,appliedClocks:m.cycles-m._chipDebt,pitFraction:pit._frac,pitCounters:pit.counters.map(p=>({mode:p.mode,rw:p.rw,reload:p.reload,ce:p.ce,out:p.out,armed:p.armed,nullCount:p.nullCount,gate:p.gate})),pics:[pic(m.chips.pic1),pic(m.chips.pic2)],rtc:{cyclePhase:rtc.cyclePhase,periodicPhase:rtc.periodicPhase,registerB:rtc.ram[11],registerC:rtc.ram[12]},cga:{cycles:m.chips.cga1.cycles,frameCount:m.chips.cga1._frameCount,lastVretrace:m.chips.cga1._lastVretrace},keyboard:{commandByte:m._a20Controller.commandByte,queue:m._a20Controller.outputQueue.map(x=>({value:x.value,keyboard:x.keyboard})),scheduled:m._a20Controller.keyboardSchedule.length}};
  }
  return value;
}
export function execute(s,steps){let charges=0;for(let i=0;i<steps;i++)charges+=s.machine?s.machine.step():s.cpu.step();return observe(s,steps,charges);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3||!['core','at'].includes(process.argv[2]))throw Error('fixed path argument');
  const root=new URL('../../../source/',import.meta.url);
  const {default:CPU}=await import(new URL('src/experimental/i80386.js',root));
  const {default:Machine,PCAT80386_EXPERIMENTAL:config}=await import(new URL('src/experimental/i80386-at-machine.js',root));
  const setupBegin=process.hrtime.bigint();
  const s=make(process.argv[2],CPU,Machine,config);
  const setupEnd=process.hrtime.bigint();
  const begin=process.hrtime.bigint();const result=execute(s,1000000);const end=process.hrtime.bigint();
  result.setupNanoseconds=String(setupEnd-setupBegin);
  result.executionLoopNanoseconds=String(end-begin);
  console.log(JSON.stringify(result));
}
