#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {I8086Machine,PCAT80286} from '../src/i8086-machine.js';

const outArg=process.argv.indexOf('--out');
if(outArg<0||!process.argv[outArg+1])throw new Error('usage: run-at-devices-guest.mjs --out FILE');
const init=(p,base,id)=>{p.write(0,0x11);p.write(1,base);p.write(1,id);p.write(1,1);};
const m=new I8086Machine(PCAT80286),rtc=m.chips.rtc1;
init(m.chips.pic1,0x20,4);init(m.chips.pic2,0x28,2);
m.mem.set([0x00,0x01,0x00,0x00],0x28*4);
m.mem.set([0xfe,0x06,0x00,0x03,0xb0,0x0c,0xe6,0x70,0xe4,0x71,0xb0,0x20,0xe6,0xa0,0xe6,0x20,0xcf],0x100);
m.mem.set([0xf4,0xf4],0x200);m.cpu.cs=0;m.cpu.ip=0x200;m.cpu.ss=0;m.cpu.sp=0x800;m.cpu.flags|=0x200;
rtc.write(0,0x0b);rtc.write(1,0x42);rtc.advance(Math.ceil(m.clockHz/1024));
let steps=0;while(!m.cpu.halted&&steps<30){m.step();steps++;}
const observed={halted:m.cpu.halted,handlerCount:m.mem[0x300],rtcStatusC:rtc.ram[0x0c],masterISR:m.chips.pic1.isr,slaveISR:m.chips.pic2.isr,steps};
const expected={halted:true,handlerCount:1,rtcStatusC:0,masterISR:0,slaveISR:0};
const accepted=Object.entries(expected).every(([k,v])=>observed[k]===v);
const paths=['scripts/run-at-devices-guest.mjs','src/i8086-machine.js','src/at-8042-a20.js','src/mc146818.js','src/i8086.js'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(resolve(p))).digest('hex')])));
const receipt={schemaVersion:1,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,accepted,
    scope:'owned real-mode 80286 guest IRQ8 handler through MC146818 and cascaded 8259s; not full AT BIOS evidence',sourceHashes,expected,observed};
await writeFile(resolve(process.argv[outArg+1]),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(!accepted)process.exitCode=1;
