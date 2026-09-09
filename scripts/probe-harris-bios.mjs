#!/usr/bin/env node
/** Diagnostic only. No disk, BIOS traps, hidden RAM initialization or boot acceptance. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildBios} from './build-bios.mjs';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';

const args=process.argv.slice(2);
const options=new Map();
for(let i=0;i<args.length;i+=2) {
    if(!['--max-clocks','--pic-mode','--ram-kib','--fdc-mode'].includes(args[i])||!args[i+1]||options.has(args[i])) {
        console.error('Usage: probe-harris-bios.mjs [--max-clocks N] [--pic-mode legacy-buffered|single-unbuffered] [--ram-kib 64..640] [--fdc-mode none|control]');process.exit(1);
    }
    options.set(args[i],args[i+1]);
}
const rawClocks=options.get('--max-clocks')??'20000',maxClocks=Number(rawClocks);
if(!/^\d+$/.test(rawClocks)||!Number.isSafeInteger(maxClocks)||maxClocks<1||maxClocks>1000000) {
    console.error('max-clocks must be 1..1000000');process.exit(1);
}
const picMode=options.get('--pic-mode')??'legacy-buffered';
const fdcMode=options.get('--fdc-mode')??'none';
const rawRAM=options.get('--ram-kib')??'640',ramKiB=Number(rawRAM);
if(!['none','control'].includes(fdcMode)||!['legacy-buffered','single-unbuffered'].includes(picMode)||!/^\d+$/.test(rawRAM)||ramKiB<64||ramKiB>640||ramKiB%64) {
    console.error('invalid PIC mode or RAM size');process.exit(1);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=['../rom/bios.asm','../src/experimental/harris-80c286-boot-cpu.js',
    '../src/experimental/digital-circuit.js',
    '../src/experimental/harris-80c286-memory-board.js','../src/experimental/harris-8259-adapter.js',
    '../src/experimental/harris-8254-adapter.js','../src/experimental/harris-fdc-adapter.js',
    '../src/upd765.js','./build-bios.mjs','./probe-harris-bios.mjs'];
// Capture provenance before the run; later worktree edits cannot relabel it.
const sourceHashes=Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL(p,import.meta.url)))]));
registerBusMemory();
const rom=buildBios({picMode}).bytes,pic=new Harris8259Adapter({enabled:true}),timer=new Harris8254Adapter({enabled:true});
const fdc=fdcMode==='control'?new HarrisFDCAdapter({enabled:true}):null;
const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,ramBytes:ramKiB*1024,textRAM:true,
    intrEnabled:true,ioEnabled:true,interruptDevice:pic,timerDevice:timer,fdcDevice:fdc});
const cpu=new HarrisBootCPU({enabled:true,board});let clocks=0,outcome;
try {
    cpu.initialize();
    while(clocks<maxClocks&&cpu.status==='running') {
        cpu.stepClock();clocks++;
        if(clocks%2000===0)console.error(JSON.stringify({clocks,retired:cpu.retired,cs:cpu.cs,ip:cpu.ip}));
    }
    outcome={status:cpu.status==='running'?'budget-exhausted':cpu.status};
} catch(error) {outcome={status:'fault',code:error.code??error.name,message:error.message};}
console.log(JSON.stringify({accepted:false,diagnosticOnly:true,maxClocks,completedClocks:clocks,outcome,
    configuration:{ramBytes:ramKiB*1024,textRAM:true,romLowAlias:true,picMode,fdcMode,timerClockHalfPeriod:8},
    romSHA256:hash(rom),sourceHashes,
    cs:cpu.cs,ip:cpu.ip,retired:cpu.retired,registers:cpu.inspect().registers,pic:pic.inspect(),timer:timer.inspect(),fdc:fdc?.inspect()??null,
    recentTransfers:board.bus.getTrace().entries.flatMap(e=>e.completion?[e.completion]:[]).slice(-12)},null,2));
// A diagnostic stop is never a passing boot test, including HLT or budget exhaustion.
process.exitCode=2;
