/** Ordinary JS cold reference. No native addon, source derivative or caller machine. */
import assert from 'node:assert/strict';
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {coldBoardConfig,coldBoardProfile,fixedColdBios,coldOutAllowed,coldInAllowed} from './board-profile.mjs';
import {repSites,admitRepElement,biosSha256} from './rep-policy.mjs';
const clone=v=>JSON.parse(JSON.stringify(v)),sha=b=>createHash('sha256').update(b).digest('hex');
const configurationText=JSON.stringify(coldBoardConfig);
export const coldReferenceSchema='bw.js-cold-bios.reference.v1';
export const coldCutNames=Object.freeze(['reset',...repSites.flatMap(r=>['rep-entry-'+r.eip.toString(16),'rep-exit-'+r.eip.toString(16)]),'before-AA-routine','after-command-aa','after-response-55','after-command-ab','after-response-0','before-F000-E16']);
export function coldCheckpointReached(cpu){return cpu.cs===0xf000&&cpu.eip===0xe16;}
export function validateColdProgress(frame){
 assert.ok(frame&&Number.isSafeInteger(frame.q)&&frame.q>=0&&frame.q<=400000,'bounded Q');
 assert.equal(typeof frame.done,'boolean');assert.ok(frame.chargedQuanta===0||frame.chargedQuanta===1);
 assert.equal(frame.done,frame.chargedQuanta===0,'zero Q only at checkpoint');
 assert.ok(Number.isSafeInteger(frame.portStart)&&frame.portStart>=0&&Number.isSafeInteger(frame.portCount)&&frame.portCount>=0&&frame.portStart+frame.portCount<=20000,'bounded port ownership');
 return frame;
}
export function validateRepRecord(r){
 const site=repSites.find(s=>s.eip===r?.siteEip);assert.ok(site,'known REP site');assert.equal(r.width,site.width);assert.equal(r.count,site.count);
 for(const phase of ['entry','exit'])assert.ok(Number.isSafeInteger(r[phase]?.q)&&r[phase].q>=0&&r[phase].q<=400000,'bounded REP Q');
 const entry=r.entry.cpu,exit=r.exit.cpu;
 assert.ok(admitRepElement({cs:entry.cs,csBase:entry.segmentCaches[1].base,cs32:entry.segmentCaches[1].default32,es:entry.es,esBase:entry.segmentCaches[0].base,es32:entry.segmentCaches[0].default32,pe:!!(entry.cr0&1),df:!!(entry.eflags&0x400),eip:entry.eip,cx:entry.ecx&65535,di:entry.edi&65535,eax:entry.eax,bytes:site.bytes}),'actual REP entry registers');
 assert.equal(entry.ecx&65535,site.count);assert.equal(entry.edi&65535,site.destination);assert.equal(r.elements.length,site.count);assert.equal(r.exit.q-r.entry.q,site.count);
 r.elements.forEach((e,i)=>{assert.equal(e.q,r.entry.q+i+1);assert.equal(e.cx,site.count-i-1);assert.equal(e.di,site.destination+(i+1)*site.width);assert.equal(e.eip,i+1===site.count?site.eip+site.bytes.length:site.eip);assert.equal(e.address,site.destination+i*site.width);assert.equal(e.beforeBytes.length,site.width);assert.equal(e.afterBytes.length,site.width);for(const b of [...e.beforeBytes,...e.afterBytes])assert.ok(Number.isInteger(b)&&b>=0&&b<=255);assert.deepEqual(e.afterBytes,Array.from({length:site.width},(_,k)=>(site.value>>>(8*k))&255));});
 assert.equal(exit.ecx&65535,0);assert.equal(exit.edi&65535,site.destination+site.count*site.width);assert.equal(exit.eip,site.eip+site.bytes.length);return r;
}
/** No-argument private machine; step is one ordinary completion or REP element.
 * checkpoint is deliberately separate so named-only capture does not serialize
 * a full CPU/board on every step. Returned records contain no live machine. */
export function createColdBiosJavascriptOracle(...args){
 assert.equal(args.length,0,'fixed oracle accepts no caller config/hooks');
 const rom=fixedColdBios(),ports=[],pages=new Map();let q=0,active=false,settled=false,closed=false;
 const m=new ExperimentalI80386ATMachine(JSON.parse(configurationText),{onPortAccess:e=>{
  assert.ok(active&&!closed,'actual PIO inside JS step');assert.ok(ports.length<coldBoardProfile.maxPortEvents,'port cap');assert.ok(e.dir==='in'||e.dir==='out');assert.equal(e.width??8,8,'actual byte PIO');
  assert.ok(e.dir==='out'?coldOutAllowed(e.port,1,e.value):coldInAllowed(e.port,1),'cold port domain');assert.ok(Number.isInteger(e.value)&&e.value>=0&&e.value<=255);
  ports.push({ordinal:ports.length+1,q:q+1,cycles:m.cycles,width:8,...e});
 }});
 m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();assert.equal(m.cycles,4);assert.equal(m._chipDebt,0);assert.equal(m.cpu.cycles,0);assert.equal(m._a20Enabled,true);
 const controller=m._a20Controller;assert.equal(controller.inputBusyCycles,12);assert.equal(controller.responseDelayCycles,32);assert.ok(!controller.mouse&&!controller.outputQueue.length&&!controller.keyboardSchedule.length&&!controller.delayedResponse);
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('cold reference forbids '+method);};
 const live=()=>assert.ok(!active&&!closed&&!settled,'paused live oracle');
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m)});
 const checkpoint=()=>{assert.ok(!active&&!closed);return snapshot();};
 return Object.freeze({
  checkpoint,
  position(){assert.ok(!active&&!closed);return {q,cs:m.cpu.cs,eip:m.cpu.eip};},
  step(){
   live();assert.ok(!m.cpu.halted&&!m.cpu.shutdown&&!(m.cpu.eflags&0x200),'no halt/shutdown/IF before checkpoint');
   const portStart=ports.length;if(coldCheckpointReached(m.cpu))return validateColdProgress({done:true,chargedQuanta:0,q,portStart,portCount:0});
   assert.ok(q<coldBoardProfile.totalQuanta,'checkpoint missing at Q cap');
   const site=repSites.find(s=>m.cpu.cs===0xf000&&m.cpu.eip===s.eip),beforeQ=q,start=m.cpu.pc>>>0;let rep=null;
   if(site){const cpu=m.cpu;assert.ok(admitRepElement({cs:cpu.cs,csBase:cpu.segmentCaches[1].base,cs32:cpu.segmentCaches[1].default32,es:cpu.es,esBase:cpu.segmentCaches[0].base,es32:cpu.segmentCaches[0].default32,pe:!!(cpu.cr0&1),df:!!(cpu.eflags&0x400),eip:cpu.eip,cx:cpu.ecx&65535,di:cpu.edi&65535,eax:cpu.eax,bytes:Array.from(rom.subarray(site.eip,site.eip+site.bytes.length))}),'live exact REP state');const address=cpu.edi&65535;rep={siteEip:site.eip,address,beforeBytes:Array.from(m.mem.subarray(address,address+site.width))};}
   active=true;try{m.step();}finally{active=false;}
   assert.equal(m.cpu.cycles,beforeQ+1,'one successful JS completion/REP element');q++;assert.equal(m.cycles,4+6*q);assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch&&!m.cpu.halted&&!m.cpu.shutdown&&!(m.cpu.eflags&0x200));
   assert.ok(m.cpu._instructionBytes>=1&&m.cpu._instructionBytes<=15);for(let k=0;k<m.cpu._instructionBytes;k++){const raw=(start+k)>>>0,rawPage=(raw&0xfffff000)>>>0,decodedPage=(m._decode386(raw)&0xfffff000)>>>0;pages.set(rawPage,decodedPage);}
   if(rep)Object.assign(rep,{q,cx:m.cpu.ecx&65535,di:m.cpu.edi&65535,eip:m.cpu.eip,afterBytes:Array.from(m.mem.subarray(rep.address,rep.address+site.width))});
   return validateColdProgress({done:false,chargedQuanta:1,q,portStart,portCount:ports.length-portStart,...(rep?{rep}: {})});
  },
  records(start=0){assert.ok(!active&&!closed);assert.ok(Number.isSafeInteger(start)&&start>=0&&start<=ports.length);return clone(ports.slice(start));},
  pageUsage(){assert.ok(!active&&!closed);return [...pages].sort((a,b)=>a[0]-b[0]).map(([raw,decoded])=>({raw,decoded}));},
  settleCheckpoint(){live();assert.ok(coldCheckpointReached(m.cpu),'settle only before E16');m._catchUpChips();settled=true;return {...snapshot(),ramSha256:sha(m.mem)};},
  close(){assert.ok(!active&&!closed);closed=true;}
 });
}
/** Optional synchronous observation; never configures device hooks. A visitor
 * can request a detached checkpoint, while the default capture keeps named cuts. */
export function captureColdReference(visitor){
 assert.ok(visitor===undefined||typeof visitor==='function','synchronous visitor');
 const o=createColdBiosJavascriptOracle(),cuts=[{name:'reset',...o.checkpoint()}],reps=[];let currentRep=null;
 try{
  while(true){
   const frame=o.step();if(frame.done)break;
   if(frame.rep){const site=repSites.find(r=>r.eip===frame.rep.siteEip);if(!currentRep){const entry=cuts.find(c=>c.name==='rep-entry-'+site.eip.toString(16));assert.ok(entry,'REP entry cut');currentRep={siteEip:site.eip,width:site.width,count:site.count,entry:{q:entry.q,cpu:entry.cpu},elements:[]};}assert.equal(currentRep.siteEip,site.eip);currentRep.elements.push(frame.rep);if(frame.rep.cx===0){const cut={name:'rep-exit-'+site.eip.toString(16),...o.checkpoint()};cuts.push(cut);currentRep.exit={q:cut.q,cpu:cut.cpu};validateRepRecord(currentRep);reps.push(currentRep);currentRep=null;}}
   if(frame.portCount){const added=o.records(frame.portStart);for(const event of added)if(event.port===0x64&&event.dir==='out'||event.port===0x60&&event.dir==='in')cuts.push({name:(event.dir==='out'?'after-command-':'after-response-')+event.value.toString(16),...o.checkpoint()});}
   // Inspect only cheap current instruction metadata, not full board snapshots.
   const position=o.position();const next=repSites.find(r=>position.cs===0xf000&&position.eip===r.eip);if(next&&!currentRep&&!reps.some(r=>r.siteEip===next.eip))cuts.push({name:'rep-entry-'+next.eip.toString(16),...o.checkpoint()});
   if(position.cs===0xf000&&position.eip===0x0cd0&&!cuts.some(c=>c.name==='before-AA-routine'))cuts.push({name:'before-AA-routine',...o.checkpoint()});
   if(visitor){const result=visitor(Object.freeze(frame),o.checkpoint);assert.ok(!result||typeof result.then!=='function','visitor cannot defer observation');}
  }
  assert.equal(currentRep,null);assert.deepEqual(reps.map(r=>r.siteEip),repSites.map(r=>r.eip));cuts.push({name:'before-F000-E16',...o.checkpoint()});const final=o.settleCheckpoint(),ports=o.records();
  const report={schema:coldReferenceSchema,scope:'Ordinary JS cold reset to before E16; authentication belongs to external before/after receipt; no native/performance claim',romSha256:biosSha256,configuration:JSON.parse(configurationText),q:final.q,cuts,reps,ports,codePages:o.pageUsage(),final,coverage:{namedSnapshots:true,perStepSnapshotArray:false,nativeCounters:false}};validateColdReference(report);return report;
 }finally{o.close();}
}
export function validateColdReference(r){
 assert.equal(r?.schema,coldReferenceSchema);assert.equal(r.romSha256,biosSha256);assert.deepEqual(r.configuration,JSON.parse(configurationText));assert.ok(Number.isSafeInteger(r.q)&&r.q>0&&r.q<=400000);assert.ok(Array.isArray(r.cuts));assert.deepEqual(r.cuts.map(c=>c.name),coldCutNames,'exact ordered named cuts');assert.equal(r.cuts[0].q,0);assert.equal(r.cuts.at(-1).q,r.q);
 let lastCutQ=0;for(const c of r.cuts){assert.ok(c.q>=lastCutQ,'monotonic named Q');lastCutQ=c.q;}
 for(const c of [...r.cuts,r.final]){assert.ok(Number.isSafeInteger(c.q)&&c.q>=0&&c.q<=r.q);assert.equal(c.cpu.cycles,c.q);assert.equal(c.board.cycles,4+6*c.q);assert.equal(c.cpu.halted,false);assert.equal(c.cpu.shutdown,false);assert.equal(c.cpu.eflags&0x200,0);assert.equal(c.board.a20Enabled,true);}
 assert.ok(coldCheckpointReached(r.final.cpu),'missing ordinary E16 checkpoint');assert.deepEqual(r.final.cpu,r.cuts.at(-1).cpu,'settlement changes devices, not CPU');assert.equal(r.final.q,r.q);assert.equal(r.final.board.debt,0);assert.match(r.final.ramSha256,/^[a-f0-9]{64}$/);assert.deepEqual(r.reps.map(s=>s.siteEip),repSites.map(s=>s.eip));r.reps.forEach(rep=>{validateRepRecord(rep);for(const phase of ['entry','exit']){const cut=r.cuts.find(c=>c.name==='rep-'+phase+'-'+rep.siteEip.toString(16));assert.equal(cut.q,rep[phase].q);assert.deepEqual(cut.cpu,rep[phase].cpu,'REP named cut bound to actual metadata');}});
 assert.ok(Array.isArray(r.ports)&&r.ports.length<=20000);let lastQ=0;for(const [i,p]of r.ports.entries()){assert.equal(p.ordinal,i+1);assert.ok(Number.isSafeInteger(p.q)&&p.q>=lastQ&&p.q>0&&p.q<=r.q);lastQ=p.q;assert.equal(p.width,8);assert.ok(p.dir==='out'?coldOutAllowed(p.port,1,p.value):p.dir==='in'&&coldInAllowed(p.port,1));assert.ok(Number.isInteger(p.value)&&p.value>=0&&p.value<=255);assert.equal(p.cycles,4+6*(p.q-1));}
 const controller=r.ports.filter(p=>p.port===0x64&&p.dir==='out'||p.port===0x60&&p.dir==='in');assert.deepEqual(controller.map(p=>[p.dir,p.port,p.value]),[['out',0x64,0xaa],['in',0x60,0x55],['out',0x64,0xab],['in',0x60,0]]);
 for(const [i,name]of ['after-command-aa','after-response-55','after-command-ab','after-response-0'].entries())assert.equal(r.cuts.find(c=>c.name===name).q,controller[i].q,'PIO named cut ownership');
 const beforeAa=r.cuts.find(c=>c.name==='before-AA-routine');assert.equal(beforeAa.cpu.cs,0xf000);assert.equal(beforeAa.cpu.eip,0xcd0);assert.ok(beforeAa.q<controller[0].q);
 assert.ok(Array.isArray(r.codePages)&&r.codePages.length>0&&r.codePages.length<=32);let previous=-1;for(const p of r.codePages){assert.ok(Number.isSafeInteger(p.raw)&&p.raw>=0&&p.raw<=0xfffff000&&(p.raw&4095)===0&&p.raw>previous);previous=p.raw;assert.ok(Number.isSafeInteger(p.decoded)&&(p.decoded&4095)===0&&(p.decoded>=0xf0000&&p.decoded<0x100000||p.decoded>=0xff0000&&p.decoded<0x1000000));}
 assert.deepEqual(r.coverage,{namedSnapshots:true,perStepSnapshotArray:false,nativeCounters:false});return r;
}
/** Explicit assets plus complete relative JS import closure, frozen current/Git.
 * Native derivatives/builds and unrelated docs are outside this JS execution. */
export function referenceSourceIdentity(){
 const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=args=>execFileSync('git',args,{cwd:root,maxBuffer:32<<20});assert.equal(git(['status','--porcelain']).toString().trim(),'','clean frozen reference');const revision=git(['rev-parse','HEAD']).toString().trim(),paths=new Set();
 const visit=p=>{assert.ok(!p.startsWith('../')&&!p.startsWith('/'));if(paths.has(p))return;const f=resolve(root,p);assert.ok(statSync(f).isFile()&&realpathSync(f)===f);const bytes=readFileSync(f);assert.equal(sha(bytes),sha(git(['show',revision+':'+p])),p);paths.add(p);if(/\.(mjs|js)$/.test(p))for(const m of bytes.toString().matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));};
 for(const p of ['scripts/bochs-cpu3-native-cold-bios/reference.mjs','scripts/bochs-cpu3-native-cold-bios/REFERENCE-SOURCE.md','test/i80386-cold-bios-reference-source.test.mjs','package.json','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(readFileSync(resolve(root,p)))]))};
}
