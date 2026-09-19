#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

import {I8086Machine,PCAT80286_BOOT} from '../src/i8086-machine.js';

const EXPECTED_ROM_SHA256='74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const DEFAULT_STEPS=2_000_000;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHash=file=>sha(fs.readFileSync(path.join(root,file)));
const romPath=process.env.AT_BIOS_ROM;
if(!romPath)throw new Error('AT_BIOS_ROM must name the external 64KiB IBM 5170 Rev1 ROM');
const rom=fs.readFileSync(romPath);
if(rom.length!==0x10000)throw new Error(`AT BIOS ROM must be 65536 bytes, got ${rom.length}`);
const romSha256=sha(rom);
if(romSha256!==EXPECTED_ROM_SHA256)
    throw new Error(`AT BIOS ROM SHA-256 mismatch: expected ${EXPECTED_ROM_SHA256}, got ${romSha256}`);
const stepLimit=process.env.AT_POST_STEPS===undefined?DEFAULT_STEPS:Number(process.env.AT_POST_STEPS);
if(!Number.isInteger(stepLimit)||stepLimit<1||stepLimit>10_000_000)
    throw new Error('AT_POST_STEPS must be an integer from 1 through 10000000');

const resetRequests=[];
const resetApplications=[];
const checkpoints=[];
let machine;
machine=new I8086Machine(PCAT80286_BOOT,{onPortAccess:event=>{
    if(event.dir==='out'&&event.port===0x64&&event.value===0xfe)
        resetRequests.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip});
    if(event.dir==='out'&&event.port===0x80&&event.value===0x30)
        checkpoints.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip});
}});
machine.loadRom(rom,0xf0000);
machine.loadRom(rom,0xff0000);
machine.reset();
const reset={cs:machine.cpu.cs,ip:machine.cpu.ip,pc:machine.cpu.pc,
    fetchPhysical:machine.cpu._codePhys(machine.cpu.ip)};
if(reset.cs!==0xf000||reset.ip!==0xfff0||reset.pc!==0xfffff0||reset.fetchPhysical!==0xfffff0)
    throw new Error(`80286 reset entry mismatch: ${JSON.stringify(reset)}`);

let steps=0;
machine.cpu.busTrace=[];
machine.step();
const firstFetchTrace=[...machine.cpu.busTrace];
machine.cpu.busTrace=null;
steps=1;
const progressSamples=[];
let stopReason=null;
for(;steps<stepLimit;steps++) {
    const requestsBefore=resetRequests.length;
    machine.step();
    if(resetRequests.length>requestsBefore)resetApplications.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        pc:machine.cpu.pc,cmosShutdown:machine.chips.rtc1.ram[0x0f]});
    if(steps%100_000===0)progressSamples.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        ax:machine.cpu.ax,bp:machine.cpu.bp,cx:machine.cpu.cx,es:machine.cpu.es,di:machine.cpu.di,
        esBase:machine.cpu.segmentCaches?.[0]?.base??null,
        dsBase:machine.cpu.segmentCaches?.[3]?.base??null});
    if(machine.cpu.shutdown||machine.cpu.halted) {
        stopReason=machine.cpu.shutdown?'cpu-shutdown':'cpu-halt';
        break;
    }
}
const mutation=process.env.AT_POST_MUTATION??null;
if(mutation!==null&&!['dma-checkpoint','reset-preservation'].includes(mutation))
    throw new Error(`unknown AT_POST_MUTATION ${mutation}`);
const gradedCheckpoints=mutation==='dma-checkpoint'
    ? checkpoints.map(event=>event.ip===0x0d9c?{...event,ip:0x0344}:event)
    : checkpoints;
const gradedApplications=mutation==='reset-preservation'
    ? resetApplications.map(event=>({...event,cmosShutdown:0})):resetApplications;
const post30=gradedCheckpoints.find(event=>event.cs===0xf000&&event.ip===0x0d9c);
const warmReset=gradedApplications.find(event=>event.cs===0xf000&&event.ip===0xfff0&&
    event.pc===0xfffff0&&event.cmosShutdown===1);
const passed=firstFetchTrace[1]===0xfffff0&&
    !!post30&&!!warmReset&&warmReset.step<post30.step&&
    !machine.cpu.halted&&!machine.cpu.shutdown;
const report={schema:'astra.at-bios-post.v1',passed,stepLimit,steps,
    scope:'bounded genuine-reset IBM 5170 Rev1 POST progression through checkpoint 30',
    diagnosticOnly:true,fullBootAccepted:false,mutation,stopReason,
    input:{name:'IBM 5170 Rev1 BIOS 1984-01-10',bytes:rom.length,sha256:romSha256,
        expectedSha256:EXPECTED_ROM_SHA256,distribution:'external; ROM bytes are not stored by this repository'},
    reset,firstFetchTrace,resetRequests,resetApplications,checkpoint30:checkpoints,
    final:{cs:machine.cpu.cs,ip:machine.cpu.ip,pc:machine.cpu.pc,halted:machine.cpu.halted,
        shutdown:!!machine.cpu.shutdown,a20Enabled:machine.a20Enabled,cmosShutdown:machine.chips.rtc1.ram[0x0f]},
    progress:{ax:machine.cpu.ax,bx:machine.cpu.bx,cx:machine.cpu.cx,dx:machine.cpu.dx,
        si:machine.cpu.si,di:machine.cpu.di,bp:machine.cpu.bp,sp:machine.cpu.sp,
        ds:machine.cpu.ds,es:machine.cpu.es,ss:machine.cpu.ss,flags:machine.cpu.flags,
        samples:progressSamples},
    memory:{addressSpaceBytes:machine.mem.length,installedRamBytes:0x100000,
        baseRamBytes:0x80000,extendedRamBytes:0x80000},
    executionRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceSha256:Object.fromEntries([
        'src/i8086-machine.js','src/i8086.js','src/i8086-ram-words.js',
        'src/experimental/i80286-protected.js','src/at-8042-a20.js','src/at-system-control.js',
        'src/i8254.js','src/i8259.js','src/i8237.js','src/mc146818.js','src/cga-card.js',
        'src/upd765.js','src/machine-checkpoint.js',
        'scripts/run-at-bios-post.mjs'].map(file=>[file,sourceHash(file)]))};
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if(!passed)process.exitCode=1;
