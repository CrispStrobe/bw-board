// Compiles a standalone WASM side-exit proof into /tmp; no production wiring.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const source=fileURLToPath(new URL(
  '../src/experimental/i80386-native-trace-side-exit-spike.c',import.meta.url));
const directory=await mkdtemp(path.join(os.tmpdir(),'i80386-trace-side-exit-'));
const output=path.join(directory,'trace-spike.wasm');
try {
  execFileSync('clang',['--target=wasm32','-O3','-Wall','-Wextra','-Werror',
    '-nostdlib','-fuse-ld=/usr/bin/wasm-ld','-Wl,--no-entry',
    '-Wl,--export-all','-Wl,--export-memory',
    '-Wl,--initial-memory=131072','-Wl,--max-memory=131072',
    '-o',output,source],{stdio:'pipe'});
  const module=await WebAssembly.compile(await readFile(output));
  const code=Uint8Array.of(0x90,0x75,0x03,0x90,0x90,0x90,0x90);
  const cases=[
    {zf:false,budget:1,reason:1,retired:1,eip:1},
    {zf:false,budget:2,reason:2,retired:2,eip:6},
    {zf:false,budget:4,reason:2,retired:2,eip:6},
    {zf:true,budget:2,reason:1,retired:2,eip:3},
    {zf:true,budget:3,reason:1,retired:3,eip:4},
    {zf:true,budget:4,reason:0,retired:4,eip:5},
  ];
  for (const expected of cases) {
    const {exports:wasm}=await WebAssembly.instantiate(module);
    assert.equal(wasm.trace_spike_version(),1);
    const words=new Uint32Array(wasm.memory.buffer);
    const stateAt=wasm.trace_spike_state_ptr()>>>2;
    const programAt=wasm.trace_spike_program_ptr()>>>2;
    words[stateAt+8]=0;
    words[stateAt+9]=expected.zf?0x42:2;
    words[stateAt+10]=0;
    words.set(Uint32Array.of(
      0,1,0,0,     // NOP at guest EIP 0
      1,2,6,0,     // JNZ at guest EIP 1; taken side exit to EIP 6
      0,1,0,0,     // Fallthrough NOP at EIP 3
      0,1,0,0),programAt); // Fallthrough NOP at EIP 4
    const packed=wasm.trace_spike_run(4,expected.budget);
    const reason=packed>>>24,retired=packed&0xffffff;
    assert.deepEqual({reason,retired,eip:words[stateAt+8]},
      {reason:expected.reason,retired:expected.retired,eip:expected.eip});

    const cpu=new I80386({read:a=>code[a]??0,fetch:a=>code[a]??0,write(){}});
    cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
      present:true,code:true,readable:true,writable:false};
    cpu.eflags=expected.zf?0x42:2;
    for(let i=0;i<retired;i++)cpu.step();
    assert.deepEqual({eip:words[stateAt+8],eflags:words[stateAt+9],
      cycles:words[stateAt+10],regs:Array.from(words.slice(stateAt,stateAt+8))},
    {eip:cpu.eip,eflags:cpu.eflags,cycles:cpu.cycles,
      regs:[cpu.eax,cpu.ecx,cpu.edx,cpu.ebx,cpu.esp,cpu.ebp,cpu.esi,cpu.edi]});
  }
  console.log(`trace side-exit and deadline parity: ${cases.length}/${cases.length}`);
} finally {
  await rm(directory,{recursive:true,force:true});
}
