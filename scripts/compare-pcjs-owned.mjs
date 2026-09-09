/** Optional external architectural oracle. No fetching, bundling, ROM or disk inputs.
 * PCJS_ROOT=/path/to/pinned/pcjs node scripts/compare-pcjs-owned.mjs
 */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {OWNED_ORACLE_PROBES,probeInitial} from './lib/x86-owned-oracle-probes.mjs';
import {localProbe} from './lib/x86-oracle-local.mjs';

const PIN='c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const root=process.env.PCJS_ROOT;if(!root)throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs must match the exact clean oracle pin');
const moduleURL=name=>pathToFileURL(resolve(root,`machines/pcx86/modules/v2/${name}.js`)).href;
for(const name of ['x86func','x86help','x86mods','x86op0f','x86ops'])await import(moduleURL(name));
const {default:CPU}=await import(moduleURL('cpux86'));
const {default:Bus}=await import(moduleURL('bus'));
const {default:Memory}=await import(moduleURL('memory'));
class QuietBus extends Bus {printf(){return 0;}}
const hash=b=>createHash('sha256').update(b).digest('hex');
const localSourceHashes=Object.fromEntries(['./compare-pcjs-owned.mjs','./lib/x86-owned-oracle-probes.mjs',
    './lib/x86-oracle-local.mjs','../src/i8086.js','../src/experimental/harris-80c286-boot-cpu.js']
    .map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))]));
const results=[];
for(const model of ['8086','80186','80286'])for(const probe of OWNED_ORACLE_PROBES) {
    if(!probe.models.includes(model))continue;
    // PCjs's documented 8088 model shares the architectural subset tested here.
    // This explicitly does not compare 8086/8088 bus width, prefetch or timings.
    const referenceModel=model==='8086'?8088:Number(model),cpu=new CPU({id:'oracle.cpu',model:referenceModel});
    const bus=new QuietBus({id:'oracle.bus',busWidth:referenceModel===80286?24:20},cpu);
    if(!bus.addMemory(0,1<<20,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');
    cpu.bus=bus;
    const initial=probeInitial(probe),r=initial.regs;
    cpu.setCS(r.cs);cpu.setIP(r.ip);cpu.setSS(r.ss);cpu.setSP(r.sp);cpu.setDS(r.ds);cpu.setES(r.es);
    for(const name of ['ax','bx','cx','dx','bp','si','di'])cpu[`regE${name.toUpperCase()}`]=r[name];
    cpu.setPS(r.flags);for(const [a,v] of initial.ram)bus.setByteDirect(a,v);
    cpu.stepCPU(0);
    const registers=Object.fromEntries(['ax','bx','cx','dx','bp','si','di'].map(name=>[name,cpu[`regE${name.toUpperCase()}`]&65535]));
    Object.assign(registers,{sp:cpu.getSP(),ip:cpu.getIP(),flags:cpu.getPS(),cs:cpu.segCS.sel,ds:cpu.segDS.sel,ss:cpu.segSS.sel,es:cpu.segES.sel});
    const expectedMemory=new Uint8Array(1<<20);for(let a=0;a<expectedMemory.length;a++)expectedMemory[a]=bus.getByteDirect(a);
    const actual=localProbe(model,probe),diffs=[];
    for(const [name,value] of Object.entries(registers)) {
        const mask=name==='flags'?probe.flagsMask:65535;
        if((value&mask)!==(actual.registers[name]&mask))diffs.push({register:name,reference:value,actual:actual.registers[name],mask});
    }
    for(let a=0;a<expectedMemory.length;a++)if(expectedMemory[a]!==actual.memory[a]) {
        diffs.push({address:a,reference:expectedMemory[a],actual:actual.memory[a]});if(diffs.length>=12)break;
    }
    results.push({model,referenceModel,probe:probe.name,status:diffs.length?'fail':'pass',flagsMask:probe.flagsMask,
        maskReason:probe.maskReason??'compare defined 16-bit status/control flags; exclude reserved bits',
        referenceMemorySHA256:hash(expectedMemory),actualMemorySHA256:hash(actual.memory),diffs});
    if(diffs.length)break;
}
if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('PCjs provenance changed during comparison');
const failed=results.some(r=>r.status==='fail');
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,node:process.version,localSourceHashes,scope:'owned single-instruction real-mode architectural probes; no timing/I/O/interrupt/protected-mode claim',
    counts:{pass:results.filter(r=>r.status==='pass').length,fail:results.filter(r=>r.status==='fail').length},results},null,2));
process.exitCode=failed?1:0;
