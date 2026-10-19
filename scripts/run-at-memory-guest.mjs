/** Exact-source bounded AT A20 + protected high-memory guest receipt. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {I8086Machine} from '../src/i8086-machine.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const hash=path=>createHash('sha256').update(readFileSync(resolve(repo,path))).digest('hex');
const m=new I8086Machine({clockHz:8_000_000,variant:'80286',cpuBackend:'protected286-experimental',
    memoryBytes:0x400000,a20:{controller:'8042',enabled:false},chips:[],
    regions:[{kind:'ram',start:0,end:0x3fffff}]});
const put=(at,bytes)=>m.mem.set(bytes,at);

// First write ffff:0010 with A20 disabled, poll 8042 IBF, enable A20, enter
// protected mode, fetch code from physical 100000h and write via a data
// segment based at 200000h.
put(0,[0xb8,0xff,0xff,0x8e,0xd8,0xc6,0x06,0x10,0x00,0x11,
    0xb0,0xd1,0xe6,0x64,0xe4,0x64,0xa8,0x02,0x75,0xfa,
    0xb0,0x03,0xe6,0x60,0xb8,0,0,0x8e,0xd8,0x0f,0x01,0x16,0x00,0x01,
    0xb8,0x01,0x00,0x0f,0x01,0xf0,0xea,0,0,8,0]);
put(0x100,[0x17,0,0,2,0]);
const descriptor=(at,base,access)=>put(at,[0xff,0xff,base&255,base>>8&255,base>>16&255,access,0,0]);
descriptor(0x208,0x100000,0x9a);descriptor(0x210,0x200000,0x92);
put(0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x34,0x12,0x89,0x06,0x20,0,0xf4]);
m.cpu.cs=0;m.cpu.ip=0;
let steps=0;while(!m.cpu.halted&&steps<40){m.step();steps++;}
const observed={halted:m.cpu.halted,steps,a20Enabled:m.a20Enabled,lowAlias:m.mem[0],
    hmaFirstByte:m.mem[0x100000],extendedWord:m.mem[0x200020]|m.mem[0x200021]<<8,
    cs:m.cpu.cs,ip:m.cpu.ip,ds:m.cpu.ds,pc:m.cpu.pc};
const expected={halted:true,steps:21,a20Enabled:true,lowAlias:0x11,hmaFirstByte:0xb8,
    extendedWord:0x1234,cs:8,ip:13,ds:0x10,pc:0x10000d};
assert.deepEqual(observed,expected);
const sources=['scripts/run-at-memory-guest.mjs','src/i8086-machine.js','src/i8086-ram-words.js',
    'src/at-8042-a20.js','src/i8086.js','src/experimental/i80286-protected.js'];
console.log(JSON.stringify({schemaVersion:1,revision,node:process.version,accepted:true,
    scope:'owned 80286 guest: original-AT 8042 D1 A20 enable, protected HMA fetch and bit-21 RAM write; not a full PC/AT',
    sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(path)])),expected,observed},null,2));
