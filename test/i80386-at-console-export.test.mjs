import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const script=new URL('../scripts/run-i80386-at-console.mjs',import.meta.url);
const source=fs.readFileSync(script,'utf8'),sha=b=>createHash('sha256').update(b).digest('hex');
function writer(mock){const ctx={fs:mock,Buffer,createHash,sha};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function writeHddOutput('),source.indexOf('const bios=readPinned'))+';this.writer=writeHddOutput;',ctx);return ctx.writer;}
const captured={bytes:Uint8Array.of(1,2,3),byteLength:3};
function fake(overrides={}){let bytes=Buffer.alloc(0),closes=0;return {constants:fs.constants,openSync:()=>7,fstatSync:()=>({isFile:()=>true,nlink:1,size:bytes.length}),writeSync(fd,b,o,n,p){assert.equal(fd,7);const count=Math.min(1,n);bytes=Buffer.concat([bytes,Buffer.from(b.subarray(o,o+count))]);return count;},readSync(fd,b,o,n,p){assert.equal(fd,7);return bytes.copy(b,o,p,p+n);},closeSync(fd){assert.equal(fd,7);closes++;},get closes(){return closes;},...overrides};}
test('positive partial writes verify stored bytes on same FD',()=>{const f=fake(),r=writer(f)('out',captured);assert.equal(r.sha256,sha(captured.bytes));assert.equal(r.byteLength,3);assert.equal(f.closes,1);});
test('zero write and bad readback refuse with one close',()=>{for(const change of [{writeSync:()=>0},{readSync:()=>0}]){const f=fake(change);assert.throws(()=>writer(f)('out',captured));assert.equal(f.closes,1);}});
test('write primary survives secondary close, close-only error refuses',()=>{const primary=new Error('primary');let closes=0;assert.throws(()=>writer(fake({writeSync(){throw primary;},closeSync(){closes++;throw Error('secondary');}}))('out',captured),e=>e===primary);assert.equal(closes,1);assert.throws(()=>writer(fake({closeSync(){throw primary;}}))('out',captured),e=>e===primary);});
test('existing file and symlink cannot be overwritten',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'at-output-'));try{const file=path.join(dir,'existing'),link=path.join(dir,'link');fs.writeFileSync(file,'keep');fs.symlinkSync(file,link);for(const target of [file,link])assert.throws(()=>writer(fs)(target,captured));assert.equal(fs.readFileSync(file,'utf8'),'keep');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('one authored NOP exports exact disk, preserves input, rejects reuse/native',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'at-cli-'));try{const bios=Buffer.alloc(65536,0x90),vga=Buffer.alloc(16384),disk=Buffer.alloc(34816);disk[123]=90;for(const [name,b]of Object.entries({bios,vga,disk}))fs.writeFileSync(path.join(dir,name),b);const output=path.join(dir,'out'),env={...process.env};for(const key of Object.keys(env))if(key.startsWith('AT_')||key.startsWith('VGA_'))delete env[key];Object.assign(env,{AT_BIOS_ROM:path.join(dir,'bios'),AT_BIOS_SHA256:sha(bios),VGA_BIOS_ROM:path.join(dir,'vga'),VGA_BIOS_SHA256:sha(vga),AT_HDD_SHA256:sha(disk)});const run=args=>spawnSync(process.execPath,[script.pathname,'--hdd-image',path.join(dir,'disk'),'--geometry','1,4,17','--steps','1','--hdd-output',output,...args],{env,encoding:'utf8',timeout:10000,maxBuffer:2097152});const r=run([]);assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.deepEqual(fs.readFileSync(output),disk);assert.deepEqual(fs.readFileSync(path.join(dir,'disk')),disk);assert.equal(report.hddOutput.input.sha256,sha(disk));assert.equal(report.hddOutput.output.sha256,sha(disk));assert.equal(report.hddOutput.guestCompletionQualified,false);assert.equal(report.steps,1);assert.equal(Object.keys(report.sourceSha256).length,79);assert.ok(Object.keys(report.sourceSha256).some(p=>p.endsWith("src/i80386-adapter.js")));assert.ok(Object.keys(report.sourceSha256).some(p=>p.endsWith("src/dosbox-config.js")));assert.equal(run([]).status,1);assert.equal(run(['--native-blocks']).status,1);fs.unlinkSync(output);bios[65520]=0x0f;bios[65521]=0x0b;fs.writeFileSync(path.join(dir,'bios'),bios);env.AT_BIOS_SHA256=sha(bios);const refused=run([]);assert.notEqual(refused.status,0);assert.equal(fs.existsSync(output),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
// Execute the exact production lifecycle, including live catch/finally and all
// finalizers. Only external terminal/machine operations are authored stubs.
async function lifecycle(change={}) {
  const calls=[],primary=new Error('guest-first'),secondary=new Error('cleanup-second');
  const ctx={options:{live:false,hddOutput:'out',hdd:'in'},guestFailure:null,
    steps:0,stepsLimit:1,stop:'budget',quit:false,refusal:null,
    runChunk(){ctx.steps=1;},flushModeCpuProfile(){calls.push('profile');},
    restoreCode16Interrupts(){calls.push('restore');},restoreNative32Fetch:null,
    restoreBroadBlockFetch:null,restoreCode16EventObserver:null,
    restoreCrossModeTraceObserver:null,restoreHotLoopFetch:null,
    machine:{cpu:{shutdown:false}},resolve:x=>x,
    captureI80386AtaMaster(){calls.push('capture');return {bytes:captured.bytes,byteLength:3,geometry:{},boundary:{}};},
    writeHddOutput(){calls.push('write');return {byteLength:3,sha256:sha(captured.bytes)};},
    hdd:{sha256:'input',bytes:captured.bytes},cylinders:1,heads:1,sectors:1,
    textRam(){calls.push('text');throw secondary;},
    onTerminalData(){},setImmediate:fn=>fn(),drawTerminal(){calls.push('draw');},
    process:{stdin:{isTTY:true,setRawMode(){},resume(){},on(){},removeListener(){},pause(){}},stdout:{isTTY:true,write(){}},on(){},off(){}}};
  change.setup?.(ctx,calls,primary,secondary);
  const code=source.slice(source.indexOf('let executionPrimary=null;'),source.indexOf('const planes=machine.vgaMemory'));
  vm.createContext(ctx);let error;try{await vm.runInContext('(async()=>{'+code+'})()',ctx);}catch(e){error=e;}
  return {calls,error,primary,secondary,ctx};
}
test('known guest error survives all attempted postloop finalizers without export',async()=>{
  const r=await lifecycle({setup(c,log,p,s){c.runChunk=()=>{c.guestFailure=p;c.refusal={};c.steps=1;};c.flushModeCpuProfile=()=>{log.push('profile');throw s;};}});
  assert.equal(r.error,r.primary);assert.deepEqual(r.calls,['profile','restore']);
});
test('thrown execution error survives finalizer failure without export',async()=>{
  const r=await lifecycle({setup(c,log,p,s){c.runChunk=()=>{throw p;};c.flushModeCpuProfile=()=>{log.push('profile');throw s;};}});
  assert.equal(r.error,r.primary);assert.deepEqual(r.calls,['profile','restore']);
});
test('live guest error precedes later draw and terminal cleanup failures',async()=>{
  const r=await lifecycle({setup(c,log,p,s){c.options.live=true;c.runChunk=()=>{c.guestFailure=p;c.refusal={};c.steps=1;};let draws=0;c.drawTerminal=()=>{log.push('draw');if(++draws===2)throw s;};c.process.stdin.pause=()=>{throw s;};}});
  assert.equal(r.error,r.primary);assert.deepEqual(r.calls,['draw','draw','profile','restore']);
});
test('cleanup failure forbids export; successful copy precedes fallible video/report collection',async()=>{
  const failed=await lifecycle({setup(c,log,p,s){c.restoreCode16Interrupts=()=>{throw s;};}});assert.equal(failed.error,failed.secondary);assert.deepEqual(failed.calls,['profile']);
  const ok=await lifecycle();assert.equal(ok.error,ok.secondary);assert.deepEqual(ok.calls,['profile','restore','capture','write','text']);
});
test('failed real write leaves a partial file and never reports success',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'at-partial-')),file=path.join(dir,'partial');let writes=0;
  const primary=new Error('second-write');const mock={...fs,writeSync(...args){if(writes++)throw primary;return fs.writeSync(args[0],args[1],args[2],1,args[4]);}};
  try{assert.throws(()=>writer(mock)(file,captured),e=>e===primary);assert.deepEqual(fs.readFileSync(file),Buffer.from([1]));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('without output a known guest refusal still reaches ordinary report collection',async()=>{
  const r=await lifecycle({setup(c,log,p){c.options.hddOutput=null;c.runChunk=()=>{c.guestFailure=p;c.refusal={name:p.name,message:p.message};c.steps=1;};}});
  assert.equal(r.error,r.secondary);assert.deepEqual(r.calls,['profile','restore','text']);
});
