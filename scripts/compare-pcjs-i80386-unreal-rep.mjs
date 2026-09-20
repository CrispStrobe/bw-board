/** Compare a bounded 386 unreal-mode REP MOVSD sequence with pinned PCjs. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const PIN='c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const pcjsRoot=process.env.PCJS_ROOT;
if(!pcjsRoot)throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const pcjsGit=(...args)=>execFileSync('git',args,{cwd:pcjsRoot,encoding:'utf8'}).trim();
const verifyPcjs=()=>{if(pcjsGit('rev-parse','HEAD')!==PIN||pcjsGit('status','--porcelain'))
  throw new Error('PCjs must match the exact clean oracle pin');};
verifyPcjs();
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const localPaths=['scripts/compare-pcjs-i80386-unreal-rep.mjs','src/experimental/i80386.js'];
execFileSync('git',['diff','--quiet','HEAD','--',...localPaths],{cwd:repositoryRoot});
const executionRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
const hash=data=>createHash('sha256').update(data).digest('hex');
const sources=['./compare-pcjs-i80386-unreal-rep.mjs','../src/experimental/i80386.js'];
const sourceHashes=Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))]));
const moduleURL=name=>pathToFileURL(resolve(pcjsRoot,`machines/pcx86/modules/v2/${name}.js`)).href;
for(const name of ['x86func','x86help','x86mods','x86op0f','x86ops'])await import(moduleURL(name));
const {default:CPU}=await import(moduleURL('cpux86'));
const {default:Bus}=await import(moduleURL('bus'));
const {default:Memory}=await import(moduleURL('memory'));
const {default:X86}=await import(moduleURL('x86'));
class QuietBus extends Bus {printf(){return 0;}}

const mutation=process.env.I386_UNREAL_ORACLE_MUTATION??null;
if(mutation!==null&&mutation!=='result'&&mutation!=='budget')throw new Error(`unknown mutation ${mutation}`);
const stepLimit=mutation==='budget'?10:17000;
const SOURCE=0x20000,DEST=0x40000,BYTES=0x10004,DWORDS=BYTES>>>2,MEMORY_BYTES=0x60000;
const put=(write,at,bytes)=>bytes.forEach((value,index)=>write(at+index,value));
const descriptor=(write,at,base,limit,access,flags=0)=>put(write,at,[limit,limit>>>8,base,base>>>8,
  base>>>16,access,((limit>>>16)&15)|flags,base>>>24].map(value=>value&255));
function install(write){
  put(write,0,[0x0f,0x01,0x16,0x00,0x01,0x0f,0x20,0xc0,0x66,0x83,0xc8,0x01,
    0x0f,0x22,0xc0,0x66,0xea,0x20,0,0,0,8,0]);
  put(write,0x100,[0x17,0,0,2,0,0]);
  descriptor(write,0x208,0,0xffff,0x9a);
  descriptor(write,0x210,0,0xfffff,0x92,0x80);
  put(write,0x20,[0xb8,0x10,0,0x8e,0xd8,0x8e,0xc0,0x0f,0x20,0xc0,0x66,0x83,0xe0,0xfe,
    0x0f,0x22,0xc0,0xea,0x50,0,0,0]);
  put(write,0x50,[0x66,0xbe,SOURCE&255,(SOURCE>>>8)&255,(SOURCE>>>16)&255,SOURCE>>>24,
    0x66,0xbf,DEST&255,(DEST>>>8)&255,(DEST>>>16)&255,DEST>>>24,
    0x66,0xb9,DWORDS&255,(DWORDS>>>8)&255,(DWORDS>>>16)&255,DWORDS>>>24,
    0xfc,0x67,0x66,0xf3,0xa5,0xf4]);
  for(let i=0;i<BYTES;i++)write(SOURCE+i,(i*37+(i>>>8)+0x5a)&255);
}
const observe=(cpu,read,local)=>{
  const copied=Buffer.alloc(BYTES);for(let i=0;i<BYTES;i++)copied[i]=read(DEST+i);
  return {halted:local?cpu.halted:!!(cpu.intFlags&X86.INTFLAG.HALT),protectedMode:local?cpu.protectedMode:!!(cpu.regCR0&1),
    cs:local?cpu.cs:cpu.getCS(),eip:local?cpu.eip:cpu.getIP(),ds:local?cpu.ds:cpu.getDS(),es:local?cpu.es:cpu.getES(),
    dsLimit:local?cpu.segmentCaches[3].limit:cpu.segDS.limit,esLimit:local?cpu.segmentCaches[0].limit:cpu.segES.limit,
    esi:(local?cpu.esi:cpu.regESI)>>>0,edi:(local?cpu.edi:cpu.regEDI)>>>0,ecx:(local?cpu.ecx:cpu.regECX)>>>0,
    copiedSha256:hash(copied),boundary:[read(DEST+0xffff),read(DEST+0x10000),read(DEST+0x10003)]};
};
function runLocal(){
  const memory=new Uint8Array(MEMORY_BYTES);install((a,v)=>{memory[a]=v;});
  const cpu=new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>{memory[a]=v;}});
  for(let steps=0;steps<stepLimit&&!cpu.halted;steps++)cpu.step();
  return observe(cpu,a=>memory[a],true);
}
function runPCjs(){
  const cpu=new CPU({id:'unreal386.cpu',model:80386});
  const bus=new QuietBus({id:'unreal386.bus',busWidth:32},cpu);
  if(!bus.addMemory(0,MEMORY_BYTES,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');
  cpu.bus=bus;install((a,v)=>bus.setByteDirect(a,v));cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);
  cpu.setSS(0);cpu.setSP(0x800);cpu.setPS(2);
  for(let steps=0;steps<stepLimit&&!(cpu.intFlags&X86.INTFLAG.HALT);steps++)cpu.stepCPU(0);
  return observe(cpu,a=>bus.getByteDirect(a),false);
}
const reference=runPCjs(),actual=runLocal();
if(mutation==='result')actual.boundary[1]^=1;
const expected={halted:true,protectedMode:false,cs:0,eip:0x6a,ds:0x10,es:0x10,
  dsLimit:0xffffffff,esLimit:0xffffffff,esi:SOURCE+BYTES,edi:DEST+BYTES,ecx:0};
const differences=[];
for(const field of Object.keys(expected))for(const [side,value] of [['reference',reference],['actual',actual]])
  if(value[field]!==expected[field])differences.push({field:`${side}.${field}`,expected:expected[field],actual:value[field]});
if(reference.copiedSha256!==actual.copiedSha256)differences.push({field:'copiedSha256',reference:reference.copiedSha256,actual:actual.copiedSha256});
if(JSON.stringify(reference.boundary)!==JSON.stringify(actual.boundary))differences.push({field:'boundary',reference:reference.boundary,actual:actual.boundary});
verifyPcjs();execFileSync('git',['diff','--quiet','HEAD','--',...localPaths],{cwd:repositoryRoot});
if(execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim()!==executionRevision)
  throw new Error('local execution revision changed during comparison');
for(const path of sources)if(hash(readFileSync(new URL(path,import.meta.url)))!==sourceHashes[path])
  throw new Error(`local source changed during comparison: ${path}`);
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,executionRevision,
  scope:'software compatibility evidence for LGDT, PE entry, 4GiB DS/ES cache loading, PE exit, and address/operand-size REP MOVSD beyond 64KiB',
  sourceHashes,stepLimit,mutation,status:differences.length?'fail':'pass',expected,reference,actual,differences},null,2));
process.exitCode=differences.length?1:0;
