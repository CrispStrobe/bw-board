/** Bounded 80286 ring-0 IDT oracle against an exact clean PCjs revision. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ProtectedI80286 from '../src/experimental/i80286-protected.js';

const PIN = 'c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const root = process.env.PCJS_ROOT;
if (!root) throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
if (git('rev-parse', 'HEAD') !== PIN || git('status', '--porcelain'))
    throw new Error('PCjs must match the exact clean oracle pin');
const pcjsURL = name => pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ['x86func', 'x86help', 'x86mods', 'x86op0f', 'x86ops']) await import(pcjsURL(name));
const {default:CPU} = await import(pcjsURL('cpux86'));
const {default:Bus} = await import(pcjsURL('bus'));
const {default:Memory} = await import(pcjsURL('memory'));
class QuietBus extends Bus { printf() { return 0; } }

const CODE_BASE = 0x100000, STACK_BASE = 0x120000;
const hash = data => createHash('sha256').update(data).digest('hex');
const put = (write, at, bytes) => bytes.forEach((value, i) => write(at + i, value));
const words = (read, at, count) => Array.from({length:count}, (_, i) => read(at + i * 2) | (read(at + i * 2 + 1) << 8));

function install(write, {gateType, fault = false, targetSelector = 0x0008}) {
    // Real bytes: LGDT, LIDT, MOV AX,1, LMSW AX, far JMP 0008:0000.
    put(write, 0, [0x0f,0x01,0x16,0x00,0x01, 0x0f,0x01,0x1e,0x05,0x01,
        0xb8,0x01,0x00, 0x0f,0x01,0xf0, 0xea,0x00,0x00,0x08,0x00]);
    put(write, 0x100, [0x17,0x00,0x00,0x02,0x00, 0xff,0x01,0x00,0x03,0x00]);
    const descriptor = (at, base, access) => put(write, at,
        [0xff,0xff,base&0xff,(base>>8)&0xff,(base>>16)&0xff,access,0,0]);
    descriptor(0x208, CODE_BASE, 0x9a); descriptor(0x210, STACK_BASE, 0x92);
    const vector = fault ? 13 : 0x30, handler = fault ? 0x0120 : 0x0100;
    put(write, 0x300 + vector * 8,
        [handler&0xff,handler>>8,targetSelector&0xff,targetSelector>>8,0,0x80|gateType,0,0]);
    put(write, CODE_BASE, fault
        ? [0xb8,0x10,0x00, 0x8e,0xd0, 0x8e,0xd8, 0xbc,0x00,0x01,
            0xb8,0x18,0x00, 0x8e,0xd8, 0xf4]
        : [0xb8,0x10,0x00, 0x8e,0xd0, 0x8e,0xd8, 0xbc,0x00,0x01,
            0xcd,0x30, 0xf4]);
    // The fault handler saves the error in AX, replaces restart IP with 000f,
    // and returns to the HLT after the two-byte faulting MOV DS,AX.
    put(write, CODE_BASE + handler, fault ? [0x58,0x5b,0xbb,0x0f,0x00,0x53,0xcf] : [0xcf]);
}

function snapshot(cpu, read, error = false) {
    const sp = cpu.sp ?? cpu.getSP();
    const flags = cpu.flags ?? cpu.getPS();
    return {cs:(cpu.cs ?? cpu.getCS()) & 0xffff, ip:(cpu.ip ?? cpu.getIP()) & 0xffff,
        ss:(cpu.ss ?? cpu.getSS()) & 0xffff, sp:sp & 0xffff, flags:flags & 0xffff,
        frame:words(read, STACK_BASE + (sp & 0xffff), error ? 4 : 3)};
}

function recovery(cpu, step, snap, isHalted) {
    for (let i=0; i<5; i++) step();
    const returned={...snap(),errorRegister:(cpu.ax ?? cpu.regEAX)&0xffff,
        skippedIpRegister:(cpu.bx ?? cpu.regEBX)&0xffff};
    step();
    return {returned,halted:isHalted()};
}

function runLocal(options) {
    const memory = new Uint8Array(1 << 24);
    const cpu = new ProtectedI80286({read:a=>memory[a], fetch:a=>memory[a], write:(a,v)=>{memory[a]=v;}},
        {deliverProtectedFaults:true});
    install((a,v)=>{memory[a]=v;}, options);
    cpu.cs=0; cpu.ip=0; cpu.ds=0; cpu.es=0; cpu.ss=0; cpu.sp=0x100; cpu.flags=2;
    const handler = options.fault ? 0x0120 : 0x0100;
    for (let i=0; i<24 && cpu.ip !== handler; i++) {
        if (!options.fault && cpu.cs === 8 && cpu.ip === 10) cpu.flags |= 0x0200;
        cpu.step();
    }
    if (cpu.ip !== handler) throw new Error(`local executor did not reach handler ${handler.toString(16)}`);
    const entry = snapshot(cpu, a=>memory[a], options.fault);
    if (options.fault) return {entry,...recovery(cpu,()=>cpu.step(),()=>snapshot(cpu,a=>memory[a],false),()=>!!cpu.halted)};
    cpu.step();
    return {entry, returned:snapshot(cpu, a=>memory[a], false)};
}

function runPCjs(options) {
    const cpu = new CPU({id:`idt.${options.fault?'fault':options.gateType}`, model:80286});
    const bus = new QuietBus({id:`idt.bus.${options.fault?'fault':options.gateType}`, busWidth:24}, cpu);
    if (!bus.addMemory(0, 1<<24, Memory.TYPE.RAM)) throw new Error('PCjs memory allocation failed');
    cpu.bus=bus; install((a,v)=>bus.setByteDirect(a,v), options);
    cpu.setCS(0); cpu.setIP(0); cpu.setDS(0); cpu.setES(0); cpu.setSS(0); cpu.setSP(0x100); cpu.setPS(2);
    const handler = options.fault ? 0x0120 : 0x0100;
    let expectedFaultSignal = false;
    for (let i=0; i<24 && cpu.getIP() !== handler; i++) {
        if (!options.fault && cpu.getCS() === 8 && cpu.getIP() === 10) cpu.setPS(cpu.getPS() | 0x0200);
        try { cpu.stepCPU(0); }
        catch (error) {
            if (options.fault && error === 13 && cpu.getIP() === handler) expectedFaultSignal=true;
            else throw error;
        }
    }
    if (cpu.getIP() !== handler) throw new Error(`PCjs did not reach handler ${handler.toString(16)}`);
    if (options.fault && !expectedFaultSignal) throw new Error('PCjs did not expose its expected delivered-#GP signal');
    const entry = snapshot({getCS:()=>cpu.getCS(),getIP:()=>cpu.getIP(),getSS:()=>cpu.getSS(),getSP:()=>cpu.getSP(),getPS:()=>cpu.getPS()},
        a=>bus.getByteDirect(a), options.fault);
    if (options.fault) return {entry,...recovery(cpu,()=>cpu.stepCPU(0),()=>snapshot(
        {getCS:()=>cpu.getCS(),getIP:()=>cpu.getIP(),getSS:()=>cpu.getSS(),getSP:()=>cpu.getSP(),getPS:()=>cpu.getPS()},
        a=>bus.getByteDirect(a),false),()=>!!(cpu.intFlags&4))};
    cpu.stepCPU(0);
    return {entry, returned:snapshot({getCS:()=>cpu.getCS(),getIP:()=>cpu.getIP(),getSS:()=>cpu.getSS(),getSP:()=>cpu.getSP(),getPS:()=>cpu.getPS()},
        a=>bus.getByteDirect(a), false)};
}

const cases = {
    interruptGate:{options:{gateType:6}, reference:null, actual:null},
    trapGate:{options:{gateType:7}, reference:null, actual:null},
    generalProtection:{options:{gateType:6,fault:true}, reference:null, actual:null},
};
for (const value of Object.values(cases)) {
    value.reference=runPCjs(value.options); value.actual=runLocal(value.options); delete value.options;
}
// Intel's 286 gate contract ignores target-selector RPL.  This legal case is
// local-only because the pinned PCjs revision rejects selector 000b.
const selectorRpl = runLocal({gateType:6,targetSelector:0x000b});
const selectorRplExpected = {entryCS:0x0008, returnedCS:0x0008};
const selectorRplActual = {entryCS:selectorRpl.entry.cs, returnedCS:selectorRpl.returned.cs};

const mutation = process.env.IDT_ORACLE_MUTATION;
if (mutation === 'frame') cases.interruptGate.actual.entry.frame[0] ^= 1;
else if (mutation === 'if') cases.interruptGate.actual.entry.flags ^= 0x0200;
else if (mutation === 'restart') cases.generalProtection.actual.entry.frame[1] ^= 1;
else if (mutation) throw new Error(`unknown IDT_ORACLE_MUTATION ${mutation}`);
const differences=[];
for (const [name,value] of Object.entries(cases))
    if (JSON.stringify(value.reference) !== JSON.stringify(value.actual)) differences.push({case:name,reference:value.reference,actual:value.actual});
if (JSON.stringify(selectorRplExpected) !== JSON.stringify(selectorRplActual))
    differences.push({case:'targetSelectorRpl',reference:selectorRplExpected,actual:selectorRplActual});
const completionExpected={halted:true,cs:0x0008,ip:0x000f,sp:0x0100,errorRegister:0x0018,skippedIpRegister:0x000f};
const completion = Object.fromEntries([['pcjs',cases.generalProtection.reference],['local',cases.generalProtection.actual]].map(([engine,result])=>
    [engine,{halted:result.halted,cs:result.returned.cs,ip:result.returned.ip,sp:result.returned.sp,
        errorRegister:result.returned.errorRegister,skippedIpRegister:result.returned.skippedIpRegister}]));
for (const [engine,observed] of Object.entries(completion))
    if (JSON.stringify(completionExpected) !== JSON.stringify(observed))
        differences.push({case:`generalProtectionCompletion:${engine}`,reference:completionExpected,actual:observed});

if (git('rev-parse','HEAD') !== PIN || git('status','--porcelain')) throw new Error('PCjs provenance changed during comparison');
const localSources=['./compare-pcjs-protected286-idt.mjs','../src/i8086.js','../src/experimental/i80286-protected.js'];
const pcjsSources=['x86help','segx86','x86ops'];
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const executionRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,executionRevision,node:process.version,
    scope:'ring-0 16-bit 80286 interrupt/trap gates, same-ring IRET, delivered #GP frame; architectural state only',
    knownOracleLimitations:{provenance:'historical audit measurements at the same pinned PCjs revision; not rerun by this receipt',
        targetSelectorRpl:{graded:false,pcjsObserved:'selector 000b is rejected during gate delivery',
        manualExpected:'target selector RPL is ignored and visible CS is normalized to 0008',localObserved:selectorRplActual},
        stackFrameBoundary:{graded:false,pcjsObserved:{sp0000:'entry at fffa',sp0002:'wrapped entry at fffc',sp0004:'wrapped entry at fffe'},
            manualExpected:{sp0000:'entry at fffa',sp0002:'#SS before writes',sp0004:'#SS before writes'}}},
    sourceHashes:{...Object.fromEntries(localSources.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])),
        ...Object.fromEntries(pcjsSources.map(name=>[`pcjs:${name}.js`,hash(readFileSync(resolve(root,`machines/pcx86/modules/v2/${name}.js`)))]))},
    mutation:mutation||null,status:differences.length?'fail':'pass',cases,
    generalProtectionCompletion:{expected:completionExpected,observed:completion},
    selectorRpl:{reference:selectorRplExpected,actual:selectorRplActual},differences},null,2));
process.exitCode=differences.length?1:0;
