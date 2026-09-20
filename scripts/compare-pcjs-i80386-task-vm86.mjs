/** Compare a VM86 TSS/task-gate/NT-IRET roundtrip with pinned PCjs. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const PIN = 'c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const root = process.env.PCJS_ROOT;
if (!root) throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const verifyPin = () => {
  if (git('rev-parse', 'HEAD') !== PIN || git('status', '--porcelain'))
    throw new Error('PCjs must match the exact clean oracle pin');
};
verifyPin();
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const paths = ['scripts/compare-pcjs-i80386-task-vm86.mjs', 'src/experimental/i80386.js'];
const verifyLocal = () => execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...paths], { cwd: repo });
verifyLocal();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const hash = data => createHash('sha256').update(data).digest('hex');
const sources = ['./compare-pcjs-i80386-task-vm86.mjs', '../src/experimental/i80386.js'];
const sourceHashes = Object.fromEntries(sources.map(path => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
const moduleURL = name => pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ['x86func','x86help','x86mods','x86op0f','x86ops']) await import(moduleURL(name));
const { default: CPU } = await import(moduleURL('cpux86'));
const { default: Bus } = await import(moduleURL('bus'));
const { default: Memory } = await import(moduleURL('memory'));
class QuietBus extends Bus { printf() { return 0; } }

const mutation = process.env.I386_TASK_VM_ORACLE_MUTATION ?? null;
if (![null, 'result', 'budget'].includes(mutation)) throw new Error(`unknown mutation ${mutation}`);
const budget = mutation === 'budget' ? 10 : 40;
const put = (write, address, values) => values.forEach((value, index) => write(address + index, value & 0xff));
const word = (write, address, value) => put(write, address, [value, value >>> 8]);
const dword = (write, address, value) => put(write, address, [value, value >>> 8, value >>> 16, value >>> 24]);
const descriptor = (write, address, base, limit, access) => put(write, address, [
  limit,limit>>>8,base,base>>>8,base>>>16,access,(limit>>>16)&15,base>>>24,
]);
function task(write, base, values) {
  for (const [offset, value] of [[0x1c,values.cr3],[0x20,values.eip],[0x24,values.flags],
    [0x28,0x1111],[0x2c,0x2222],[0x30,0x3333],[0x34,0x4444],[0x38,values.esp],
    [0x3c,0x5555],[0x40,0x6666],[0x44,0x7777]]) dword(write, base + offset, value);
  for (const [offset, value] of [[0x48,values.es],[0x4c,values.cs],[0x50,values.ss],
    [0x54,values.ds],[0x58,values.fs],[0x5c,values.gs],[0x60,0]]) word(write, base + offset, value);
}
function install(write) {
  put(write, 0, [0x0f,0x01,0x16,0x80,0,0x0f,0x01,0x1e,0x86,0,0xb8,1,0,0x0f,0x01,0xf0,0xea,0,1,8,0]);
  put(write, 0x80, [0x2f,0,0,2,0,0]);
  put(write, 0x86, [0xff,7,0,8,0,0]);
  descriptor(write,0x208,0,0xffff,0x9a); descriptor(write,0x210,0,0xffff,0x92);
  descriptor(write,0x218,0x400,0x67,0x89); descriptor(write,0x220,0x500,0x67,0x89);
  descriptor(write,0x228,0x700,0x67,0x89);
  put(write,0x100,[0xb8,0x10,0,0x8e,0xd0,0x8e,0xd8,0x8e,0xc0,0xbc,0,8,
    0xb8,0x18,0,0x0f,0,0xd8,0xea,0,0,0x20,0,0xf4]);
  put(write,0x1000,[0xcd,0x20,0xb8,0x34,0x12,0xeb,0xfe]);
  put(write,0x180,[0xcf]);
  put(write,0x800+0x20*8,[0xaa,0xbb,0x28,0,0xcc,0xe5,0xdd,0xee]);
  task(write,0x500,{cr3:0,eip:0,flags:0x23202,esp:0x800,es:0x100,cs:0x100,ss:0x200,ds:0x300,fs:0x400,gs:0x500});
  task(write,0x700,{cr3:0,eip:0x180,flags:2,esp:0x900,es:0x10,cs:8,ss:0x10,ds:0x10,fs:0,gs:0});
}
function summarize(cpu, read, local, visited, reset = false) {
  const flags = local ? cpu.eflags : cpu.getPS();
  return { reset, completed: visited.handler && visited.returned && (local ? cpu.eip : cpu.getIP()) === 5,
    handler: visited.handler, returned: visited.returned, vm: !!(flags & 0x20000),
    cs: local ? cpu.cs : cpu.getCS(), eip: local ? cpu.eip : cpu.getIP(),
    tr: local ? cpu.tr.selector : cpu.segTSS.sel, ax: (local ? cpu.eax : cpu.regEAX) & 0xffff,
    vmBusy: read(0x225)&15, handlerBusy: read(0x22d)&15,
    vmBacklink: read(0x500)|(read(0x501)<<8), handlerBacklink: read(0x700)|(read(0x701)<<8) };
}
function runLocal() {
  const memory = new Uint8Array(0x2000), cpu = new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>memory[a]=v});
  install((a,v)=>memory[a]=v); const visited={handler:false,returned:false};
  for(let step=0;step<budget;step++){if(cpu.cs===8&&cpu.eip===0x180)visited.handler=true;if(visited.handler&&cpu.virtual8086)visited.returned=true;if(visited.returned&&cpu.eip===5)break;cpu.step();}
  return summarize(cpu,a=>memory[a],true,visited);
}
function runPCjs() {
  const cpu=new CPU({id:'taskvm.cpu',model:80386}),bus=new QuietBus({id:'taskvm.bus',busWidth:32},cpu);
  if(!bus.addMemory(0,0x2000,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');cpu.bus=bus;install((a,v)=>bus.setByteDirect(a,v));
  cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);cpu.setSS(0);cpu.setSP(0x800);cpu.setPS(2);const visited={handler:false,returned:false},trail=[];let reset=false;
  for(let step=0;step<budget;step++){const cs=cpu.getCS(),ip=cpu.getIP();trail.push(`${cs.toString(16)}:${ip.toString(16)}`);if(cs===8&&ip===0x180)visited.handler=true;if(visited.handler&&(cpu.getPS()&0x20000))visited.returned=true;if(visited.returned&&ip===5)break;try{cpu.stepCPU(0);}catch(error){reset=error===-1&&cpu.getCS()===0xf000&&cpu.getIP()===0xfff0&&cpu.segTSS.sel===0&&trail.at(-1)==='8:112';if(!reset)throw new Error(`PCjs abort ${String(error)} state=${cpu.getCS().toString(16)}:${cpu.getIP().toString(16)} flags=${(cpu.getPS()>>>0).toString(16)} tr=${cpu.segTSS.sel.toString(16)} trail=${trail.join(',')}`);break;}}
  return summarize(cpu,a=>bus.getByteDirect(a),false,visited,reset);
}
const reference=runPCjs(),actual=runLocal();if(mutation==='result')actual.ax^=1;
const expectedActual={reset:false,completed:true,handler:true,returned:true,vm:true,cs:0x100,eip:5,tr:0x20,ax:0x1234,vmBusy:11,handlerBusy:9,vmBacklink:0,handlerBacklink:0x20};
const expectedReference={reset:true,completed:false,handler:false,returned:false,vm:false,cs:0xf000,eip:0xfff0,tr:0};
const differences=[];for(const [side,observed,expected]of[['reference',reference,expectedReference],['actual',actual,expectedActual]])for(const field of Object.keys(expected))if(observed[field]!==expected[field])differences.push({field:`${side}.${field}`,expected:expected[field],actual:observed[field]});
verifyPin();verifyLocal();if(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()!==revision||sources.some(path=>hash(readFileSync(new URL(path,import.meta.url)))!==sourceHashes[path]))throw new Error('execution sources changed');
console.log(JSON.stringify({oracle:'PCjs',revision,pcjsRevision:PIN,scope:'local VM86 TSS entry, IDT task-gate protected handler, NT IRET VM return and exact completion; pinned PCjs exact reset limitation at VM task entry',sourceHashes,mutation,status:differences.length?'fail':'pass',expectedReference,expectedActual,reference,actual,differences},null,2));process.exitCode=differences.length?1:0;
