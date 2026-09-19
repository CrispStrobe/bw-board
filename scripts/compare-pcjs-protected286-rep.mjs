/** Restartable protected REP fault-recovery oracle against exact pinned PCjs. */
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
const{default:X86}=await import(moduleURL('x86'));
class QuietBus extends Bus{printf(){return 0;}}
const hash=data=>createHash('sha256').update(data).digest('hex');
const put=(write,at,bytes)=>bytes.forEach((value,i)=>write(at+i,value));
function install(write){
  put(write,0,[0x0f,1,0x16,0,1,0x0f,1,0x1e,5,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  put(write,0x100,[0x2f,0,0,2,0,0xff,1,0,3,0]);
  const desc=(at,base,limit,access)=>put(write,at,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  desc(0x208,0x100000,0xffff,0x9a);desc(0x210,0x120000,0x11,0x92);
  desc(0x218,0x130000,0xffff,0x92);desc(0x220,0x140000,0xffff,0x92);desc(0x228,0,0xffff,0x92);
  put(write,0x300+13*8,[0,1,8,0,0,0x86,0,0]);
  put(write,0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,0xb8,0x20,0,0x8e,0xc0,
    0xbc,0,2,0xbe,0x10,0,0xbf,0x20,0,0xb9,2,0,0xf3,0xa5,0xf4]);
  put(write,0x100100,[0xb8,0x28,0,0x8e,0xd8,0xc7,0x06,0x10,0x02,0xff,0xff,
    0xb8,0x10,0,0x8e,0xd8,0x83,0xc4,2,0xcf]);
  put(write,0x120010,[0x11,0x22,0x33,0x44]);
}
const result=(cpu,read,recovered)=>({ax:(cpu.ax??cpu.regEAX)&0xffff,cx:(cpu.cx??cpu.regECX)&0xffff,
  si:(cpu.si??cpu.regESI)&0xffff,di:(cpu.di??cpu.regEDI)&0xffff,sp:(cpu.sp??cpu.getSP())&0xffff,
  cs:(cpu.cs??cpu.getCS())&0xffff,ds:(cpu.ds??cpu.getDS())&0xffff,ip:(cpu.ip??cpu.getIP())&0xffff,
  halted:cpu.halted??!!(cpu.intFlags&X86.INTFLAG.HALT),recovered,
  destination:Array.from({length:4},(_,i)=>read(0x140020+i))});
function local(){
  const memory=new Uint8Array(1<<24),cpu=new ProtectedI80286({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>{memory[a]=v;}},{deliverProtectedFaults:true});
  install((a,v)=>{memory[a]=v;});Object.assign(cpu,{cs:0,ip:0,ds:0,es:0,ss:0,sp:0x100,flags:2});
  let recovered=false;
  for(let i=0;i<80&&!cpu.halted;i++){cpu.step();if(cpu.cs===8&&cpu.ip===0x100)recovered=true;}
  return result(cpu,a=>memory[a],recovered);
}
function reference(){
  const cpu=new CPU({id:'protected286.rep.cpu',model:80286}),bus=new QuietBus({id:'protected286.rep.bus',busWidth:24},cpu);
  if(!bus.addMemory(0,1<<24,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');
  cpu.bus=bus;install((a,v)=>bus.setByteDirect(a,v));cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);cpu.setSS(0);cpu.setSP(0x100);cpu.setPS(2);
  let recovered=false;
  for(let i=0;i<80&&!(cpu.intFlags&X86.INTFLAG.HALT);i++){
    try{cpu.stepCPU(0);}catch(error){if(error!==13)throw error;}
    if(cpu.getCS()===8&&cpu.getIP()===0x100)recovered=true;
  }
  return result(cpu,a=>bus.getByteDirect(a),recovered);
}
const expected=reference(),observed=local(),mutation=process.env.REP_ORACLE_MUTATION??null,differences=[];
if(mutation!==null&&mutation!=='destination')throw new Error(`unknown REP_ORACLE_MUTATION: ${mutation}`);
const completion={cx:0,si:0x14,di:0x24,sp:0x200,cs:8,ds:0x10,ip:0x1e,halted:true,recovered:true,destination:[0x11,0x22,0x33,0x44]};
for(const [engine,state]of Object.entries({PCjs:expected,owned:observed}))for(const[key,value]of Object.entries(completion))
  if(JSON.stringify(state[key])!==JSON.stringify(value))throw new Error(`${engine} REP recovery did not complete: ${key}`);
if(mutation==='destination')observed.destination[0]^=1;
for(const key of Object.keys(expected))if(JSON.stringify(expected[key])!==JSON.stringify(observed[key]))differences.push({field:key,reference:expected[key],actual:observed[key]});
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs provenance changed during comparison');
const sources=['./compare-pcjs-protected286-rep.mjs','../src/i8086.js','../src/experimental/i80286-protected.js'];
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,node:process.version,
  scope:'owned ring-0 REP MOVSW with a delivered #GP, descriptor repair, IRET restart, and completion; architectural state only',
  sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])),mutation,
  status:differences.length?'fail':'pass',reference:expected,actual:observed,differences},null,2));
process.exitCode=differences.length?1:0;
