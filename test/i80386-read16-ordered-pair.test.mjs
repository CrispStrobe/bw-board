import test from 'node:test';
import assert from 'node:assert/strict';
import CPU,{I80386Fault} from '../src/experimental/i80386.js';
import Machine,{PCAT80386_EXPERIMENTAL as config} from '../src/experimental/i80386-at-machine.js';
import {make,execute} from '../scripts/i80386-at-profile/fixture.mjs';
import {measured} from '../scripts/i80386-read16-paired/fixture.mjs';

function scalar(method=CPU.prototype._readLinear) {
  const events=[];
  const cpu=new CPU({read(address){events.push(['read',address,this===cpu]);return address&1?0x92:0x37;}});
  cpu._readLinear=method;
  cpu._translate=function(address,options){events.push(['translate',address,options]);return address;};
  return {cpu,events};
}

// Also applied to deliberately broken actual-source methods below. Expected
// values/traces are authored, not obtained from a second candidate execution.
function orderedContract(method) {
  const {cpu,events}=scalar(method),options=Object.freeze({supervisor:true});
  assert.equal(cpu._readLinear(0x120,2,options),0x9237);
  assert.deepEqual(events,[['translate',0x120,options],['read',0x120,true],['read',0x121,true]]);
  events.length=0;
  cpu._translate=(a,o)=>{events.push(['translate',a,o]);return 0xffffffff;};
  cpu.read=a=>{events.push(['read',a]);return a===0xffffffff?0x123:-2;};
  assert.equal(cpu._readLinear(0x120,2,options),0xfe23);
  assert.deepEqual(events,[['translate',0x120,options],['read',0xffffffff],['read',0]]);

  events.length=0;
  cpu._translate=a=>a;
  cpu.read=function(a){
    events.push(['first',a]);
    this.read=function(b){events.push(['replacement',b,this===cpu]);return 0xab;};
    return {valueOf(){events.push(['coerce']);return 0x134;}};
  };
  assert.equal(cpu._readLinear(0x120,2),0xab34);
  assert.deepEqual(events,[['first',0x120],['coerce'],['replacement',0x121,true]]);
}

test('same-page word keeps ordered masked callbacks, options, wrap and fresh reader lookup',()=>{
  orderedContract(CPU.prototype._readLinear);
});

test('word values include zero, sign bits and absent bus data',()=>{
  for(const [bytes,wanted] of [[[0,0],0],[[255,255],65535],[[128,1],384],[[undefined,0x180],32768],[[-1,-256],255]]){
    const {cpu}=scalar();let index=0;cpu.read=()=>bytes[index++];
    assert.equal(cpu._readLinear(0x20,2),wanted);assert.equal(index,2);
  }
});

function faultContract(method) {
  for(const phase of ['translate','first','coercion','second']){
    const {cpu,events}=scalar(method),failure={phase};
    cpu._translate=(a,o)=>{events.push('translate');if(phase==='translate')throw failure;return 0x20;};
    cpu.read=a=>{events.push(a);if(phase==='first'||(phase==='second'&&a===0x21))throw failure;
      return phase==='coercion'?{valueOf(){events.push('coerce');throw failure;}}:0x42;};
    assert.throws(()=>cpu._readLinear(0x20,2),error=>error===failure);
    assert.deepEqual(events,phase==='translate'?['translate']:phase==='second'?['translate',0x20,0x21]:phase==='coercion'?['translate',0x20,'coerce']:['translate',0x20]);
  }
}

test('translation and either callback preserve the first thrown object and completed side effects',()=>faultContract(CPU.prototype._readLinear));

function crossPageContract(method) {
  const {cpu,events}=scalar(method),options=Object.freeze({supervisor:true});
  cpu._translate=(a,o)=>{events.push(['translate',a,o]);return a===0xfff?0x4fff:0x7000;};
  cpu.read=a=>{events.push(['read',a]);return a===0x4fff?0x12:0x34;};
  assert.equal(cpu._readLinear(0xfff,2,options),0x3412);
  assert.deepEqual(events,[['translate',0xfff,options],['read',0x4fff],['translate',0x1000,options],['read',0x7000]]);
  events.length=0;const failure={page:1};
  cpu._translate=(a,o)=>{events.push(['translate',a,o]);if(a===0x1000)throw failure;return 0x4fff;};
  assert.throws(()=>cpu._readLinear(0xfff,2,options),e=>e===failure);
  assert.deepEqual(events,[['translate',0xfff,options],['read',0x4fff],['translate',0x1000,options]]);
}

test('cross-page words translate each byte in order and preserve second translation faults',()=>crossPageContract(CPU.prototype._readLinear));

test('linear 32-bit wrap still uses two translations',()=>{
  const {cpu,events}=scalar();cpu.read=a=>{events.push(['read',a]);return a===0xffffffff?0x56:0x78;};
  assert.equal(cpu._readLinear(0xffffffff,2),0x7856);
  assert.deepEqual(events,[['translate',0xffffffff,undefined],['read',0xffffffff],['translate',0,undefined],['read',0]]);
});

function otherWidthsContract(method) {
  const {cpu,events}=scalar(method);
  assert.equal(cpu._readLinear(0x20,1),0x37);
  assert.deepEqual(events,[['translate',0x20,undefined],['read',0x20,true]]);
  events.length=0;cpu.read32=a=>{events.push(['read32',a]);return -1;};
  assert.equal(cpu._readLinear(0x20,4),0xffffffff);
  assert.deepEqual(events,[['translate',0x20,undefined],['read32',0x20]]);
  events.length=0;cpu.read32=null;
  assert.equal(cpu._readLinear(0x20,4),0x92379237);
  assert.deepEqual(events,[['translate',0x20,undefined],['read',0x20,true],['read',0x21,true],['read',0x22,true],['read',0x23,true]]);
}

test('size-one, size-four bus and byte fallback behavior is unchanged',()=>otherWidthsContract(CPU.prototype._readLinear));

test('actual paging retains accessed bits and first bus side effect before a second-page fault',()=>{
  const memory=new Map(),reads=[];
  const put=(a,v)=>{for(let i=0;i<4;i++)memory.set(a+i,(v>>>(8*i))&255);};
  const word=a=>(memory.get(a)??0)|((memory.get(a+1)??0)<<8);
  const cpu=new CPU({read(a){reads.push(a);return memory.get(a)??0;},write(a,v){memory.set(a,v&255);}}, {translationCache:false});
  put(0x1000,0x2007);put(0x2000,0x4007);put(0x2004,0);
  memory.set(0x4fff,0x9a);cpu.cr0=0x80000001;cpu.cr3=0x1000;
  assert.throws(()=>cpu._readLinear(0xfff,2),e=>e instanceof I80386Fault&&e.vector===14&&e.errorCode===0);
  assert.equal(cpu.cr2,0x1000);assert.ok(word(0x1000)&0x20);assert.ok(word(0x2000)&0x20);
  assert.equal(word(0x2000)&0x40,0);assert.equal(reads.filter(a=>a===0x4fff).length,1);
  assert.equal(reads.includes(0x5000),false);
});

test('five authored core and AT instructions retain register, memory and device goldens',()=>{
  for(const kind of ['core','at']){
    const s=make(kind,CPU,Machine,config),r=execute(s,5);
    assert.deepEqual(r.state,{ax:2,bx:1,ip:0,word:1});assert.equal(r.cpuCycles,5);
    assert.equal(r.charges,kind==='at'?30:5);assert.equal(r.ifEnabled,false);assert.equal(r.interrupts,0);
    if(kind==='at'){assert.equal(r.devices.machineCycles,30);assert.equal(r.devices.debt,30);assert.equal(r.devices.appliedClocks,0);assert.equal(r.devices.cga.cycles,0);}
  }
});

test('new paired fixture isolates throwaway warm state using only five-step controls',()=>{
  const packet=measured(CPU,Machine,config,5,5);
  assert.deepEqual(packet.semantic.state,{ax:2,bx:1,ip:0,word:1});
  assert.equal(packet.semantic.steps,5);assert.equal(packet.semantic.devices.machineCycles,30);
  assert.equal(packet.warmupSteps,5);assert.equal(packet.warmupDoesNotContributeToMeasuredState,true);
  assert.throws(()=>measured(CPU,Machine,config,1000001,5));
});

test('actual-source mutations are detected by independently authored callback contracts',()=>{
  const source=CPU.prototype._readLinear.toString();
  const changes=[
    ['endian','return low | (high << 8);','return high | (low << 8);'],
    ['low mask','const low = this.read(physical) & 255;','const low = this.read(physical);'],
    ['high mask','const high = this.read((physical + 1) >>> 0) & 255;','const high = this.read((physical + 1) >>> 0);'],
    ['physical wrap','this.read((physical + 1) >>> 0) & 255','this.read(physical + 1) & 255'],
    ['extra translation','const high = this.read((physical + 1) >>> 0) & 255;','const high = this.read(this._translate((a + 1) >>> 0, options)) & 255;'],
    ['reversed callbacks','const low = this.read(physical) & 255;\n        const high = this.read((physical + 1) >>> 0) & 255;','const high = this.read((physical + 1) >>> 0) & 255; const low = this.read(physical) & 255;'],
    ['swallowed first fault','const low = this.read(physical) & 255;','let low; try { low = this.read(physical) & 255; } catch { low = 0; }'],
    ['swallowed second fault','const high = this.read((physical + 1) >>> 0) & 255;','let high; try { high = this.read((physical + 1) >>> 0) & 255; } catch { high = 0; }'],
    ['page crossing','((a & 0xfff) + size <= 0x1000)','true'],
    ['size four','if (size === 2) {','if (size === 2 || size === 4) {'],
    ['cached reader','const low = this.read(physical) & 255;','const savedRead = this.read; this.read = savedRead.bind(this); const low = this.read(physical) & 255;'],
  ];
  for(const [name,before,after] of changes){
    assert.ok(source.includes(before),name+' mutation site');
    let changed=source.replace(before,after);
    if(name==='cached reader')changed=changed.replace('const high = this.read((physical + 1) >>> 0) & 255;','const high = savedRead.call(this, (physical + 1) >>> 0) & 255;');
    const method=Function('return function '+changed)();
    assert.throws(()=>{orderedContract(method);faultContract(method);crossPageContract(method);otherWidthsContract(method);},name+' must fail');
  }
});
