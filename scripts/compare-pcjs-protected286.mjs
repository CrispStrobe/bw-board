/** Optional external oracle for the bounded protected-mode bootstrap.
 * PCJS_ROOT=/path/to/pinned/pcjs node scripts/compare-pcjs-protected286.mjs
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ProtectedI80286, {SEG_CS, SEG_DS} from '../src/experimental/i80286-protected.js';

const PIN = 'c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const root = process.env.PCJS_ROOT;
if (!root) throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
if (git('rev-parse','HEAD') !== PIN || git('status','--porcelain')) throw new Error('PCjs must match the exact clean oracle pin');
const moduleURL = name => pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ['x86func','x86help','x86mods','x86op0f','x86ops']) await import(moduleURL(name));
const {default:CPU} = await import(moduleURL('cpux86'));
const {default:Bus} = await import(moduleURL('bus'));
const {default:Memory} = await import(moduleURL('memory'));
class QuietBus extends Bus { printf() { return 0; } }

const hash = data => createHash('sha256').update(data).digest('hex');
const put = (write, at, bytes) => bytes.forEach((value, i) => write(at + i, value));
function install(write) {
    put(write, 0, [0x0f,0x01,0x16,0x00,0x01, 0xb8,0x01,0x00,
        0x0f,0x01,0xf0, 0xea,0x00,0x00,0x08,0x00]);
    put(write, 0x100, [0x17,0x00, 0x00,0x02,0x00]);
    const descriptor = (at, base, access) => put(write, at,
        [0xff,0xff, base&0xff,(base>>8)&0xff,(base>>16)&0xff,access,0,0]);
    descriptor(0x208, 0x100000, 0x9a); descriptor(0x210, 0x120000, 0x92);
    put(write, 0x100000, [0xb8,0x10,0x00, 0x8e,0xd8, 0xb8,0x34,0x12,
        0x89,0x06,0x20,0x00, 0x8b,0x1e,0x20,0x00, 0xf4]);
}

function actual() {
    const memory = new Uint8Array(1 << 24);
    const cpu = new ProtectedI80286({read:a=>memory[a], fetch:a=>memory[a], write:(a,v)=>{memory[a]=v;}});
    install((a,v)=>{memory[a]=v;}); cpu.cs=0; cpu.ip=0; cpu.ss=0; cpu.sp=0x100;
    for (let i=0; i<10; i++) cpu.step();
    return {cs:cpu.cs, ip:cpu.ip, ds:cpu.ds, bx:cpu.bx, pc:cpu.pc,
        csBase:cpu.segmentCaches[SEG_CS].base, dsBase:cpu.segmentCaches[SEG_DS].base,
        data:[memory[0x120020],memory[0x120021]], accessed:[memory[0x20d],memory[0x215]]};
}

function reference() {
    const cpu = new CPU({id:'protected286.cpu', model:80286});
    const bus = new QuietBus({id:'protected286.bus', busWidth:24}, cpu);
    if (!bus.addMemory(0, 1<<24, Memory.TYPE.RAM)) throw new Error('PCjs memory allocation failed');
    cpu.bus=bus; install((a,v)=>bus.setByteDirect(a,v));
    cpu.setCS(0); cpu.setIP(0); cpu.setDS(0); cpu.setES(0); cpu.setSS(0); cpu.setSP(0x100); cpu.setPS(2);
    for (let i=0; i<10; i++) cpu.stepCPU(0);
    return {cs:cpu.getCS(), ip:cpu.getIP(), ds:cpu.getDS(), bx:cpu.regEBX&0xffff,
        pc:(cpu.segCS.base+cpu.getIP())&0xffffff, csBase:cpu.segCS.base, dsBase:cpu.segDS.base,
        data:[bus.getByteDirect(0x120020),bus.getByteDirect(0x120021)],
        accessed:[bus.getByteDirect(0x20d),bus.getByteDirect(0x215)]};
}

const expected=reference(), observed=actual(), differences=[];
for (const key of Object.keys(expected)) if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key]))
    differences.push({field:key, reference:expected[key], actual:observed[key]});
if (git('rev-parse','HEAD') !== PIN || git('status','--porcelain')) throw new Error('PCjs provenance changed during comparison');
const sources=['./compare-pcjs-protected286.mjs','../src/i8086.js','../src/experimental/i80286-protected.js'];
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,node:process.version,
    scope:'owned ring-0 GDT-only LGDT/LMSW/far-JMP/high-memory/HLT bootstrap; no timing, gates, tasks, or privilege claim',
    sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])),
    status:differences.length?'fail':'pass',reference:expected,actual:observed,differences},null,2));
process.exitCode=differences.length?1:0;
