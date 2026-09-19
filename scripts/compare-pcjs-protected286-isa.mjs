/** Compare the bounded protected ISA guest with an exact clean PCjs checkout.
 * PCJS_ROOT=/path/to/pinned/pcjs node scripts/compare-pcjs-protected286-isa.mjs
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ProtectedI80286 from '../src/experimental/i80286-protected.js';

const PIN='c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70',root=process.env.PCJS_ROOT;
if(!root)throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs must match the exact clean oracle pin');
const moduleURL=name=>pathToFileURL(resolve(root,`machines/pcx86/modules/v2/${name}.js`)).href;
for(const name of ['x86func','x86help','x86mods','x86op0f','x86ops'])await import(moduleURL(name));
const{default:CPU}=await import(moduleURL('cpux86')),{default:Bus}=await import(moduleURL('bus')),{default:Memory}=await import(moduleURL('memory'));
class QuietBus extends Bus{printf(){return 0;}}
const hash=data=>createHash('sha256').update(data).digest('hex');
const put=(write,at,bytes)=>bytes.forEach((value,i)=>write(at+i,value));
function install(write){
  put(write,0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  put(write,0x100,[0x1f,0,0,2,0]);
  const descriptor=(at,base,access)=>put(write,at,[0xff,0xff,base&255,(base>>8)&255,(base>>16)&255,access,0,0]);
  descriptor(0x208,0x100000,0x9a);descriptor(0x210,0x120000,0x92);descriptor(0x218,0x130000,0x92);
  put(write,0x100000,[
    0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,0xbc,0,2,
    0xbb,0x20,0,0xbe,4,0,0xc7,0x40,2,1,0,0xb9,5,0,
    0x01,0x48,2,0xe2,0xfb,0xe8,1,0,0xf4,0xff,0x40,2,0xc3]);
}
const word=read=>(read(0x120026)|(read(0x120027)<<8));
function actual(){
  const memory=new Uint8Array(1<<24),cpu=new ProtectedI80286({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>{memory[a]=v;}});
  install((a,v)=>{memory[a]=v;});cpu.cs=0;cpu.ip=0;
  for(let i=0;i<27;i++)cpu.step();
  return{ax:cpu.ax,bx:cpu.bx,cx:cpu.cx,si:cpu.si,sp:cpu.sp,cs:cpu.cs,ds:cpu.ds,ss:cpu.ss,ip:cpu.ip,
    flags:cpu.flags&0x7fd5,halted:cpu.halted,result:word(a=>memory[a])};
}
function reference(){
  const cpu=new CPU({id:'protected286.isa.cpu',model:80286}),bus=new QuietBus({id:'protected286.isa.bus',busWidth:24},cpu);
  if(!bus.addMemory(0,1<<24,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');
  cpu.bus=bus;install((a,v)=>bus.setByteDirect(a,v));cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);cpu.setSS(0);cpu.setSP(0);cpu.setPS(2);
  for(let i=0;i<27;i++)cpu.stepCPU(0);
  return{ax:cpu.regEAX&0xffff,bx:cpu.regEBX&0xffff,cx:cpu.regECX&0xffff,si:cpu.regESI&0xffff,sp:cpu.getSP(),
    cs:cpu.getCS(),ds:cpu.getDS(),ss:cpu.getSS(),ip:cpu.getIP(),flags:cpu.getPS()&0x7fd5,
    halted:true,result:word(a=>bus.getByteDirect(a))};
}
const expected=reference(),observed=actual(),differences=[];
for(const key of Object.keys(expected))if(JSON.stringify(expected[key])!==JSON.stringify(observed[key]))differences.push({field:key,reference:expected[key],actual:observed[key]});
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs provenance changed during comparison');
const sources=['./compare-pcjs-protected286-isa.mjs','../src/i8086.js','../src/experimental/i80286-protected.js'];
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,node:process.version,
  scope:'owned ring-0 arithmetic loop, 16-bit ModR/M high-memory RMW, near CALL/RET, and HLT; no timing, privilege, REP, or broad ISA claim',
  sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])),
  status:differences.length?'fail':'pass',reference:expected,actual:observed,differences},null,2));
process.exitCode=differences.length?1:0;
