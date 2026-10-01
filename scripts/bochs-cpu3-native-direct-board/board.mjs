/** Synchronous actual-board callbacks; no native execution or qualification claim. */
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {NativeCombinedPagingRamHost,combinedBoardConfig,combinedBoardState,combinedSha} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
const check=(ok,m)=>{if(!ok)throw Error('direct board callback: '+m);};
const uint=(v,max=0xffffffff)=>check(Number.isSafeInteger(v)&&v>=0&&v<=max,'unsigned argument');
export class DirectBoardFacade {
 constructor(rom,{capture=null}={}) {
  check(rom instanceof Uint8Array&&rom.length===65536,'64 KiB ROM');check(capture===null||typeof capture==='function','capture sink');
  this.capture=capture;this.active=false;this.running=false;this.closed=false;this.nativeTicks=0;this.successfulQuanta=0;this.mappingEpoch=0;this.generations=new Map();this.pages=[];this.marker=[];this.lineAsserted=false;
  this.machine=new ExperimentalI80386ATMachine(combinedBoardConfig);
  const m=this.machine;m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();check(m.cycles===4&&m._chipDebt===0&&m._a20Enabled,'reset epoch');
  m.cpu.step=()=>{throw Error('direct board callback: JavaScript CPU stepping forbidden');};
  const a20=m._a20Controller.onA20Change;m._a20Controller.onA20Change=enabled=>{check(this.active&&this.running&&!this.closed,'unauthorized A20 mutation before effect');check(this.mappingEpoch<0xffffffff,'mapping overflow before A20 effect');const before=m._a20Enabled;const r=a20(enabled);if(before!==m._a20Enabled)this.mappingEpoch++;return r;};
 }
 _class(decoded){return NativeCombinedPagingRamHost.prototype._class.call(this,decoded);}
 span(raw,width,options){return NativeCombinedPagingRamHost.prototype.span.call(this,raw,width,options);}
 inspect(){return {nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,mappingEpoch:this.mappingEpoch,lineAsserted:this.lineAsserted,generations:[...this.generations].sort((a,b)=>a[0]-b[0]),board:combinedBoardState(this.machine),javascriptCpuCycles:this.machine.cpu.cycles,marker:Buffer.from(this.marker).toString('ascii')};}
 beginRun(){check(!this.closed&&!this.running&&!this.active,'begin lifecycle');if(this.machine._chipDebt>=this.machine._chipDeadline)this.machine._flushChips();this.running=true;}
 endRun(){check(this.running&&!this.active,'end lifecycle');this.running=false;}
 _call(operation,args,fn){check(this.running&&!this.active&&!this.closed,'callback reentry or lifecycle');this.active=true;try{const before=this.capture?this.inspect():null;const result=fn();if(this.capture)this.capture({operation,args,result,before,after:this.inspect()});return result;}finally{this.active=false;}}
 _generation(decoded){return this.generations.get((decoded&0xfffff000)>>>0)??0;}
 _memory(raw,bytes,write){return this._call(write?'write':'read',this.capture?[raw,bytes.length,write?Uint8Array.from(bytes):null]:null,()=>{
  const {decoded,kind}=this.span(raw,bytes.length);const page=(decoded&0xfffff000)>>>0;
  if(write&&kind===1){check(this._generation(decoded)<0xffffffff,'generation overflow before effect');check(this.generations.has(page)||this.generations.size<64,'generation capacity before effect');}
  const operand=write?Uint8Array.from(bytes):null; // Snapshot a bounded operand before overlapping backing effects.
  for(let i=0;i<bytes.length;i++){if(write)this.machine._write386(raw+i,operand[i]);}
  const observed=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)observed[i]=this.machine._read386(raw+i);
  if(write&&kind===1)this.generations.set(page,this._generation(decoded)+1);
  return {bytes:observed,decoded,kind,effect:write?(kind===1?1:kind===2?2:3):0,generation:kind===1?this._generation(decoded):0,mappingEpoch:this.mappingEpoch,boardA20:Number(this.machine._a20Enabled)};
 });}
 readPhysical(raw,width){uint(width,16);check(width>0,'read width');return this._memory(raw,new Uint8Array(width),false);}
 writePhysical(raw,bytes){check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=16,'write bytes');return this._memory(raw,bytes,true);}
 admitExecutePage(raw){return this._call('page',[raw],()=>{check(this.pages.length<64,'persistent page capacity');const {decoded,kind}=this.span(raw,4096,{execute:true});const bytes=new Uint8Array(4096);for(let i=0;i<4096;i++)bytes[i]=this.machine._read386(raw+i);const page={bytes,raw,decoded,kind,generation:kind===1?this._generation(decoded):0,mappingEpoch:this.mappingEpoch,boardA20:Number(this.machine._a20Enabled),sha256:combinedSha(bytes)};this.pages.push(page);return page;});}
 quantum(kind){return this._call('quantum',[kind],()=>{check(kind===0||kind===1,'work kind');check(this.successfulQuanta<300,'quantum cap');this.successfulQuanta++;this.machine.cycles+=6;this.machine._chipDebt+=6;return Number(this.machine._chipDebt>=this.machine._chipDeadline);});}
 nativeTick(){return this._call('nativeTick',[],()=>{check(this.nativeTicks<600,'tick cap');this.nativeTicks++;return 0;});}
 outPort(port,width,value){return this._call('outPort',[port,width,value],()=>{uint(port,65535);uint(value,255);check(width===1&&[0x20,0x21,0xa0,0xa1,0x40,0x43,0x60,0x64,0xe9].includes(port),'port admission');check(this.mappingEpoch<0xffffffff,'mapping overflow before effect');
  // Source-backed free-guest subset: 8042 writeCommand D1 and writeData bit0=1.
  if(port===0x64)check(value===0xd1,'8042 command before effect');
  if(port===0x60)check(this.machine._a20Controller.pendingCommand===0xd1&&[1,3].includes(value),'8042 output port before effect');
  this.machine._out386(port,value,8);check(this.machine._fastA20Latch===0&&!this.machine._cpuResetPending,'reset/fast latch');if(port===0xe9)this.marker.push(value);return {value:0,boardA20:Number(this.machine._a20Enabled),mappingEpoch:this.mappingEpoch};});}
 stageLine(){check(!this.running&&!this.active&&!this.closed,'line phase');if(this.machine._chipDebt>=this.machine._chipDeadline)this.machine._flushChips();const asserted=!!this.machine._pic.intActive,changed=asserted!==this.lineAsserted;this.lineAsserted=asserted;return {asserted,changed};}
 acknowledgeIrq(){return this._call('ack',[],()=>{check(this.lineAsserted&&this.machine._pic.intActive,'PIC eligibility');check(this.machine._pic._serviceable()===0&&!this.machine.chips.pic2.intActive,'PIC scope');const vector=this.machine._pic.acknowledge();check(vector===0x20,'PIC vector');return vector;});}
 settleTerminal(){check(!this.running&&!this.active&&!this.closed,'terminal phase');this.machine._catchUpChips();return this.inspect();}
 close(){check(!this.running&&!this.active&&!this.closed,'close phase');this.closed=true;/* Buffers remain retained: addon close must release CPU pointers before dropping facade. */}
}
