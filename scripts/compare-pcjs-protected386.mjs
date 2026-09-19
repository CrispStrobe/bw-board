/** Compare an owned 32-bit protected-mode guest with pinned PCjs. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const PIN='c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70',root=process.env.PCJS_ROOT;
if(!root)throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs must match the exact clean oracle pin');
const moduleURL=name=>pathToFileURL(resolve(root,`machines/pcx86/modules/v2/${name}.js`)).href;
for(const name of ['x86func','x86help','x86mods','x86op0f','x86ops'])await import(moduleURL(name));
const{default:CPU}=await import(moduleURL('cpux86')),{default:Bus}=await import(moduleURL('bus')),{default:Memory}=await import(moduleURL('memory'));
const{default:X86}=await import(moduleURL('x86'));
class QuietBus extends Bus{printf(){return 0;}}
const hash=data=>createHash('sha256').update(data).digest('hex');
const put=(write,at,bytes)=>bytes.forEach((value,i)=>write(at+i,value));
const descriptor=(base,access)=>[0xff,0xff,base&255,(base>>>8)&255,(base>>>16)&255,access,0xcf,(base>>>24)&255];
function install(write){
  put(write,0,[0x0f,0x01,0x16,0,1,0x0f,0x20,0xc0,0x66,0x83,0xc8,1,0x0f,0x22,0xc0,0x66,0xea,0,0,0,0,8,0]);
  put(write,0x100,[0x17,0,0,2,0,0]);put(write,0x208,descriptor(0x100000,0x9a));put(write,0x210,descriptor(0x120000,0x92));
  put(write,0x100000,[0xb8,0x44,0x33,0x22,0x11,0xbb,0,2,0,0,0xb9,3,0,0,0,0xba,0x10,0,0,0,
    0x8e,0xda,0x8e,0xd2,0xbc,0,4,0,0,0x89,0x44,0x8b,8,0x83,0xc0,1,0x50,0x5a,0x49,0x75,0xfd,
    0xe8,1,0,0,0,0xf4,0x43,0xc3]);
}
function snapshot(cpu,read,halted){return{eax:cpu.regEAX>>>0,ebx:cpu.regEBX>>>0,ecx:cpu.regECX>>>0,edx:cpu.regEDX>>>0,
  esp:cpu.regESP>>>0,eip:cpu.getIP()>>>0,cs:cpu.getCS(),ds:cpu.getDS(),ss:cpu.getSS(),flags:cpu.getPS()&0x8d5,
  result:((read(0x120214))|(read(0x120215)<<8)|(read(0x120216)<<16)|(read(0x120217)*0x1000000))>>>0,halted};}
function actual(){const memory=new Uint8Array(1<<24),cpu=new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>{memory[a]=v;}});install((a,v)=>{memory[a]=v;});for(let i=0;i<80&&!cpu.halted;i++)cpu.step();return snapshot({regEAX:cpu.eax,regEBX:cpu.ebx,regECX:cpu.ecx,regEDX:cpu.edx,regESP:cpu.esp,getIP:()=>cpu.eip,getCS:()=>cpu.cs,getDS:()=>cpu.ds,getSS:()=>cpu.ss,getPS:()=>cpu.eflags},a=>memory[a],cpu.halted);}
function reference(){const cpu=new CPU({id:'protected386.cpu',model:80386}),bus=new QuietBus({id:'protected386.bus',busWidth:32},cpu);if(!bus.addMemory(0,1<<24,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');cpu.bus=bus;install((a,v)=>bus.setByteDirect(a,v));cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);cpu.setSS(0);cpu.setSP(0);cpu.setPS(2);for(let i=0;i<80&&!(cpu.intFlags&X86.INTFLAG.HALT);i++)cpu.stepCPU(0);return snapshot(cpu,a=>bus.getByteDirect(a),!!(cpu.intFlags&X86.INTFLAG.HALT));}
const referenceState=reference(),actualState=actual(),mutation=process.env.I386_ORACLE_MUTATION??null,differences=[];
if(mutation!==null&&mutation!=='result')throw new Error(`unknown I386_ORACLE_MUTATION: ${mutation}`);
for(const state of [referenceState,actualState])if(!state.halted||state.result!==0x11223344||state.ecx!==0||state.esp!==0x400)throw new Error('owned guest did not reach its completion contract');
if(mutation==='result')actualState.result^=1;
for(const key of Object.keys(referenceState))if(referenceState[key]!==actualState[key])differences.push({field:key,reference:referenceState[key],actual:actualState[key]});
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs provenance changed during comparison');
const sources=['./compare-pcjs-protected386.mjs','../src/experimental/i80386.js'];
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,node:process.version,scope:'owned flat ring-0 32-bit bootstrap, SIB store, arithmetic loop, stack, near CALL/RET and HLT; no timing, paging, privilege, exception, or broad ISA claim',sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])),mutation,status:differences.length?'fail':'pass',reference:referenceState,actual:actualState,differences},null,2));
process.exitCode=differences.length?1:0;
