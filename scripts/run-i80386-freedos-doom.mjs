#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

import ExperimentalI80386ATMachine,{PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS,
    PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';
import {I80386Fault,UnsupportedI80386} from '../src/experimental/i80386.js';
import {DOOM_HDD_GEOMETRY,readDoomFat16File} from './lib/i80386-doom-fat16-image.mjs';
import {readFat12RootFile} from './lib/at-dos-acceptance.mjs';
import {gradeFreeDosAtAcceptance} from './lib/freedos-at-acceptance.mjs';

const EXPECTED_FREEDOS_SHA256='03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77';
const EXPECTED_ROM_SHA256='74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const EXPECTED_VGA_ROM_SHA256='90f59d96821517d6bfac2b24eab96eb875e13ae164e8e0008ac93ae558bc6a9a';
const EXPECTED_DOOM_EXE_SHA256='b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27';
const EXPECTED_DOOM_WAD_SHA256='1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771';
const DEFAULT_STEPS=2_000_000;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHash=file=>sha(fs.readFileSync(path.join(root,file)));
const sourcePaths=[
    'src/i8086-machine.js','src/i8086.js','src/i8086-ram-words.js',
    'src/experimental/i80386.js','src/experimental/i80386-at-machine.js','src/experimental/ata16.js',
    'src/experimental/i80286-protected.js','src/at-8042-a20.js','src/at-system-control.js',
    'src/i8254.js','src/i8259.js','src/i8237.js','src/mc146818.js','src/cga-card.js',
    'src/upd765.js','src/machine-checkpoint.js','src/vga-card.js','src/experimental/vga-memory.js',
    'scripts/lib/at-dos-acceptance.mjs','scripts/lib/freedos-at-acceptance.mjs',
    'scripts/lib/i80386-doom-fat16-image.mjs','scripts/run-i80386-freedos-doom.mjs'];
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
if(!Number.isInteger(stepLimit)||stepLimit<1||stepLimit>500_000_000)
    throw new Error('AT_POST_STEPS must be an integer from 1 through 500000000');
const baseRamKiB=640;
const vgaRomPath=process.env.VGA_BIOS_ROM??null;
const vgaRom=vgaRomPath===null?null:fs.readFileSync(vgaRomPath);
if(vgaRom!==null&&(vgaRom.length!==0x7e00||sha(vgaRom)!==EXPECTED_VGA_ROM_SHA256))
    throw new Error('VGA_BIOS_ROM identity mismatch');
const machineProfile=vgaRom===null?PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS:
    PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
const expectedFile=process.env.AT_EXPECT_FILE??null;
const expectedText=process.env.AT_EXPECT_TEXT??null;
if((expectedFile===null)!==(expectedText===null))
    throw new Error('AT_EXPECT_FILE and AT_EXPECT_TEXT must be supplied together');
let priorOutputMediaSha256=null;
if(process.env.FREEDOS_PRIOR_REPORT) {
    const priorReport=JSON.parse(fs.readFileSync(process.env.FREEDOS_PRIOR_REPORT,'utf8'));
    if(priorReport.schema!=='astra.i80386-freedos-doom-diagnostic.v1'||priorReport.fullBootAccepted!==true||
        priorReport.input?.floppy?.sha256!==EXPECTED_FREEDOS_SHA256||
        !/^[0-9a-f]{64}$/.test(priorReport.input?.floppy?.output?.sha256??''))
        throw new Error('FREEDOS_PRIOR_REPORT is not an accepted write receipt from the pinned original image');
    priorOutputMediaSha256=priorReport.input.floppy.output.sha256;
}
const commandKeys=[...(process.env.FREEDOS_COMMAND_SCRIPT??'')];
const doomTraceDetail=process.env.DOOM_TRACE_DETAIL??'registers';
if(!['off','registers','full'].includes(doomTraceDetail))
    throw new Error('DOOM_TRACE_DETAIL must be off, registers, or full');
const requestedKeys=[];
const scanCodes={a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,
    i:0x17,j:0x24,k:0x25,l:0x26,m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,
    s:0x1f,t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c,' ':0x39,'\r':0x1c,
    '0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,'8':0x09,'9':0x0a,
    '-':0x0c,'.':0x34,':':0x27};
if(commandKeys.some(key=>key!==key.toLowerCase()||(key!=='>'&&scanCodes[key]===undefined)))
    throw new Error('AT_KEY_SCRIPT contains an unsupported key');
const encodeKeys=keys=>keys.flatMap(key=>key==='>'||key===':'
    ? [{key:'shift-down',scan:0x2a},{key,scan:key==='>'?0x34:0x27},{key:'shift-up',scan:0xaa}]
    : [{key,scan:scanCodes[key.toLowerCase()]}]);
const keyScript=[];
let installerDeclined=false,commandQueued=false,commandPrompt=null,doomEntry=null;
let steps=0;
const doomEntryWrites=[];
const doomInstructionTrace=[];
let doomInstructionTraceNext=0;
const addDoomInstructionTrace=event=>{
    if(doomInstructionTrace.length<1024)doomInstructionTrace.push(event);
    else doomInstructionTrace[doomInstructionTraceNext]=event;
    doomInstructionTraceNext=(doomInstructionTraceNext+1)&1023;
};
const orderedDoomInstructionTrace=()=>doomInstructionTrace.length<1024?[...doomInstructionTrace]:[
    ...doomInstructionTrace.slice(doomInstructionTraceNext),
    ...doomInstructionTrace.slice(0,doomInstructionTraceNext)];

const resetRequests=[];
const resetApplications=[];
const checkpoints=[];
const postEvents=[];
const controllerPorts=[];
const controllerWrites=[];
const diskPorts=[];
const ataTrace=[];
const ataCommands=[];
const ataCounts={commands:0,nativeDataReads:0,nativeDataWrites:0,overflow:false};
const vgaPortEvents=[];
const vgaPostDoomPortEvents=[];
let vgaPortEventCount=0;
let vgaPortEventOverflow=false;
const vgaRawSamples=[];
let firstVgaGraphicsSnapshot=null;
let latestVgaGraphicsSnapshot=null;
let lastVgaFrameRevision=null;
let ataAtCommandQueue=null;
const rtcPorts=[];
const executionBoundaries={int19:null,bootSector:null,unexpectedInterrupt:null};
const cr0Transitions=[];
const injectedKeys=[];
const uiSamples=[];
let reachedPost43=false;
let machine;
const hddPath=process.env.AT_HDD_IMAGE;
if(!hddPath)throw new Error('AT_HDD_IMAGE must name the external partitioned Doom disk');
const hddImage=fs.readFileSync(hddPath);
const hddFiles={
    doomExe:readDoomFat16File(hddImage,'DOOM    EXE'),
    doomWad:readDoomFat16File(hddImage,'DOOM1   WAD'),
};
if(sha(hddFiles.doomExe)!==EXPECTED_DOOM_EXE_SHA256||sha(hddFiles.doomWad)!==EXPECTED_DOOM_WAD_SHA256)
    throw new Error('partitioned HDD does not contain the pinned DOOM.EXE and DOOM1.WAD payloads');
const hddInputSha256=sha(hddImage);
const mzWord=(bytes,at)=>bytes[at]|bytes[at+1]<<8;
const doomMz={signature:String.fromCharCode(...hddFiles.doomExe.subarray(0,2)),
    lastPageBytes:mzWord(hddFiles.doomExe,2),pages:mzWord(hddFiles.doomExe,4),
    relocationCount:mzWord(hddFiles.doomExe,6),relocationTableOffset:mzWord(hddFiles.doomExe,24),
    headerParagraphs:mzWord(hddFiles.doomExe,8),initialSS:mzWord(hddFiles.doomExe,14),
    initialSP:mzWord(hddFiles.doomExe,16),initialIP:mzWord(hddFiles.doomExe,20),
    initialCS:mzWord(hddFiles.doomExe,22)};
if(doomMz.signature!=='MZ')throw new Error('pinned DOOM.EXE is not an MZ executable');
const doomEntryFileOffset=doomMz.headerParagraphs*16+doomMz.initialCS*16+doomMz.initialIP;
const doomEntryBytes=Array.from(hddFiles.doomExe.subarray(doomEntryFileOffset,doomEntryFileOffset+16));
const expectedDoomLoadSegment=0x22d2;
const doomEntryPhysical=(expectedDoomLoadSegment<<4)+(doomMz.initialCS<<4)+doomMz.initialIP;
const doomDeclaredBytes=(doomMz.pages-1)*512+(doomMz.lastPageBytes||512);
const doomHeaderBytes=doomMz.headerParagraphs*16;
const expectedDoomLoadImage=hddFiles.doomExe.slice(doomHeaderBytes,doomDeclaredBytes);
for(let index=0;index<doomMz.relocationCount;index++) {
    const record=doomMz.relocationTableOffset+index*4;
    const offset=mzWord(hddFiles.doomExe,record);
    const segment=mzWord(hddFiles.doomExe,record+2);
    const target=segment*16+offset;
    if(target+1>=expectedDoomLoadImage.length)
        throw new Error(`Doom relocation ${index} lies outside the declared load image`);
    const relocated=(mzWord(expectedDoomLoadImage,target)+expectedDoomLoadSegment)&0xffff;
    expectedDoomLoadImage[target]=relocated&0xff;
    expectedDoomLoadImage[target+1]=relocated>>>8;
}
machine=new ExperimentalI80386ATMachine(machineProfile,{ataImage:hddImage,ataGeometry:DOOM_HDD_GEOMETRY,onPortAccess:event=>{
    if(event.port===0x70||event.port===0x71) {
        rtcPorts.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,...event});
        if(rtcPorts.length>64)rtcPorts.shift();
    }
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
        // Retain enough firmware traffic to include the drive/media
        // classification sequence as well as the loader's first failing I/O.
        if(diskPorts.length>4096)diskPorts.shift();
    }
    if((event.port>=0x1f0&&event.port<=0x1f7)||event.port===0x3f6) {
        if(event.port===0x1f7&&event.dir==='out') {
            ataCounts.commands++;
            ataCommands.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,command:event.value,
                sectorCount:machine.ata.sectorCount,sectorNumber:machine.ata.sectorNumber,
                cylinder:machine.ata.cylinderLow|machine.ata.cylinderHigh<<8,
                driveHead:machine.ata.driveHead});
        }
        if(event.port===0x1f0&&event.width===16)
            ataCounts[event.dir==='in'?'nativeDataReads':'nativeDataWrites']++;
        if(ataTrace.length<4096)ataTrace.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,...event});
        else ataCounts.overflow=true;
    }
    if(vgaRom!==null&&event.port>=0x3c0&&event.port<=0x3df) {
        const sample={step:steps,cs:machine.cpu.cs,eip:machine.cpu.eip,...event};
        vgaPortEventCount++;
        if(vgaPortEvents.length<8192)vgaPortEvents.push(sample);
        else vgaPortEventOverflow=true;
        if(doomEntry) {
            vgaPostDoomPortEvents.push(sample);
            if(vgaPostDoomPortEvents.length>8192)vgaPostDoomPortEvents.shift();
        }
    }
}});
machine.loadRom(rom,0xf0000);
machine.loadRom(rom);
if(vgaRom!==null)machine.loadRom(vgaRom,0xc0000);
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
    if(sha(bytes)!==EXPECTED_FREEDOS_SHA256&&sha(bytes)!==priorOutputMediaSha256)
        throw new Error(`FreeDOS image is neither the pinned original nor the linked prior output: ${sha(bytes)}`);
    if(!geometry)throw new Error(`AT_FLOPPY_IMAGE must be an untouched 360KiB or 1.2MiB image, got ${bytes.length} bytes`);
    machine.chips.fdc1.insert(0,bytes,geometry);
    floppy={bytes:bytes.length,sha256:sha(bytes),bootSectorSha256:sha(bytes.subarray(0,512)),geometry};
}
machine.reset();
const reset={cs:machine.cpu.cs,ip:machine.cpu.ip,pc:machine.cpu.pc,
    fetchPhysical:machine.cpu.pc,firstByte:machine.cpu.read(machine.cpu.pc)};
if(reset.cs!==0xf000||reset.ip!==0xfff0||reset.pc!==0xfffffff0||reset.fetchPhysical!==0xfffffff0)
    throw new Error(`80386 reset entry mismatch: ${JSON.stringify(reset)}`);

const cpuWrite=machine.cpu.write;
machine.cpu.write=(address,value)=>{
    if(commandQueued&&address>=doomEntryPhysical&&address<doomEntryPhysical+16) {
        doomEntryWrites.push({step:steps,address,value:value&0xff,cs:machine.cpu.cs,
            eip:machine.cpu.eip,linearPc:machine.cpu.pc,esi:machine.cpu.esi,
            edi:machine.cpu.edi,ecx:machine.cpu.ecx,ds:machine.cpu.ds,es:machine.cpu.es,
            dsBase:machine.cpu.segmentCaches[3].base,esBase:machine.cpu.segmentCaches[0].base,
            sourceLinear16:(machine.cpu.segmentCaches[3].base+machine.cpu.si)>>>0,
            sourceLinear32:(machine.cpu.segmentCaches[3].base+machine.cpu.esi)>>>0,
            opcodeBytes:Array.from({length:8},(_,index)=>machine.cpu.read((machine.cpu.pc+index)>>>0))});
        if(doomEntryWrites.length>4096)doomEntryWrites.shift();
    }
    cpuWrite(address,value);
};
machine.step();
const firstFetchTrace=[reset.firstByte,reset.fetchPhysical];
steps=1;
let previousCr0=machine.cpu.cr0>>>0;
const progressSamples=[];
let stopReason=null;
let hostRefusal=null;
const screenColumns=()=>vgaRom===null?80:(machine._read(0x44a)|(machine._read(0x44b)<<8))||80;
const renderScreen=()=>Array.from({length:25},(_,row)=>Array.from({length:screenColumns()},(_,column)=>{
    const cell=row*screenColumns()+column;
    const value=vgaRom===null?machine._read(0xb8000+cell*2):machine.vgaMemory.planes[0][cell*2];
    return String.fromCharCode(value||0x20);
}).join('').replace(/\s+$/,''));
const disketteBda=()=>Array.from({length:16},(_,index)=>machine._read(0x490+index));
const observeLinearByte=linear=>{
    if(machine.cpu.cr0&0x80000000)return null;
    const physical=machine._decode386(linear>>>0);
    if(physical>=0xa0000&&physical<=0xbffff)return null;
    return physical<machine.mem.length?machine.mem[physical]:0xff;
};
const observeLinearBytes=(linear,length)=>{
    const bytes=Array.from({length},(_,index)=>observeLinearByte((linear+index)>>>0));
    return bytes.some(value=>value===null)?null:bytes;
};
const cpuSnapshot=()=>{
    const cpu=machine.cpu,linearPc=cpu.pc,paging=!!(cpu.cr0&0x80000000);
    const mappedOffset=doomEntry
        ? doomMz.headerParagraphs*16+(((cpu.cs-doomEntry.loadSegment)&0xffff)<<4)+cpu.eip:null;
    const mappedBytes=mappedOffset!==null&&mappedOffset<hddFiles.doomExe.length
        ? Array.from(hddFiles.doomExe.subarray(mappedOffset,mappedOffset+16)):null;
    const gdtBytes=paging?null:Array.from({length:Math.min(cpu.gdtr.limit+1,64)},
        (_,index)=>cpu.read((cpu.gdtr.base+index)>>>0));
    return {eax:cpu.eax,ebx:cpu.ebx,ecx:cpu.ecx,edx:cpu.edx,esi:cpu.esi,edi:cpu.edi,
        ebp:cpu.ebp,esp:cpu.esp,eip:cpu.eip,eflags:cpu.eflags,cs:cpu.cs,ds:cpu.ds,
        es:cpu.es,ss:cpu.ss,fs:cpu.fs,gs:cpu.gs,cr0:cpu.cr0,cr2:cpu.cr2,cr3:cpu.cr3,
        linearPc,physicalPc:paging?null:machine._decode386(linearPc),paging,
        gdtr:{...cpu.gdtr},idtr:{...cpu.idtr},gdtBytes,
        tr:{...cpu.tr},ldtr:{...cpu.ldtr},csCache:{...cpu.segmentCaches[1]},
        opcodeBytes:paging?null:Array.from({length:16},(_,index)=>cpu.read((linearPc+index)>>>0)),
        doomFileMapping:mappedOffset===null?null:{offset:mappedOffset,bytes:mappedBytes}};
};
const deviceSnapshot=()=>({
    masterPic:machine.chips.pic1.getState(),slavePic:machine.chips.pic2.getState(),
    primaryDma:machine.chips.dma1.getState(),secondaryDma:machine.chips.dma2.getState(),
    fdc:machine.chips.fdc1.getState(),
});
for(;steps<stepLimit;steps++) {
    const requestsBefore=resetRequests.length;
    const before={cs:machine.cpu.cs,ip:machine.cpu.ip,sp:machine.cpu.sp,ss:machine.cpu.ss};
    if(commandQueued&&!doomEntry&&machine.cpu.eip===doomMz.initialIP&&
        (machine.cpu.esp&0xffff)===doomMz.initialSP&&
        ((machine.cpu.cs-machine.cpu.ss)&0xffff)===((doomMz.initialCS-doomMz.initialSS)&0xffff)) {
        const loadSegment=(machine.cpu.cs-doomMz.initialCS)&0xffff;
        if(loadSegment!==expectedDoomLoadSegment||machine.cpu.pc!==doomEntryPhysical)
            throw new Error(`Doom entry address mismatch: load ${loadSegment.toString(16)}, pc ${machine.cpu.pc.toString(16)}`);
        const memoryBytes=Array.from({length:16},(_,index)=>machine.cpu.read((machine.cpu.pc+index)>>>0));
        const exactEntryLocations=[];
        for(let address=0;address<=machine.mem.length-doomEntryBytes.length;address++) {
            let matches=true;
            for(let index=0;index<doomEntryBytes.length;index++) {
                if(machine.mem[address+index]!==doomEntryBytes[index]) { matches=false; break; }
            }
            if(matches)exactEntryLocations.push(address);
        }
        const actualLoadImage=machine.mem.slice(loadSegment<<4,
            (loadSegment<<4)+expectedDoomLoadImage.length);
        const loadDifferences=[];
        let loadDifferenceCount=0;
        let firstLoadDifference=null,lastLoadDifference=null;
        for(let index=0;index<expectedDoomLoadImage.length;index++) {
            if(actualLoadImage[index]===expectedDoomLoadImage[index])continue;
            loadDifferenceCount++;
            if(firstLoadDifference===null)firstLoadDifference=index;
            lastLoadDifference=index;
            if(loadDifferences.length<16)loadDifferences.push({offset:index,
                expected:expectedDoomLoadImage[index],actual:actualLoadImage[index]});
        }
        doomEntry={step:steps,cs:machine.cpu.cs,eip:machine.cpu.eip,linearPc:machine.cpu.pc,
            loadSegment,memoryBytes,
            fileBytes:doomEntryBytes,physical:doomEntryPhysical,exactEntryLocations,
            writes:[...doomEntryWrites],loadImage:{bytes:expectedDoomLoadImage.length,
                relocationCount:doomMz.relocationCount,expectedSha256:sha(expectedDoomLoadImage),
                actualSha256:sha(actualLoadImage),differenceCount:loadDifferenceCount,
                firstDifferenceOffset:firstLoadDifference,lastDifferenceOffset:lastLoadDifference,
                firstDifferences:loadDifferences}};
    }
    if(doomEntry&&doomTraceDetail!=='off') {
        const trace={step:steps,cs:machine.cpu.cs,eip:machine.cpu.eip,cr0:machine.cpu.cr0,
            eax:machine.cpu.eax,ecx:machine.cpu.ecx,edx:machine.cpu.edx};
        if(doomTraceDetail==='full') {
            const stackOffset=machine.cpu.segmentCaches[2].default32?machine.cpu.esp:machine.cpu.sp;
            const stackLinear=(machine.cpu.segmentCaches[2].base+stackOffset)>>>0;
            const stackBytes=observeLinearBytes(stackLinear,8);
            Object.assign(trace,{linearPc:machine.cpu.pc,ebx:machine.cpu.ebx,
                ss:machine.cpu.ss,esp:machine.cpu.esp,eflags:machine.cpu.eflags,
                stackWords:stackBytes&&Array.from({length:4},(_,index)=>stackBytes[index*2]|
                    stackBytes[index*2+1]<<8),bytes:observeLinearBytes(machine.cpu.pc,6)});
        }
        addDoomInstructionTrace(trace);
    }
    if(executionBoundaries.bootSector&&!commandQueued&&(steps&1023)===0) {
        const ui=renderScreen();
        if(!installerDeclined&&ui.some(line=>line.includes('Do you want to proceed'))) {
            keyScript.push(...encodeKeys(['n','\r']));
            requestedKeys.push('n','\r');
            installerDeclined=true;
        } else if(installerDeclined&&!commandQueued&&keyScript.length===0) {
            const promptRow=ui.findIndex(line=>/^A:\\?>/.test(line));
            const activePage=vgaRom===null?0:machine._read(0x462)&7;
            const cursor=machine._read(0x450+activePage*2)|machine._read(0x451+activePage*2)<<8;
            const finalLine=[...ui].reverse().find(line=>line.trim()!=='')??'';
            const promptComplete=/^A:\\?>\s*$/.test(finalLine);
            const cursorAtPrompt=(cursor>>8)===promptRow&&(cursor&0xff)>=3;
            if(promptRow>=0&&promptComplete&&(vgaRom!==null||cursorAtPrompt)) {
                commandPrompt={step:steps,row:promptRow,column:cursor&0xff,line:ui[promptRow]};
                keyScript.push(...encodeKeys(commandKeys));
                requestedKeys.push(...commandKeys);
                commandQueued=true;
                ataAtCommandQueue=structuredClone(ataCounts);
            }
        }
    }
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
    try {
        machine.step();
    } catch(error) {
        if(!(error instanceof UnsupportedI80386)&&!(error instanceof I80386Fault)&&
            (!(error instanceof Error)||
                (!error.message.startsWith('MC146818 ')&&!error.message.startsWith('AT 8042 '))))throw error;
        hostRefusal={name:error.name,message:error.message,step:steps,before,cpu:cpuSnapshot(),
            rtc:{index:machine.chips.rtc1.index,registerB:machine.chips.rtc1.ram[0x0b],
                state:machine.chips.rtc1.getState()},recentPorts:[...rtcPorts]};
        stopReason=error instanceof UnsupportedI80386?'cpu-unsupported':
            error instanceof I80386Fault?'architectural-fault-surfaced':'host-device-refusal';
        break;
    }
    if((machine.cpu.cr0>>>0)!==previousCr0) {
        cr0Transitions.push({step:steps,before:previousCr0,after:machine.cpu.cr0>>>0,
            cs:machine.cpu.cs,eip:machine.cpu.eip,pc:machine.cpu.pc});
        previousCr0=machine.cpu.cr0>>>0;
    }
    const after={cs:machine.cpu.cs,ip:machine.cpu.ip,sp:machine.cpu.sp,ss:machine.cpu.ss};
    if(!executionBoundaries.int19&&reachedPost43&&before.cs===0xf000&&before.ip===0x16ab)
        executionBoundaries.int19={step:steps,before,after,devices:deviceSnapshot()};
    const atBootSector=(after.cs===0&&after.ip===0x7c00)||(after.cs===0x07c0&&after.ip===0);
    if(!executionBoundaries.bootSector&&atBootSector) {
        const loaded=machine.mem.slice(0x7c00,0x7e00);
        executionBoundaries.bootSector={step:steps,before,after,physical:0x7c00,
            firstBytes:Array.from(loaded.slice(0,16)),sha256:sha(loaded),
            disketteBda490:disketteBda(),ataCounts:structuredClone(ataCounts),devices:deviceSnapshot()};
    }
    if(!executionBoundaries.unexpectedInterrupt&&after.cs===0xf000&&after.ip===0x1805)
        executionBoundaries.unexpectedInterrupt={step:steps,before,after,devices:deviceSnapshot()};
    if(resetRequests.length>requestsBefore)resetApplications.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        pc:machine.cpu.pc,cmosShutdown:machine.chips.rtc1.ram[0x0f]});
    if(steps%100_000===0)progressSamples.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
        ax:machine.cpu.ax,bp:machine.cpu.bp,cx:machine.cpu.cx,es:machine.cpu.es,di:machine.cpu.di,
        esBase:machine.cpu.segmentCaches?.[0]?.base??null,
        dsBase:machine.cpu.segmentCaches?.[3]?.base??null});
    if(steps%1_000_000===0) {
        const lines=renderScreen(),nonblank=lines.filter(line=>line.trim()!=='');
        uiSamples.push({step:steps,cs:machine.cpu.cs,ip:machine.cpu.ip,
            keyboardHead:machine._read(0x41a)|(machine._read(0x41b)<<8),
            keyboardTail:machine._read(0x41c)|(machine._read(0x41d)<<8),
            lastLines:nonblank.slice(-4)});
        if(vgaRom!==null&&machine.displayRevision!==lastVgaFrameRevision) {
            const state=machine.chips.vga1.getVideoState();
            vgaRawSamples.push({step:steps,displayRevision:machine.displayRevision,
                planeSha256:machine.vgaMemory.planes.map(plane=>sha(plane)),
                nonzeroByPlane:machine.vgaMemory.planes.map(plane=>
                    plane.reduce((count,value)=>count+(value!==0),0)),
                dacSha256:sha(state.dac),misc:state.misc,seq:Array.from(state.seq),
                gc:Array.from(state.gc),crtc:Array.from(state.crtc),attr:Array.from(state.attr)});
            if(vgaRawSamples.length>64)vgaRawSamples.shift();
            if((state.gc[6]&1)!==0) {
                const snapshot={step:steps,displayRevision:machine.displayRevision,
                    misc:state.misc,seq:Array.from(state.seq),gc:Array.from(state.gc),
                    crtc:Array.from(state.crtc),attr:Array.from(state.attr),
                    dacBase64:Buffer.from(state.dac).toString('base64'),
                    planesBase64:machine.vgaMemory.planes.map(plane=>Buffer.from(plane).toString('base64'))};
                firstVgaGraphicsSnapshot??=snapshot;
                latestVgaGraphicsSnapshot=snapshot;
            }
            lastVgaFrameRevision=machine.displayRevision;
        }
    }
    if(expectedFile&&executionBoundaries.bootSector&&keyScript.length===0&&(steps&1023)===0) {
        const observedFile=readFat12RootFile(floppyImage,expectedFile);
        const observedLines=renderScreen();
        if(observedFile?.text===expectedText&&observedLines.some(line=>line===expectedText.trim())&&
            /^A:\\?>\s*$/.test([...observedLines].reverse().find(line=>line.trim()!=='')??'')) {
            stopReason='acceptance-observed';
            break;
        }
    }
    if(machine.cpu.shutdown) {
        stopReason='cpu-shutdown';
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
    event.pc===0xfffffff0&&event.cmosShutdown===1);
const passed=firstFetchTrace[1]===0xfffffff0&&
    !!post30&&!!warmReset&&warmReset.step<post30.step&&
    !machine.cpu.halted&&!machine.cpu.shutdown&&!hostRefusal;
const screenText=renderScreen();
const guestFile=expectedFile&&floppyImage?readFat12RootFile(floppyImage,expectedFile):null;
const keyboardScript={requested:requestedKeys.join(''),installerDeclined,commandQueued,commandPrompt,
    injected:injectedKeys,remaining:keyScript};
const final={cs:machine.cpu.cs,ip:machine.cpu.ip,pc:machine.cpu.pc,halted:machine.cpu.halted,
    shutdown:!!machine.cpu.shutdown,a20Enabled:machine.a20Enabled,cmosShutdown:machine.chips.rtc1.ram[0x0f]};
const vgaDiagnostics=vgaRom===null?null:{
    state:machine.chips.vga1.getVideoState(),
    bdaActivePage:machine._read(0x462),
    bdaCursor:Array.from({length:8},(_,page)=>machine._read(0x450+page*2)|
        machine._read(0x451+page*2)<<8),
    crtcCursor:(machine.chips.vga1.crtc[0x0e]<<8)|machine.chips.vga1.crtc[0x0f],
    nonzeroByPlane:machine.vgaMemory.planes.map(plane=>plane.reduce((count,value)=>count+(value!==0),0)),
    textColumns:screenColumns(),
    literalText:Array.from({length:25},(_,row)=>Array.from({length:screenColumns()},(_,column)=>
        String.fromCharCode(machine.vgaMemory.planes[0][(row*screenColumns()+column)*2]||0x20)).join('').replace(/\s+$/,'')),
    compactText:Array.from({length:25},(_,row)=>Array.from({length:80},(_,column)=>
        String.fromCharCode(machine.vgaMemory.planes[0][row*80+column]||0x20)).join('').replace(/\s+$/,'')),
};
const gradingEvidence=structuredClone({passed,executionBoundaries,keyboardScript,guestFile,final,screenText});
if(mutation==='guest-file'&&gradingEvidence.guestFile)gradingEvidence.guestFile.text+='!';
if(mutation==='boot-sector'&&gradingEvidence.executionBoundaries.bootSector)
    gradingEvidence.executionBoundaries.bootSector.sha256='0'.repeat(64);
if(mutation==='keyboard')gradingEvidence.keyboardScript.injected=[];
const expectedRequested=`n\r${commandKeys.join('')}`;
const expectedInjectedKeys=encodeKeys([...expectedRequested]).map(event=>event.key);
const fullBootAccepted=!!expectedFile&&gradeFreeDosAtAcceptance(gradingEvidence,{expectedText,
    inputBootSectorSha256:floppy?.bootSectorSha256,inputMediaSha256:floppy?.sha256,
    originalMediaSha256:EXPECTED_FREEDOS_SHA256,priorOutputMediaSha256,
    expectedRequested,expectedInjectedKeys});
if(process.env.AT_FLOPPY_OUTPUT) {
    if(!floppyImage)throw new Error('AT_FLOPPY_OUTPUT requires AT_FLOPPY_IMAGE');
    fs.writeFileSync(process.env.AT_FLOPPY_OUTPUT,floppyImage);
    floppy.output={path:process.env.AT_FLOPPY_OUTPUT,sha256:sha(floppyImage)};
}
const report={schema:'astra.i80386-freedos-doom-diagnostic.v1',passed,stepLimit,steps,
    scope:fullBootAccepted?'unchanged FreeDOS 1.4 floppy boot, explicit installer decline, and keyboard shell command':
        'bounded unchanged FreeDOS 1.4 startup diagnostic',
    diagnosticOnly:!fullBootAccepted,fullBootAccepted,mutation,stopReason,hostRefusal,
    persistence:{priorOutputMediaSha256,linked:priorOutputMediaSha256===null?null:
        priorOutputMediaSha256===floppy?.sha256},
    input:{name:'IBM 5170 Rev1 BIOS 1984-01-10',bytes:rom.length,sha256:romSha256,
        expectedSha256:EXPECTED_ROM_SHA256,distribution:'external; ROM bytes are not stored by this repository',
        vgaRom:vgaRom&&{bytes:vgaRom.length,sha256:sha(vgaRom)},floppy},
    reset,firstFetchTrace,resetRequests,resetApplications,checkpoint30:checkpoints,postEvents,
    executionBoundaries,cr0Transitions,doomEntry,doomEntryWrites,doomTraceDetail,
    doomInstructionTrace:orderedDoomInstructionTrace(),diskPorts,rtcPorts,keyboardScript,
    disketteBda490:disketteBda(),
    controller:{state:machine._a20Controller.getState(),writes:controllerWrites,recentPorts:controllerPorts},
    guestFile,final,finalCpu:cpuSnapshot(),vgaDiagnostics,
    vgaEvidence:{portEventCount:vgaPortEventCount,vgaPortEventOverflow,portEvents:vgaPortEvents,
        postDoomPortEvents:vgaPostDoomPortEvents,rawPlanePaletteSamples:vgaRawSamples,
        firstGraphicsSnapshot:firstVgaGraphicsSnapshot,
        latestGraphicsSnapshot:latestVgaGraphicsSnapshot,renderedFrames:[]},
    screenText,uiSamples,
    devices:deviceSnapshot(),
    progress:{ax:machine.cpu.ax,bx:machine.cpu.bx,cx:machine.cpu.cx,dx:machine.cpu.dx,
        si:machine.cpu.si,di:machine.cpu.di,bp:machine.cpu.bp,sp:machine.cpu.sp,
        ds:machine.cpu.ds,es:machine.cpu.es,ss:machine.cpu.ss,flags:machine.cpu.flags,
        samples:progressSamples},
    memory:{addressSpaceBytes:machine.mem.length,installedRamBytes:4<<20,
        baseRamBytes:baseRamKiB<<10,extendedRamBytes:3456<<10},
    hdd:{bytes:hddImage.length,inputSha256:hddInputSha256,
        outputSha256:sha(machine.ata.mediaBytes()),geometry:DOOM_HDD_GEOMETRY,
        files:{doomExe:{bytes:hddFiles.doomExe.length,sha256:sha(hddFiles.doomExe),mz:doomMz},
            doomWad:{bytes:hddFiles.doomWad.length,sha256:sha(hddFiles.doomWad)}},
        controller:{command:machine.ata.command,status:machine.ata.status,error:machine.ata.error,
            sectorCount:machine.ata.sectorCount,sectorNumber:machine.ata.sectorNumber,
            cylinder:machine.ata.cylinderLow|machine.ata.cylinderHigh<<8,
            driveHead:machine.ata.driveHead,direction:machine.ata.direction,
            irqPending:machine.ata._irqPending,irqOutput:machine.ata._irqOutput},
        trace:ataTrace,commands:ataCommands,counts:ataCounts,atCommandQueue:ataAtCommandQueue},
    executionRevision,sourceSha256};
for(const [file,before] of Object.entries(sourceSha256)) {
    const after=sourceHash(file);
    if(after!==before)throw new Error(`AT BIOS run refused: executed source changed during execution: ${file}`);
}
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==executionRevision)
    throw new Error('AT BIOS run refused: HEAD changed during execution');
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if(!passed||(expectedFile&&!fullBootAccepted))process.exitCode=1;
