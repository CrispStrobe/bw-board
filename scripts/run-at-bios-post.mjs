#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

import {I8086Machine,PCAT80286_BOOT,PCAT80286_BOOT_640K} from '../src/i8086-machine.js';
import {gradeAtDosAcceptance,readFat12RootFile} from './lib/at-dos-acceptance.mjs';

const EXPECTED_ROM_SHA256='74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const DEFAULT_STEPS=2_000_000;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHash=file=>sha(fs.readFileSync(path.join(root,file)));
const sourcePaths=[
    'src/i8086-machine.js','src/i8086.js','src/i8086-ram-words.js',
    'src/experimental/i80286-protected.js','src/at-8042-a20.js','src/at-system-control.js',
    'src/i8254.js','src/i8259.js','src/i8237.js','src/mc146818.js','src/cga-card.js',
    'src/upd765.js','src/machine-checkpoint.js',
    'scripts/lib/at-dos-acceptance.mjs','scripts/run-at-bios-post.mjs'];
const executionRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
try {
    execFileSync('git',['diff','--quiet','HEAD','--',...sourcePaths],{cwd:root,stdio:'ignore'});
} catch {
    throw new Error('AT BIOS run refused: an executed source path differs from HEAD');
}
const sourceSha256=Object.fromEntries(sourcePaths.map(file=>[file,sourceHash(file)]));
const romPath=process.env.AT_BIOS_ROM;
if(!romPath)throw new Error('AT_BIOS_ROM must name the external 64KiB IBM 5170 Rev1 ROM');
const rom=fs.readFileSync(romPath);
if(rom.length!==0x10000)throw new Error(`AT BIOS ROM must be 65536 bytes, got ${rom.length}`);
const romSha256=sha(rom);
if(romSha256!==EXPECTED_ROM_SHA256)
    throw new Error(`AT BIOS ROM SHA-256 mismatch: expected ${EXPECTED_ROM_SHA256}, got ${romSha256}`);
const stepLimit=process.env.AT_POST_STEPS===undefined?DEFAULT_STEPS:Number(process.env.AT_POST_STEPS);
if(!Number.isInteger(stepLimit)||stepLimit<1||stepLimit>60_000_000)
    throw new Error('AT_POST_STEPS must be an integer from 1 through 60000000');
const baseRamKiB=process.env.AT_BASE_RAM_KB===undefined?512:Number(process.env.AT_BASE_RAM_KB);
if(![512,640].includes(baseRamKiB))throw new Error('AT_BASE_RAM_KB must be 512 or 640');
const machineProfile=baseRamKiB===640?PCAT80286_BOOT_640K:PCAT80286_BOOT;
const expectedFile=process.env.AT_EXPECT_FILE??null;
const expectedText=process.env.AT_EXPECT_TEXT??null;
if((expectedFile===null)!==(expectedText===null))
    throw new Error('AT_EXPECT_FILE and AT_EXPECT_TEXT must be supplied together');
const requestedKeys=[...(process.env.AT_KEY_SCRIPT??'')];
const scanCodes={a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,
    i:0x17,j:0x24,k:0x25,l:0x26,m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,
    s:0x1f,t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c,' ':0x39,'\r':0x1c,
    '0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,'8':0x09,'9':0x0a,
    '-':0x0c,'.':0x34};
if(requestedKeys.some(key=>key!==key.toLowerCase()||(key!=='>'&&scanCodes[key]===undefined)))
    throw new Error('AT_KEY_SCRIPT contains an unsupported key');
const keyScript=requestedKeys.flatMap(key=>key==='>'
    ? [{key:'shift-down',scan:0x2a},{key:'>',scan:0x34},{key:'shift-up',scan:0xaa}]
    : [{key,scan:scanCodes[key.toLowerCase()]}]);

const resetRequests=[];
const resetApplications=[];
const checkpoints=[];
const postEvents=[];
const controllerPorts=[];
const controllerWrites=[];
const diskPorts=[];
const executionBoundaries={int19:null,bootSector:null,unexpectedInterrupt:null};
const injectedKeys=[];
let reachedPost43=false;
let machine;
machine=new I8086Machine(machineProfile,{onPortAccess:event=>{
    if(event.port===0x60||event.port===0x64) {
        controllerPorts.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,...event});
        if(controllerPorts.length>128)controllerPorts.shift();
        if(event.dir==='out')controllerWrites.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,...event});
    }
    if(event.dir==='out'&&event.port===0x64&&event.value===0xfe)
        resetRequests.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip});
    if(event.dir==='out'&&event.port===0x80&&event.value===0x30)
        checkpoints.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip});
    if(event.dir==='out'&&event.port===0x80) {
        postEvents.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,value:event.value});
        if(machine.cpu.cs===0xf000&&machine.cpu.ip===0x16ab&&event.value===0x43)reachedPost43=true;
    }
    if((event.port>=0x3f0&&event.port<=0x3f7)||(event.port<=0x0f)||
        (event.port>=0x80&&event.port<=0x8f)||(event.port>=0xc0&&event.port<=0xde)) {
        diskPorts.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,...event});
        if(diskPorts.length>256)diskPorts.shift();
    }
}});
machine.loadRom(rom,0xf0000);
machine.loadRom(rom,0xff0000);
let floppy=null;
let floppyImage=null;
if(process.env.AT_FLOPPY_IMAGE) {
    const bytes=fs.readFileSync(process.env.AT_FLOPPY_IMAGE);
    floppyImage=bytes;
    const geometries={
        368640:{cylinders:40,heads:2,sectors:9,bytesPerSector:512},
        1228800:{cylinders:80,heads:2,sectors:15,bytesPerSector:512},
    };
    const geometry=geometries[bytes.length];
    if(!geometry)throw new Error(`AT_FLOPPY_IMAGE must be an untouched 360KiB or 1.2MiB image, got ${bytes.length} bytes`);
    machine.chips.fdc1.insert(0,bytes,geometry);
    floppy={bytes:bytes.length,sha256:sha(bytes),bootSectorSha256:sha(bytes.subarray(0,512)),geometry};
}
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
const renderScreen=()=>Array.from({length:25},(_,row)=>Array.from({length:80},(_,column)=>
    String.fromCharCode(machine._read(0xb8000+(row*80+column)*2)||0x20)).join('').replace(/\s+$/,''));
const deviceSnapshot=()=>({
    masterPic:machine.chips.pic1.getState(),slavePic:machine.chips.pic2.getState(),
    primaryDma:machine.chips.dma1.getState(),secondaryDma:machine.chips.dma2.getState(),
    fdc:machine.chips.fdc1.getState(),
});
for(;steps<stepLimit;steps++) {
    const requestsBefore=resetRequests.length;
    const before={cs:machine.cpu.cs,ip:machine.cpu.ip,sp:machine.cpu.sp,ss:machine.cpu.ss};
    if(keyScript.length&&executionBoundaries.bootSector) {
        const int16Ip=machine._read(0x58)|(machine._read(0x59)<<8);
        const int16Cs=machine._read(0x5a)|(machine._read(0x5b)<<8);
        const ringEmpty=(machine._read(0x41a)|(machine._read(0x41b)<<8))===
            (machine._read(0x41c)|(machine._read(0x41d)<<8));
        if(before.cs===int16Cs&&before.ip===int16Ip&&ringEmpty) {
            const event=keyScript[0];
            if(machine.keyIn(event.scan)) {
                keyScript.shift();
                injectedKeys.push({step:steps,key:event.key,scan:event.scan});
            }
        }
    }
    machine.step();
    const after={cs:machine.cpu.cs,ip:machine.cpu.ip,sp:machine.cpu.sp,ss:machine.cpu.ss};
    if(!executionBoundaries.int19&&reachedPost43&&before.cs===0xf000&&before.ip===0x16ab)
        executionBoundaries.int19={step:steps,before,after,devices:deviceSnapshot()};
    const atBootSector=(after.cs===0&&after.ip===0x7c00)||(after.cs===0x07c0&&after.ip===0);
    if(!executionBoundaries.bootSector&&atBootSector) {
        const loaded=machine.mem.slice(0x7c00,0x7e00);
        executionBoundaries.bootSector={step:steps,before,after,physical:0x7c00,
            firstBytes:Array.from(loaded.slice(0,16)),sha256:sha(loaded),devices:deviceSnapshot()};
    }
    if(!executionBoundaries.unexpectedInterrupt&&after.cs===0xf000&&after.ip===0x1805)
        executionBoundaries.unexpectedInterrupt={step:steps,before,after,devices:deviceSnapshot()};
    if(resetRequests.length>requestsBefore)resetApplications.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        pc:machine.cpu.pc,cmosShutdown:machine.chips.rtc1.ram[0x0f]});
    if(steps%100_000===0)progressSamples.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        ax:machine.cpu.ax,bp:machine.cpu.bp,cx:machine.cpu.cx,es:machine.cpu.es,di:machine.cpu.di,
        esBase:machine.cpu.segmentCaches?.[0]?.base??null,
        dsBase:machine.cpu.segmentCaches?.[3]?.base??null});
    if(expectedFile&&executionBoundaries.bootSector&&keyScript.length===0&&(steps&1023)===0) {
        const observedFile=readFat12RootFile(floppyImage,expectedFile);
        const observedLines=renderScreen();
        if(observedFile?.text===expectedText&&observedLines.some(line=>line===expectedText.trim())&&
            /^A>\s*$/.test([...observedLines].reverse().find(line=>line.trim()!=='')??'')) {
            stopReason='acceptance-observed';
            break;
        }
    }
    if(machine.cpu.shutdown||machine.cpu.halted) {
        stopReason=machine.cpu.shutdown?'cpu-shutdown':'cpu-halt';
        break;
    }
}
const mutation=process.env.AT_POST_MUTATION??null;
if(mutation!==null&&!['dma-checkpoint','reset-preservation','guest-file','boot-sector','keyboard'].includes(mutation))
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
const screenText=renderScreen();
const guestFile=expectedFile&&floppyImage?readFat12RootFile(floppyImage,expectedFile):null;
const keyboardScript={requested:requestedKeys.join(''),injected:injectedKeys,remaining:keyScript};
const final={cs:machine.cpu.cs,ip:machine.cpu.ip,pc:machine.cpu.pc,halted:machine.cpu.halted,
    shutdown:!!machine.cpu.shutdown,a20Enabled:machine.a20Enabled,cmosShutdown:machine.chips.rtc1.ram[0x0f]};
const gradingEvidence=structuredClone({passed,executionBoundaries,keyboardScript,guestFile,final,screenText});
if(mutation==='guest-file'&&gradingEvidence.guestFile)gradingEvidence.guestFile.text+='!';
if(mutation==='boot-sector'&&gradingEvidence.executionBoundaries.bootSector)
    gradingEvidence.executionBoundaries.bootSector.sha256='0'.repeat(64);
if(mutation==='keyboard')gradingEvidence.keyboardScript.injected=[];
const priorOutputMediaSha256=process.env.AT_PRIOR_OUTPUT_SHA256??null;
if(priorOutputMediaSha256!==null&&!/^[0-9a-f]{64}$/.test(priorOutputMediaSha256))
    throw new Error('AT_PRIOR_OUTPUT_SHA256 must be a lowercase SHA-256');
const fullBootAccepted=!!expectedFile&&gradeAtDosAcceptance(gradingEvidence,{expectedText,
    inputBootSectorSha256:floppy?.bootSectorSha256,inputMediaSha256:floppy?.sha256,
    priorOutputMediaSha256});
if(process.env.AT_FLOPPY_OUTPUT) {
    if(!floppyImage)throw new Error('AT_FLOPPY_OUTPUT requires AT_FLOPPY_IMAGE');
    fs.writeFileSync(process.env.AT_FLOPPY_OUTPUT,floppyImage);
    floppy.output={path:process.env.AT_FLOPPY_OUTPUT,sha256:sha(floppyImage)};
}
const report={schema:'astra.at-bios-post.v2',passed,stepLimit,steps,
    scope:fullBootAccepted?'genuine-reset IBM 5170 Rev1 BIOS, FDC/DMA DOS boot and keyboard shell command':
        'bounded genuine-reset IBM 5170 Rev1 POST progression through checkpoint 30',
    diagnosticOnly:!fullBootAccepted,fullBootAccepted,mutation,stopReason,
    persistence:{priorOutputMediaSha256,linked:priorOutputMediaSha256===null?null:
        priorOutputMediaSha256===floppy?.sha256},
    input:{name:'IBM 5170 Rev1 BIOS 1984-01-10',bytes:rom.length,sha256:romSha256,
        expectedSha256:EXPECTED_ROM_SHA256,distribution:'external; ROM bytes are not stored by this repository',floppy},
    reset,firstFetchTrace,resetRequests,resetApplications,checkpoint30:checkpoints,postEvents,
    executionBoundaries,diskPorts,keyboardScript,
    controller:{state:machine._a20Controller.getState(),writes:controllerWrites,recentPorts:controllerPorts},
    guestFile,final,
    screenText,
    devices:deviceSnapshot(),
    progress:{ax:machine.cpu.ax,bx:machine.cpu.bx,cx:machine.cpu.cx,dx:machine.cpu.dx,
        si:machine.cpu.si,di:machine.cpu.di,bp:machine.cpu.bp,sp:machine.cpu.sp,
        ds:machine.cpu.ds,es:machine.cpu.es,ss:machine.cpu.ss,flags:machine.cpu.flags,
        samples:progressSamples},
    memory:{addressSpaceBytes:machine.mem.length,installedRamBytes:(baseRamKiB<<10)+0x80000,
        baseRamBytes:baseRamKiB<<10,extendedRamBytes:0x80000},
    executionRevision,sourceSha256};
for(const [file,before] of Object.entries(sourceSha256)) {
    const after=sourceHash(file);
    if(after!==before)throw new Error(`AT BIOS run refused: executed source changed during execution: ${file}`);
}
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==executionRevision)
    throw new Error('AT BIOS run refused: HEAD changed during execution');
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if(!passed||(expectedFile&&!fullBootAccepted))process.exitCode=1;
