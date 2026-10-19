#!/usr/bin/env node
// Media-free, same-workload x86 throughput comparison. 386 cycles are a
// declared scheduling charge, not measured Intel 80386 instruction timings.
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {I8086} from '../src/i8086.js';
import {I8086Machine} from '../src/i8086-machine.js';
import I80386 from '../src/experimental/i80386.js';
import I80386ATMachine, {PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';

const XT_HZ = 4_772_727;
const AT_HZ = 16_000_000;
const STEPS = Number(process.argv[process.argv.indexOf('--steps') + 1] || 1_000_000);
const PASSES = Number(process.argv[process.argv.indexOf('--passes') + 1] || 3);
if (!Number.isSafeInteger(STEPS) || STEPS < 1 || STEPS > 20_000_000 ||
    !Number.isSafeInteger(PASSES) || PASSES < 1 || PASSES > 9)
  throw new Error('--steps must be 1..20000000 and --passes 1..9');

// Five instructions: INC AX; MOV [2000],AX; MOV BX,[2000]; ADD AX,BX; JMP 0000.
// Both CPUs run these exact real-mode bytes; the 386's 32-bit features are not
// exercised by this comparison.
const CODE = Uint8Array.from([0x40,0x89,0x06,0x00,0x20,0x8b,0x1e,0x00,0x20,0x01,0xd8,0xe9,0xf2,0xff]);
function make8086Core() {
  const mem = new Uint8Array(1 << 20); mem.set(CODE);
  const cpu = new I8086({read:a=>mem[a & 0xfffff],write:(a,v)=>{mem[a & 0xfffff]=v;},in:()=>0xff,out:()=>{}});
  cpu.reset(); cpu.cs=0; cpu.ip=0; cpu.ds=0; cpu.ss=0x4000; cpu.sp=0xfffe;
  return {step:()=>cpu.step(), state:()=>({ax:cpu.ax,bx:cpu.bx,ip:cpu.ip,word:mem[0x2000] | mem[0x2001]<<8})};
}
function make8086Machine() {
  const m = new I8086Machine({clockHz:XT_HZ, regions:[{kind:'ram',start:0,end:0x9ffff},{kind:'rom',start:0xf0000,end:0xfffff}],chips:[
    {kind:'pic',name:'pic1',at:0x20},{kind:'pit',name:'pit1',at:0x40,irq:0},{kind:'ppi',name:'ppi1',at:0x60},{kind:'cga',name:'cga1',at:0x3d0}]});
  m.mem.set(CODE); m.cpu.reset(); m.cpu.cs=0; m.cpu.ip=0; m.cpu.ds=0; m.cpu.ss=0x4000; m.cpu.sp=0xfffe;
  return {step:()=>m.step(), state:()=>({ax:m.cpu.ax,bx:m.cpu.bx,ip:m.cpu.ip,word:m.mem[0x2000] | m.mem[0x2001]<<8})};
}
function make386Core() {
  const mem = new Uint8Array(1 << 20); mem.set(CODE);
  const cpu = new I80386({read:a=>mem[a & 0xfffff],fetch:a=>mem[a & 0xfffff],write:(a,v)=>{mem[a & 0xfffff]=v;}});
  cpu.cs=0; cpu.eip=0; cpu.ds=0; cpu.ss=0x4000; cpu.esp=0xfffe;
  return {step:()=>cpu.step(),state:()=>({ax:cpu.eax & 0xffff,bx:cpu.ebx & 0xffff,ip:cpu.eip,word:mem[0x2000] | mem[0x2001]<<8})};
}
function make386Machine() {
  const m = new I80386ATMachine({...PCAT80386_EXPERIMENTAL,clockHz:AT_HZ});
  m.mem.set(CODE); m.cpu.cs=0; m.cpu.eip=0; m.cpu.ds=0; m.cpu.ss=0x4000; m.cpu.esp=0xfffe;
  return {step:()=>m.step(),state:()=>({ax:m.cpu.eax & 0xffff,bx:m.cpu.ebx & 0xffff,ip:m.cpu.eip,word:m.mem[0x2000] | m.mem[0x2001]<<8})};
}
const defs = [
  ['8086-core',make8086Core,XT_HZ,'estimated 8086 instruction cycles'],
  ['8086-machine',make8086Machine,XT_HZ,'estimated 8086 instruction cycles'],
  ['386-core',make386Core,AT_HZ,'one synthetic cycle per completed instruction'],
  ['386-at-machine',make386Machine,AT_HZ,'six synthetic scheduling cycles per completed instruction'],
];
function measure(make) {
  const b=make(); let cycles=0;
  const start=process.hrtime.bigint();
  for(let i=0;i<STEPS;i++) cycles+=b.step();
  const seconds=Number(process.hrtime.bigint()-start)/1e9;
  const state=b.state();
  if(state.word===0 && state.ax===0 && state.bx===0) throw new Error('no observable guest progress');
  return {seconds,cycles,state};
}
const rows=[];
for(const [name,make,hz,cycleMeaning] of defs) {
  measure(make); // V8 warmup, excluded
  const runs=Array.from({length:PASSES},()=>measure(make));
  const med=[...runs].sort((a,b)=>a.seconds-b.seconds)[Math.floor(PASSES/2)];
  rows.push({name,clockHz:hz,cycleMeaning,steps:STEPS,passes:PASSES,
    instructionsPerSecond:STEPS/med.seconds,
    virtualFactor:med.cycles/med.seconds/hz,
    medianSeconds:med.seconds,
    cycles:med.cycles,state:med.state,
    runSeconds:runs.map(r=>r.seconds)});
}
const git=(...args)=>{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
if (rows.some(row => JSON.stringify(row.state) !== JSON.stringify(rows[0].state)))
  throw new Error('guest results diverged across paths');
console.log(JSON.stringify({schema:'bw.x86-platform-benchmark.v1',revision:process.env.BENCH_SOURCE_REVISION || git('rev-parse','HEAD'),
  dirty:!!git('status','--porcelain','--','src/i8086.js','src/i8086-machine.js','src/experimental/i80386.js','src/experimental/i80386-at-machine.js','scripts/bench-x86-platforms.mjs'),
  host:{platform:process.platform,arch:process.arch,cpus:os.cpus().map(c=>c.model).filter((v,i,a)=>a.indexOf(v)===i),logicalCpus:os.cpus().length,node:process.version,githubRunner:process.env.RUNNER_NAME??null,kaggleGpu:process.env.KAGGLE_GPU_MODEL??null},
  note:'386 real-mode workload; its virtual factor uses configured synthetic instruction charges and is not measured 80386 timing',rows},null,2));
