/** Actual AT board authority; native CPU executes compact combined paging/RAM/REP ROM. */
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL} from '../../src/experimental/i80386-at-machine.js';
export const combinedBoardConfig=Object.freeze({...PCAT80386_EXPERIMENTAL,experimentalFastA20Port92:true});
export const combinedBudgets=Object.freeze({continuous:300,budget1:1,budget2:2,budget257:257});
export const combinedKind=Object.freeze({ram:1,rom:2,mmio:3,unmapped:4});
export const combinedEffect=Object.freeze({readObserved:0,ramCommit:1,romIgnored:2,unmappedIgnored:3});
export const combinedSha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(ok,message)=>{if(!ok)throw Error(`combined paging/RAM/REP board host: ${message}`);};
const uint=(n,max=0xffffffff)=>{check(Number.isSafeInteger(n)&&n>=0&&n<=max,'unsigned integer outside range');return n;};
export function combinedBoardState(m){
  return clone({cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,
    a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),fastA20Latch:m._fastA20Latch,cpuResetPending:!!m._cpuResetPending,
    interruptSignals:{nmiPending:!!m._nmiPending,nmiMasked:!!m._nmiMasked,kbdStrobe:!!m._kbdStrobe,pinLevels:{...m._pinLevels}},
    chipStates:Object.fromEntries(Object.entries(m.chips).map(([name,chip])=>{check(typeof chip.getState==='function',`configured chip lacks state snapshot: ${name}`);return [name,chip.getState()];})),
    pit:{...m.chips.pit1.getState(),fraction:m.chips.pit1._frac,clockHz:m.chips.pit1.clockHz},
    pic1:m.chips.pic1.getState(),pic2:m.chips.pic2.getState(),rtc:m.chips.rtc1.getState(),
    dma1:m.chips.dma1.getState(),dma2:m.chips.dma2.getState(),systemControl:m.chips.sysctl.getState()});
}

export class NativeCombinedPagingRamHost{
  constructor(rom){
    check(rom instanceof Uint8Array&&rom.length===65536,'ROM must contain exactly 64 KiB');
    this.nativeTicks=0;this.successfulQuanta=0;this.mappingEpoch=0;this.generations=new Map();this.running=false;this.closed=false;
    this.journal=[];this.bus=[];this.marker=[];this.nextRequest=1;this._requestActive=false;
    this.machine=new ExperimentalI80386ATMachine(combinedBoardConfig,{onPortAccess:e=>{
      check(this._requestActive,'PIO outside synchronous owned callback');
      this._record('board-pio',e);
    }});
    const m=this.machine;this.initial=combinedBoardState(m);
    m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();
    this.seed={domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:combinedSha(m.mem)};
    this.reset=combinedBoardState(m);
    check(m.cycles===4&&m._chipDebt===0&&m._a20Enabled,'fresh single reset epoch changed');
    this.lineAsserted=false;this.chipAdvances=[];
    const a20=m._a20Controller.onA20Change;m._a20Controller.onA20Change=enabled=>{
      const before=m._a20Enabled,result=a20(enabled);
      if(before!==m._a20Enabled){check(this._requestActive,'mapping change outside actual owned PIO');check(this.mappingEpoch<0xffffffff,'mapping epoch overflow');this.mappingEpoch++;this._record('mapping-change',{before,after:m._a20Enabled,mappingEpoch:this.mappingEpoch});}
      return result;
    };
    const advance=m._advanceChips.bind(m);m._advanceChips=n=>{const before=combinedBoardState(m);advance(n);this.chipAdvances.push({clocks:n,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,before,after:combinedBoardState(m)});};
    const output=m.chips.pit1.hooks.onOutput;m.chips.pit1.hooks.onOutput=(channel,level)=>{output?.(channel,level);this._record('pit-output',{channel,level});};
    this._cpuStep=m.cpu.step;m.cpu.step=()=>{throw Error('combined paging/RAM/REP board host: JavaScript CPU execution forbidden');};
  }
  state(){return {nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,
    javascriptCpuCycles:this.machine.cpu.cycles,mappingEpoch:this.mappingEpoch,lineAsserted:this.lineAsserted,generations:[...this.generations].sort((a,b)=>a[0]-b[0]),board:combinedBoardState(this.machine),marker:Buffer.from(this.marker).toString('ascii')};}
  _record(kind,details={}){
    this.journal.push({ordinal:this.journal.length+1,kind,nativeTicks:this.nativeTicks,
      successfulQuanta:this.successfulQuanta,boardCycles:this.machine.cycles,...clone(details)});
  }
  _class(decoded){
    const m=this.machine;
    // Exclude the whole video aperture before the RAM/page-table shortcut.
    // The base profile has open holes and CGA RAM here; future VGA overlays
    // precede _read in the actual board. No classification/effect claim for
    // this excluded aperture is returned to the native CPU.
    if(decoded>=0xa0000&&decoded<=0xbffff)return combinedKind.mmio;
    if(m._mmio.some(w=>decoded>=w.start&&decoded<=w.end))return combinedKind.mmio;
    if(decoded>=m.memoryBytes)return combinedKind.unmapped;
    const page=m._page[decoded>>>12];
    if(page===1)return combinedKind.ram;if(page===2)return combinedKind.rom;if(page===0)return combinedKind.unmapped;
    const region=m._mem.find(r=>decoded>=r.start&&decoded<=r.end);
    return region?combinedKind[region.kind]:combinedKind.unmapped;
  }
  span(raw,width,{execute=false}={}){
    uint(raw);uint(width,execute?4096:16);
    check(width>0&&raw<=0xffffffff-(width-1),'unsupported or overflowing physical span');
    check((raw&4095)+width<=4096,'physical span crosses page');
    const m=this.machine,decoded=m._decode386(raw),kind=this._class(decoded);
    check(kind!==combinedKind.mmio,'MMIO is outside first ram fixture');
    check(decoded<=0xffffffff-(width-1),'decoded span overflows');
    for(let i=0;i<width;i++)check(m._decode386(raw+i)===decoded+i&&this._class(decoded+i)===kind,
      'mixed or noncontiguous decoded span');
    if(execute)check(width===4096&&(raw&4095)===0&&(decoded&4095)===0&&(kind===combinedKind.rom||(kind===combinedKind.ram&&[0x7000,0x107000].includes(decoded)&&[0x7000,0x107000].includes(raw))),
      'executable admission requires owned ROM or bounded RAM');
    return {decoded,kind};
  }
  beginRun(){
    check(!this.running&&!this.closed,'RUN reentry or completed host');
    const m=this.machine;
    if(m._chipDebt>=m._chipDeadline)m._flushChips();
    this.running=true;
  }
  stageLine(){
    check(!this.running&&!this.closed,'LINE requires paused boundary');
    const m=this.machine;if(m._chipDebt>=m._chipDeadline)m._flushChips();
    const asserted=!!m._pic.intActive;const changed=asserted!==this.lineAsserted;
    this.lineAsserted=asserted;this._record('line-stage',{asserted,changed});return {asserted,changed};
  }
  endRun(){check(this.running&&!this._requestActive,'RUN completion outside safe boundary');this.running=false;}
  mutate(){throw Error('combined paging/RAM/REP board host: external host mutation and mapping changes are forbidden');}
  handleRequest(request){
    check(this.running&&!this._requestActive,'callback reentry or callback outside RUN');
    const {seq,operation,arg0,arg1,arg2,payload,nativeTicks,successfulQuanta}=request;
    check(seq===this.nextRequest,'request sequence gap');
    check(nativeTicks===this.nativeTicks&&successfulQuanta===this.successfulQuanta,'request clock tuple changed');
    [arg0,arg1,arg2].forEach(n=>uint(n));
    this._requestActive=true;
    try{
      const before=this.state();let reply;
      if(['READ','WRITE'].includes(operation)){
        check(arg2===0,'memory reserved argument changed');
        const {decoded,kind}=this.span(arg0,arg1);
        check(operation==='READ'?payload==='-':typeof payload==='string'&&new RegExp(`^[0-9a-f]{${2*arg1}}$`).test(payload),
          'memory payload width or canonical bytes changed');
        check(operation!=='WRITE'||kind!==1||(this.generations.get((decoded&0xfffff000)>>>0)??0)<0xffffffff,'RAM generation overflow before effect');
        check(operation!=='WRITE'||kind!==1||this.generations.has((decoded&0xfffff000)>>>0)||this.generations.size<64,'generation table bound before effect');
        const input=operation==='WRITE'?Buffer.from(payload,'hex'):null,observed=[];
        const effect=operation==='READ'?0:kind===1?1:kind===2?2:3;
        for(let i=0;i<arg1;i++){
          const raw=arg0+i,valueBefore=this.machine._read386(raw);
          if(input)this.machine._write386(raw,input[i]);
          const value=this.machine._read386(raw);observed.push(value);
          this.bus.push({ordinal:this.bus.length+1,kind:input?'write':'read',raw,decoded:decoded+i,
            class:kind,effect,value:input?input[i]:value,before:valueBefore,after:value,
            nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,boardCycles:this.machine.cycles,seq,mappingEpoch:this.mappingEpoch,boardA20:Number(this.machine._a20Enabled)});
        }
        const page=(decoded&0xfffff000)>>>0;let generation=this.generations.get(page)??0;
        if(input&&kind===1){check(generation<0xffffffff,'RAM generation overflow');generation++;this.generations.set(page,generation);}
        reply={kind:'MEM',seq,decoded,class:kind,effect,hex:Buffer.from(observed).toString('hex'),generation:kind===1?generation:0,mappingEpoch:this.mappingEpoch,boardA20:Number(this.machine._a20Enabled)};
      }else if(operation==='PAGE'){
        check(arg1===4096&&arg2===0&&payload==='-','PAGE size/generation/payload changed');
        const {decoded,kind}=this.span(arg0,4096,{execute:true});
        const bytes=Buffer.alloc(4096);
        for(let i=0;i<4096;i++)bytes[i]=this.machine._read386(arg0+i);
        reply={kind:'PAGE',seq,decoded,mappingEpoch:this.mappingEpoch,generation:kind===1?(this.generations.get(decoded)??0):0,class:kind,boardA20:Number(this.machine._a20Enabled),sha256:combinedSha(bytes),
          chunks:Array.from({length:64},(_,i)=>({index:i,hex:bytes.subarray(i*64,(i+1)*64).toString('hex')}))};
      }else{
        check(payload==='-','scalar callback payload changed');
        if(operation==='QUANTUM'){
          check([0,1].includes(arg0)&&arg1===0&&arg2===0,'unknown successful-work notification');
          check(this.successfulQuanta<300,'successful-work cap exceeded');
          this.successfulQuanta++;this.machine.cycles+=6;this.machine._chipDebt+=6;
          reply={kind:'REP',seq,value:Number(this.machine._chipDebt>=this.machine._chipDeadline)};
        }else if(operation==='NATIVE_TICK'){
          check(arg0===1&&arg1===0&&arg2===0,'native tick shape');check(this.nativeTicks<600,'native tick cap');this.nativeTicks++;
          reply={kind:'REP',seq,value:0};
        }else if(operation==='PIO_OUT'){
          check([0x20,0x21,0xa0,0xa1,0x40,0x43,0x60,0x64,0xe9].includes(arg0)&&arg1===1&&arg2<=255,'unowned PIO port/width/value');
          check(this.mappingEpoch<0xffffffff,'mapping epoch bound before PIO effect');this.machine._out386(arg0,arg2,8);check(this.machine._fastA20Latch===0&&!this.machine._cpuResetPending,'unqualified fast latch or reset');if(arg0===0xe9)this.marker.push(arg2);
          reply={kind:'PIO',seq,value:0,boardA20:Number(this.machine._a20Enabled),mappingEpoch:this.mappingEpoch};
        }else if(operation==='ACK'){
          check(arg0===0&&arg1===0&&arg2===0,'ACK arguments');
          // Actual board _serviceInterrupts acknowledges current PIC without an extra debt settlement.
          check(this.lineAsserted&&this.machine._pic.intActive,'ACK without actual staged PIC line');
          check(this.machine._pic._serviceable()===0&&!this.machine.chips.pic2.intActive,'unexpected cascade or IRQ');
          const vector=this.machine._pic.acknowledge();check(vector===0x20,'unexpected actual PIC vector');
          this._record('pic-ack',{vector});reply={kind:'REP',seq,value:vector};
        }else throw Error('combined paging/RAM/REP board host: unsupported callback operation');
      }
      this.nextRequest++;
      this._record('request',{request,reply,before,after:this.state()});return reply;
    }finally{this._requestActive=false;}
  }
  finish(){
    check(!this.running&&!this.closed,'finish requires paused unique terminal boundary');
    const before=this.state();this.machine._catchUpChips();this.closed=true;
    const after=this.state();this._record('terminal-settle',{before,after});
    return {before,after,resetWitness:[...this.machine.mem.subarray(0x510,0x518)],
      witnesses:[...this.machine.mem.subarray(0x520,0x54c)],destination:[...this.machine.mem.subarray(0x4ff8,0x5008)],
      page6:[...this.machine.mem.subarray(0x6000,0x6008)],pte5:[...this.machine.mem.subarray(0xa014,0xa018)],
      pte6:[...this.machine.mem.subarray(0xa018,0xa01c)],smcWitnesses:[...this.machine.mem.subarray(0x560,0x570)],lowCode:[...this.machine.mem.subarray(0x7000,0x7004)],highCode:[...this.machine.mem.subarray(0x107000,0x107004)],memorySha256:combinedSha(this.machine.mem)};
  }
}

export function parseCombinedRpcLine(line){
  check(typeof line==='string'&&line.length>0&&line.length<255&&/^[\x20-\x7e\t]+$/.test(line)&&!line.includes('\r'),
    'BWR12 line must be bounded canonical ASCII');
  const p=line.split('\t');check(p[0]==='BWR12'&&!p.some(x=>x===''),'BWR12 prefix or empty field');
  const dec=(v,max=Number.MAX_SAFE_INTEGER)=>{check(/^(0|[1-9][0-9]*)$/.test(v),'noncanonical decimal');return uint(Number(v),max);};
  const hex=(v,n)=>{check(new RegExp(`^[0-9a-f]{${n}}$`).test(v),'noncanonical hexadecimal');return parseInt(v,16);};
  if(p[1]==='READY'){
    check(p.length===6,'READY field count');return {kind:'READY',cs:hex(p[2],4),eip:hex(p[3],8),nativeTicks:dec(p[4]),successfulQuanta:dec(p[5])};
  }
  if(p[1]==='REQ'){
    check(p.length===10&&['READ','WRITE','PAGE','QUANTUM','NATIVE_TICK','PIO_OUT','ACK'].includes(p[3]),'REQ field count or operation');
    const r={kind:'REQ',seq:dec(p[2]),operation:p[3],arg0:dec(p[4],0xffffffff),arg1:dec(p[5],0xffffffff),arg2:dec(p[6],0xffffffff),payload:p[7],nativeTicks:dec(p[8]),successfulQuanta:dec(p[9])};
    check(r.seq>0,'zero request sequence');
    if(r.operation==='WRITE')check(r.arg1>=1&&r.arg1<=16&&new RegExp(`^[0-9a-f]{${2*r.arg1}}$`).test(r.payload),'WRITE payload');
    else check(r.payload==='-','unexpected scalar payload');return r;
  }
  if(p[1]==='REP'){
    check(p.length===5&&p[3]==='OK','scalar reply shape');return {kind:'REP',seq:dec(p[2]),value:dec(p[4],0xffffffff),...(p.length===7?{a20:dec(p[5],1),mappingEpoch:dec(p[6],0xffffffff)}:{})};
  }
  if(p[1]==='PIO'){check(p.length===7&&p[3]==='OK','PIO reply shape');return {kind:'PIO',seq:dec(p[2]),value:dec(p[4],0),boardA20:dec(p[5],1),mappingEpoch:dec(p[6],0xffffffff)};}
  if(p[1]==='MEM'){
    check(p.length===11&&p[3]==='OK'&&/^(?:[0-9a-f]{2}){1,16}$/.test(p[7]),'memory reply shape');
    const r={kind:'MEM',seq:dec(p[2]),decoded:hex(p[4],8),class:dec(p[5],4),effect:dec(p[6],3),hex:p[7],generation:dec(p[8],0xffffffff),mappingEpoch:dec(p[9],0xffffffff),boardA20:dec(p[10],1)};
    check(({1:[0,1],2:[0,2],4:[0,3]})[r.class]?.includes(r.effect),'memory kind/effect pair');return r;
  }
  if(p[1]==='PAGE'){
    check(p.length===9&&/^[0-9a-f]{64}$/.test(p[6]),'page reply shape');
    const r={kind:'PAGE',seq:dec(p[2]),decoded:hex(p[3],8),generation:dec(p[4],0xffffffff),class:dec(p[5],4),sha256:p[6],mappingEpoch:dec(p[7],0xffffffff),boardA20:dec(p[8],1)};
    check((r.decoded&4095)===0&&r.decoded<=0xfffff000&&[1,2].includes(r.class)&&(r.class===1||r.generation===0),'page admission metadata');return r;
  }
  if(p[1]==='DATA'){
    check(p.length===5&&/^[0-9a-f]{128}$/.test(p[4]),'page chunk payload');return {kind:'DATA',seq:dec(p[2]),index:dec(p[3],63),hex:p[4]};
  }
  if(p[1]==='END'){check(p.length===3,'page END shape');return {kind:'END',seq:dec(p[2])};}
  if(p[1]==='CMD'){
    check(p.length===7&&['RUN','LINE','STOP'].includes(p[3]),'command shape');
    check(/^(0|[1-9][0-9]*)$/.test(p[6])&&BigInt(p[6])<=0xffffffffffffffffn,'deadline range');
    return {kind:'CMD',seq:dec(p[2]),verb:p[3],arg0:dec(p[4]),arg1:dec(p[5]),deadline:p[6]};
  }
  if(p[1]==='DONE'){
    check(['RUN','LINE','STOP'].includes(p[3]),'DONE verb');
    if(p[3]!=='RUN'){
      check(p.length===7,'non-RUN DONE shape');return {kind:'DONE',seq:dec(p[2]),verb:p[3],value:dec(p[4]),totalNativeTicks:dec(p[5]),totalQuanta:dec(p[6])};
    }
    check(p.length===18,'RUN DONE field count');
    const r={kind:'DONE',seq:dec(p[2]),verb:'RUN',reason:dec(p[4]),chargedNativeTicks:dec(p[5]),chargedQuanta:dec(p[6]),
      cs:hex(p[7],4),eip:hex(p[8],8),totalNativeTicks:dec(p[9]),totalQuanta:dec(p[10]),attempts:dec(p[11]),
      completed:dec(p[12]),repIterations:dec(p[13]),faults:dec(p[14]),ifFlag:dec(p[15],512)===512,activity:dec(p[16]),irqDelivered:dec(p[17],1)===1};
    check(['0','512'].includes(p[15]),'IF field must be zero or bit9');
    check([1,2,3,4,6,7].includes(r.reason),'unsupported ram slice reason');return r;
  }
  throw Error('combined paging/RAM/REP board host: unknown BWR12 record');
}
export function encodeCombinedCommand(seq,verb,arg0=0,arg1=0,deadline='0'){
  const line=['BWR12','CMD',seq,verb,arg0,arg1,deadline].join('\t');parseCombinedRpcLine(line);return line;
}
export function encodeCombinedReply(reply){
  let lines;
  if(reply.kind==='REP')lines=[['BWR12','REP',reply.seq,'OK',reply.value,...(Object.hasOwn(reply,'a20')?[reply.a20,reply.mappingEpoch]:[])].join('\t')];
  else if(reply.kind==='PIO')lines=[['BWR12','PIO',reply.seq,'OK',reply.value,reply.boardA20,reply.mappingEpoch].join('\t')];
  else if(reply.kind==='MEM')lines=[['BWR12','MEM',reply.seq,'OK',reply.decoded.toString(16).padStart(8,'0'),reply.class,reply.effect,reply.hex,reply.generation,reply.mappingEpoch,reply.boardA20].join('\t')];
  else{
    check(reply.kind==='PAGE'&&reply.chunks.length===64,'page reply count');
    lines=[['BWR12','PAGE',reply.seq,reply.decoded.toString(16).padStart(8,'0'),reply.generation,reply.class,reply.sha256,reply.mappingEpoch,reply.boardA20].join('\t'),
      ...reply.chunks.map(c=>['BWR12','DATA',reply.seq,c.index,c.hex].join('\t')),['BWR12','END',reply.seq].join('\t')];
  }
  lines.forEach(parseCombinedRpcLine);return lines;
}
export function assembleCombinedPageReply(lines){
  check(lines.length===66,'page requires metadata, 64 chunks and END');
  const records=lines.map(parseCombinedRpcLine),header=records[0];check(header.kind==='PAGE','page metadata missing');
  const chunks=records.slice(1,65);
  for(let i=0;i<64;i++)check(chunks[i].kind==='DATA'&&chunks[i].seq===header.seq&&chunks[i].index===i,'page chunk sequence/index');
  const end=records[65];check(end.kind==='END'&&end.seq===header.seq,'page END sequence');
  const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c.hex,'hex')));
  check(bytes.length===4096&&combinedSha(bytes)===header.sha256,'complete page digest');return {...header,bytes};
}
