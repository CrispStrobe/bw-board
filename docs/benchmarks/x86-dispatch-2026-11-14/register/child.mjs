import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,arm,stepsText]=process.argv.slice(2),steps=Number(stepsText);
const {ExperimentalI80386ATMachine:Machine,PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP:config}=await import(pathToFileURL(root+'/src/experimental/i80386-at-machine.js'));
const {createI80386NativeDispatcher}=await import(pathToFileURL(root+'/src/experimental/i80386-native-dispatch.js'));
function make(){const m=new Machine(config);const put32=(a,v)=>{for(let i=0;i<4;i++)m._write386(a+i,v>>>(8*i)&255);};put32(0x1800,0x4007);put32(0x4000+0x120*4,0x120007);[0xb8,1,0,0,0,0x83,0xf8,2,0x75,0xf6].forEach((v,i)=>m._write386(0x120000+i,v));const c=m.cpu;c.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,present:true,code:true,readable:true,writable:false};c.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,present:true,code:false,readable:true,writable:true};c.cr0=0x80000001;c.cr3=0x1000;c.eip=0x80120000;c._translate(c.eip);m._chipDebt=0;m._chipDeadline=1000;return m;}
async function setup(){const m=make();const d=arm==='ordinary'?null:await createI80386NativeDispatcher(m,arm==='dispatch64'?{blockInstructions:64}:{});return {m,d};}
function run({m,d},n){let retired=0;while(retired<n)retired+=d?d.run(Math.min(64,n-retired)):(m.step(),1);return retired;}
const warm=await setup();run(warm,25000);const s=await setup();const cpuStart=process.cpuUsage(),start=process.hrtime.bigint();const retired=run(s,steps);const wallNs=String(process.hrtime.bigint()-start),cpu=process.cpuUsage(cpuStart);const m=s.m,c=m.cpu;
if(c.halted||c.shutdown||c.lastFault||c.eax!==1||c.eip!==0x80120000)throw Error('unexpected terminal CPU');
const semantic={retired,eax:c.eax,eip:c.eip,eflags:c.eflags,cpuCycles:c.cycles,machineCycles:m.cycles,chipDebt:m._chipDebt,chipDeadline:m._chipDeadline,ramSha256:createHash('sha256').update(m.mem).digest('hex'),pit:m.chips.pit1.counters.map(p=>({ce:p.ce,out:p.out})),rtc:{phase:m.chips.rtc1.cyclePhase,periodic:m.chips.rtc1.periodicPhase},pics:[m.chips.pic1,m.chips.pic2].map(p=>({irr:p.irr,isr:p.isr,imr:p.imr}))};
console.log(JSON.stringify({arm,steps,warmupSteps:25000,executionCpuSeconds:(cpu.user+cpu.system)/1e6,executionWallSeconds:Number(wallNs)/1e9,semantic,stats:s.d?.stats??null}));
