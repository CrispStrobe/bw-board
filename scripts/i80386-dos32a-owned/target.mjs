import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as M from '../../src/experimental/i80386-at-machine.js';
import {GEOMETRY, LE_SHA, FIRST_COMMAND, SECOND_COMMAND, resultFiles} from './media.mjs';
import {evaluate,prompt} from './grade.mjs';
import {encode,readyForScan} from './keyboard.mjs';

const BIOS_SHA = '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac';
const VGA_SHA = '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1';
const FLOPPY_SHA = '03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77';
const MAX_STEPS = 120_000_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function exact(path, bytes, digest) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes) throw new Error('input file shape');
  const raw = fs.readFileSync(path);
  if (sha(raw) !== digest) throw new Error('input file digest');
  return raw;
}

const pick = (object, fields) => Object.fromEntries(fields.map(key => [key, object?.[key] ?? null]));
const cpuState = cpu => ({
  ...pick(cpu, ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
    'cs','ds','es','ss','fs','gs','cr0','cr2','cr3','cr4','gdtr','idtr','ldtr','tr',
    'cycles','successfulInstructions','halted','shutdown','protectedMode']),
  cpuProfile: cpu.cpuProfile,
  segmentCaches: [0,1,2,3,4,5].map(n => cpu.segmentCaches[n]),
});

function compact(value, depth = 0) {
  if (depth > 12) throw new Error('device state too deep');
  if (value === undefined) return null;
  if (value === null || ['number','string','boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return value.toString();
  if (ArrayBuffer.isView(value)) return {type:value.constructor.name,bytes:value.byteLength,
    sha256:sha(Buffer.from(value.buffer,value.byteOffset,value.byteLength))};
  if (Array.isArray(value)) {
    if (value.length > 4096) return {type:'array',length:value.length,sha256:sha(Buffer.from(JSON.stringify(value)))};
    return value.map(item => compact(item,depth+1));
  }
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,compact(item,depth+1)]));
  throw new Error('unsupported device state');
}

function deviceStates(machine) {
  const result = {};
  for (const [name,chip] of Object.entries(machine.chips).sort(([a],[b]) => a.localeCompare(b))) {
    const state = typeof chip.getState === 'function' ? chip.getState() : null;
    result[name] = compact(state);
  }
  result.ata = compact(machine.ata?.getState?.() ?? null);
  return result;
}

function hddCmos(g) {
  return [[0x19,47],[0x1b,g.cylinders&255],[0x1c,g.cylinders>>8],[0x1d,g.heads],
    [0x1e,0xff],[0x1f,0xff],[0x20,g.heads>8?0xc8:0xc0],[0x21,g.cylinders&255],
    [0x22,g.cylinders>>8],[0x23,g.sectors],[0x39,0]];
}

function createMachine({bios,vga,floppy,disk}) {
  const base = M.PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
  const cmos = hddCmos(GEOMETRY), replaced = new Set(cmos.map(([index]) => index));
  const cfg = {...base,
    functionalInstructionCycles: 6,
    regions: [...base.regions.filter(region => !(region.kind==='rom' && region.start===0xc0000)),
      {kind:'rom',start:0xc0000,end:0xc9fff}],
    chips: base.chips.map(chip => chip.kind==='rtc' ? {...chip,
      initialCmos:[...chip.initialCmos.filter(([index]) =>
        index!==0x3d && index!==0x12 && !replaced.has(index)),[0x3d,0x21],[0x12,0xf0],...cmos]} : chip),
  };
  const machine = new M.ExperimentalI80386ATMachine(cfg,
    {ataImage:new Uint8Array(disk),ataGeometry:GEOMETRY});
  machine.loadRom(bios,0xf0000);
  machine.loadRom(bios,0xff0000);
  machine.loadRom(vga,0xc0000);
  machine.chips.fdc1.insert(0,new Uint8Array(floppy),
    {cylinders:80,heads:2,sectors:15,bytesPerSector:512});
  machine.reset();
  return machine;
}

function rows(machine) {
  const lines=[];
  for (let y=0;y<25;y++) {
    let line='';
    for(let x=0;x<80;x++) {
      const value=machine._read386(0xb8000+(y*80+x)*2);
      line+=value>=32&&value<=126?String.fromCharCode(value):' ';
    }
    lines.push(line.replace(/\s+$/,''));
  }
  return lines;
}
function ringEmpty(machine) {return (machine._read(0x41a)|(machine._read(0x41b)<<8))===
  (machine._read(0x41c)|(machine._read(0x41d)<<8));}

function observePayload(machine,witness,prefix) {
  const cpu=machine.cpu, cache=cpu.segmentCaches[1];
  if (!(cpu.cr0&1) || !cache?.default32 || (cpu.cr0&0x80000000)) return;
  const linear=(cache.base+cpu.eip)>>>0;
  if (!witness.entry && linear+prefix.length<machine.memoryBytes &&
      machine._read386(linear)===prefix[0] &&
      prefix.every((byte,index)=>machine._read386(linear+index)===byte))
    witness.entry={cs:cpu.cs,eip:cpu.eip,linear,cr0:cpu.cr0,
      csDefault32:cache.default32,ssDefault32:cpu.segmentCaches[2]?.default32,
      ssWritable:cpu.segmentCaches[2]?.writable,step:witness.step};
  if (!witness.entry || linear < witness.entry.linear || linear > witness.entry.linear+56) return;
  const offset=linear-witness.entry.linear;
  if (offset===16 && !witness.arithmetic)
    witness.arithmetic={eax:cpu.eax>>>0,step:witness.step};
  if (offset===21 && !witness.cmp)
    witness.cmp={eax:cpu.eax>>>0,step:witness.step};
  if (offset===23 && !witness.branch)
    witness.branch={zero:!!(cpu.eflags&0x40),step:witness.step};
  if (offset===31 && !witness.print)
    witness.print={ah:(cpu.eax>>>8)&255,edx:cpu.edx>>>0,step:witness.step};
  if (offset===38 && !witness.exit)
    witness.exit={ax:cpu.eax&65535,step:witness.step};
}

async function main() {
  if (process.argv.length!==4) throw new Error('usage: target.mjs input.json output.json');
  const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const output=process.argv[3];
  const report={schema:'bw.dos32a-owned-le.target.v1',passed:false,
    scope:'full AT FreeDOS, compatibility-profile 386-class flat protected-mode LE client; no PSE/APIC or strict386 qualification',
    firstFailure:null};
  try {
    const bios=exact(input.bios,65536,BIOS_SHA),
      vga=exact(input.vga,38400,VGA_SHA),
      floppy=exact(input.floppy,1228800,FLOPPY_SHA),
      disk=exact(input.disk,GEOMETRY.cylinders*GEOMETRY.heads*GEOMETRY.sectors*512,input.diskSha256),
      client=exact(input.client,8192,LE_SHA);
    const machine=createMachine({bios,vga,floppy,disk}), cpu=machine.cpu;
    const reset=cpuState(cpu);
    const prefix=client.subarray(4096,4096+11);
    const witness={step:0};
    let stage='boot', declined=false, menuKicks=0, keyQueue=[], firstFailure=null,
      lastChange=0,previousScreen='',lastScreen=[],lastFiles=null,steps=0,returned=false;
    let partialFatReads=0;
    const injected=[];
    let lastAcceptedStep=-5_000;
    let lastOfferedStep=-5_000;
    for(let step=0;step<MAX_STEPS;step++) {
      steps=step;witness.step=step;
      if (step%50000===0) {
        lastScreen=rows(machine);
        const visible=lastScreen.join('\n').replace(/\s/g,'');
        if(visible!==previousScreen){previousScreen=visible;lastChange=step;}
        const idle=step-lastChange>1_500_000;
        if (!declined && lastScreen.some(line=>/Do you want to proceed/i.test(line))) {
          keyQueue.push(...encode('n\r'));declined=true;
        } else if (!declined && keyQueue.length===0 && step-menuKicks>800000 &&
          lastScreen.some(line=>/press \[ENTER\]|Select from Menu/i.test(line))) {
          keyQueue.push(...encode('\r'));menuKicks=step;
        } else if (declined && stage==='boot' && keyQueue.length===0 && prompt(lastScreen)) {
          keyQueue.push(...encode(FIRST_COMMAND+'\r'));stage='run-queued';
        }
        if (step%200000===0 && stage!=='boot') {
          try {lastFiles=resultFiles(Buffer.from(machine.ata.mediaBytes()));}
          catch(error) {
            partialFatReads++;
            if(partialFatReads>20){firstFailure=`FAT remained malformed: ${String(error?.message??error)}`;break;}
          }
        }
        if (stage==='run-queued' && keyQueue.length===0 && lastFiles?.ok &&
            lastScreen.some(line=>line.includes('BW-LE-BATCH-DONE')) && prompt(lastScreen)) {
          keyQueue.push(...encode(SECOND_COMMAND+'\r'));stage='return-queued';
        }
        if(stage==='return-queued' && keyQueue.length===0 && lastFiles?.returned && prompt(lastScreen) && idle) {
          returned=true;stage='done';break;
        }
        if(lastFiles?.fail){firstFailure='guest wrote LEFAIL.TXT';break;}
      }
      if(keyQueue.length && readyForScan({step,lastOfferedStep,
        ringEmpty:ringEmpty(machine),controllerStatus:machine._a20Controller.readStatus()})){
        const event=keyQueue[0];
        const accepted=machine.keyIn(event.scan);
        lastOfferedStep=step;
        if(injected.length>=1_000){firstFailure='keyboard attempt cap';break;}
        injected.push({step,scan:event.scan,key:event.key,phase:event.phase,accepted});
        if(accepted){keyQueue.shift();lastAcceptedStep=step;}
      }
      observePayload(machine,witness,prefix);
      try{machine.step();}catch(error){firstFailure=`guest step: ${String(error?.message??error).slice(0,240)}`;break;}
      if(cpu.shutdown){firstFailure='CPU shutdown';break;}
    }
    const screen=rows(machine),after=Buffer.from(machine.ata.mediaBytes()),files=resultFiles(after);
    const keyboard={declined,requested:[FIRST_COMMAND,SECOND_COMMAND],injected,
      pending:keyQueue.length,lastAcceptedStep,lastOfferedStep};
    const graded=evaluate({witness,files,screen,returned,shutdown:cpu.shutdown,steps,keyboard});
    Object.assign(report,{
      firstFailure:firstFailure??(graded.passed?null:'acceptance checks failed'),
      checks:graded.checks,stage,steps,reset,final:cpuState(cpu),witness,
      keyboard,partialFatReads,
      screen,guestFiles:files});
    report.memory={configuredBytes:machine.memoryBytes,backingBytes:machine.mem.length,
      backingSha256:sha(machine.mem)};
    report.disk={bytes:after.length,initialSha256:input.diskSha256,finalSha256:sha(after)};
    report.devices=deviceStates(machine);
    Object.assign(report,{
      inputHashes:{bios:BIOS_SHA,vga:VGA_SHA,floppy:FLOPPY_SHA,client:LE_SHA,disk:input.diskSha256}});
    report.passed=graded.passed&&firstFailure===null;
  } catch(error) {
    const detail=String(error?.stack??error).slice(0,1500);
    if(report.firstFailure===null) report.firstFailure=detail;
    else report.secondaryFailure=detail;
  }
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  if(!report.passed)process.exitCode=1;
}

if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) await main();
