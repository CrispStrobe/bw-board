/** Actual AT board authority for bounded guest-created RAM, SMC and A20 coherence. */
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';
export const ramBoardConfig=PCAT80386_EXPERIMENTAL;
export const ramBudgets=Object.freeze({continuous:1000000,budget1:1,budget2:2,budget257:257});
export const ramKind=Object.freeze({ram:1,rom:2,mmio:3,unmapped:4});
export const ramEffect=Object.freeze({ramRead:1,ramCommit:2,romRead:3,romIgnored:4,mmioRead:5,mmioWrite:6,openBus:7,unmappedIgnored:8});
export const ramSha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(ok,message)=>{if(!ok)throw Error(`ram board host: ${message}`);};
const uint=(n,max=0xffffffff)=>{check(Number.isSafeInteger(n)&&n>=0&&n<=max,'unsigned integer outside range');return n;};
export function ramBoardState(m){
  return clone({cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,
    a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),fastA20Latch:m._fastA20Latch,cpuResetPending:!!m._cpuResetPending,
    interruptSignals:{nmiPending:!!m._nmiPending,nmiMasked:!!m._nmiMasked,kbdStrobe:!!m._kbdStrobe,pinLevels:{...m._pinLevels}},
    chipStates:Object.fromEntries(Object.entries(m.chips).map(([name,chip])=>{check(typeof chip.getState==='function',`configured chip lacks state snapshot: ${name}`);return [name,chip.getState()];})),
    pit:{...m.chips.pit1.getState(),fraction:m.chips.pit1._frac,clockHz:m.chips.pit1.clockHz},
    pic1:m.chips.pic1.getState(),pic2:m.chips.pic2.getState(),rtc:m.chips.rtc1.getState(),
    dma1:m.chips.dma1.getState(),dma2:m.chips.dma2.getState(),systemControl:m.chips.sysctl.getState()});
}

export class NativeRamCoherenceHost{
  constructor(rom){
    check(rom instanceof Uint8Array&&rom.length===65536,'ROM must contain exactly 64 KiB');
    this.nativeTicks=0;this.successfulQuanta=0;this.mappingEpoch=0;this.generations=new Map();this.running=false;this.closed=false;
    this.journal=[];this.bus=[];this.marker=[];this.nextRequest=1;this._requestActive=false;
    this.machine=new ExperimentalI80386ATMachine(ramBoardConfig,{onPortAccess:e=>{
      check(this._requestActive,'PIO outside synchronous owned callback');
      this._record('board-pio',e);
    }});
    const m=this.machine;this.initial=ramBoardState(m);
    m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();
    this.seed={domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:ramSha(m.mem)};
    this.reset=ramBoardState(m);
    check(m.cycles===4&&m._chipDebt===0&&m._a20Enabled,'fresh single reset epoch changed');
    this._cpuStep=m.cpu.step;m.cpu.step=()=>{throw Error('ram board host: JavaScript CPU execution forbidden');};
  }
  state(){return {nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,
    javascriptCpuCycles:this.machine.cpu.cycles,mappingEpoch:this.mappingEpoch,generations:[...this.generations].sort((a,b)=>a[0]-b[0]),board:ramBoardState(this.machine),marker:Buffer.from(this.marker).toString('ascii')};}
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
    if(decoded>=0xa0000&&decoded<=0xbffff)return ramKind.mmio;
    if(m._mmio.some(w=>decoded>=w.start&&decoded<=w.end))return ramKind.mmio;
    if(decoded>=m.memoryBytes)return ramKind.unmapped;
    const page=m._page[decoded>>>12];
    if(page===1)return ramKind.ram;if(page===2)return ramKind.rom;if(page===0)return ramKind.unmapped;
    const region=m._mem.find(r=>decoded>=r.start&&decoded<=r.end);
    return region?ramKind[region.kind]:ramKind.unmapped;
  }
  span(raw,width,{execute=false}={}){
    uint(raw);uint(width,execute?4096:16);
    check(width>0&&raw<=0xffffffff-(width-1),'unsupported or overflowing physical span');
    check((raw&4095)+width<=4096,'physical span crosses page');
    const m=this.machine,decoded=m._decode386(raw),kind=this._class(decoded);
    check(kind!==ramKind.mmio,'MMIO is outside first ram fixture');
    check(decoded<=0xffffffff-(width-1),'decoded span overflows');
    for(let i=0;i<width;i++)check(m._decode386(raw+i)===decoded+i&&this._class(decoded+i)===kind,
      'mixed or noncontiguous decoded span');
    if(execute)check(width===4096&&(raw&4095)===0&&(decoded&4095)===0&&[ramKind.ram,ramKind.rom].includes(kind),
      'executable admission requires homogeneous RAM or ROM');
    return {decoded,kind};
  }
  beginRun(){
    check(!this.running&&!this.closed,'RUN reentry or completed host');
    const m=this.machine;
    if(m._chipDebt>=m._chipDeadline)m._flushChips();
    check(!m.chips.pic1.intActive&&!m.chips.pic2.intActive,'IRQ is outside ram fixture');
    this.running=true;
  }
  endRun(){check(this.running&&!this._requestActive,'RUN completion outside safe boundary');this.running=false;}
  mutate(){throw Error('ram board host: external host mutation and mapping changes are forbidden');}
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
        const input=operation==='WRITE'?Buffer.from(payload,'hex'):null,observed=[];
        const effect=operation==='READ'?(kind===1?1:kind===2?3:7):(kind===1?2:kind===2?4:8);
        for(let i=0;i<arg1;i++){
          const raw=arg0+i,valueBefore=this.machine._read386(raw);
          if(input)this.machine._write386(raw,input[i]);
          const value=this.machine._read386(raw);observed.push(value);
          this.bus.push({ordinal:this.bus.length+1,kind:input?'write':'read',raw,decoded:decoded+i,
            class:kind,effect,value:input?input[i]:value,before:valueBefore,after:value,
            nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,boardCycles:this.machine.cycles,seq});
        }
        const page=(decoded&0xfffff000)>>>0;let generation=this.generations.get(page)??0;
        if(input&&kind===1){check(generation<0xffffffff,'RAM generation overflow');generation++;this.generations.set(page,generation);}
        reply={kind:'MEM',seq,decoded,class:kind,effect,hex:Buffer.from(observed).toString('hex'),generation:kind===1?generation:0,mappingEpoch:this.mappingEpoch};
      }else if(operation==='PAGE'){
        check(arg1===4096&&arg2===0&&payload==='-','PAGE size/generation/payload changed');
        const {decoded,kind}=this.span(arg0,4096,{execute:true});
        const bytes=Buffer.alloc(4096);
        for(let i=0;i<4096;i++)bytes[i]=this.machine._read386(arg0+i);
        reply={kind:'PAGE',seq,decoded,mappingEpoch:this.mappingEpoch,generation:kind===1?(this.generations.get(decoded)??0):0,class:kind,sha256:ramSha(bytes),
          chunks:Array.from({length:64},(_,i)=>({index:i,hex:bytes.subarray(i*64,(i+1)*64).toString('hex')}))};
      }else{
        check(payload==='-','scalar callback payload changed');
        if(operation==='QUANTUM'){
          check(arg0===0&&arg1===0&&arg2===0,'REP or unknown successful-work notification');
          this.successfulQuanta++;this.machine.cycles+=6;this.machine._chipDebt+=6;
          reply={kind:'REP',seq,value:Number(this.machine._chipDebt>=this.machine._chipDeadline)};
        }else if(operation==='NATIVE_TICK'){
          check(arg0===1&&arg1===0&&arg2===0,'native tick shape');this.nativeTicks++;
          reply={kind:'REP',seq,value:0};
        }else if(operation==='PIO_OUT'){
          check([0xe9,0x64,0x60].includes(arg0)&&arg1===1&&arg2<=255,'unowned PIO port/width/value');
          if(arg0===0x64)check(arg2===0xd1,'unsupported controller command');
          if(arg0===0x60)check(this.mappingEpoch<0xffffffff&&[1,3].includes(arg2)&&this.machine._a20Controller.getState().pendingCommand===0xd1,'unsupported output-port write');
          const a20Before=this.machine._a20Enabled;
          this.machine._out386(arg0,arg2,8);if(arg0===0xe9)this.marker.push(arg2);
          if(a20Before!==this.machine._a20Enabled){check(this.mappingEpoch<0xffffffff,'mapping epoch overflow');this.mappingEpoch++;}
          reply={kind:'REP',seq,value:0,a20:Number(this.machine._a20Enabled),mappingEpoch:this.mappingEpoch};
        }else throw Error('ram board host: unsupported callback operation');
      }
      this.nextRequest++;
      this._record('request',{request,reply,before,after:this.state()});return reply;
    }finally{this._requestActive=false;}
  }
  finish(){
    check(!this.running&&!this.closed,'finish requires paused unique terminal boundary');
    const before=this.state();this.machine._catchUpChips();this.closed=true;
    const after=this.state();this._record('terminal-settle',{before,after});
    return {before,after,ram:[...this.machine.mem.subarray(0x500,0x505)],
      resetWitness:[...this.machine.mem.subarray(0x510,0x518)],
      coherenceWitness:[...this.machine.mem.subarray(0x520,0x530)],lowCode:[...this.machine.mem.subarray(0x7000,0x7004)],highCode:[...this.machine.mem.subarray(0x107000,0x107004)],memorySha256:ramSha(this.machine.mem),
      romByte:this.machine._read386(0xf0200),aliasRomByte:this.machine._read386(0xffff0200),
      openbusByte:this.machine._read386(0xc0000)};
  }
}

export function parseRamRpcLine(line){
  check(typeof line==='string'&&line.length>0&&line.length<255&&/^[\x20-\x7e\t]+$/.test(line)&&!line.includes('\r'),
    'BWR10 line must be bounded canonical ASCII');
  const p=line.split('\t');check(p[0]==='BWR10'&&!p.some(x=>x===''),'BWR10 prefix or empty field');
  const dec=(v,max=Number.MAX_SAFE_INTEGER)=>{check(/^(0|[1-9][0-9]*)$/.test(v),'noncanonical decimal');return uint(Number(v),max);};
  const hex=(v,n)=>{check(new RegExp(`^[0-9a-f]{${n}}$`).test(v),'noncanonical hexadecimal');return parseInt(v,16);};
  if(p[1]==='READY'){
    check(p.length===6,'READY field count');return {kind:'READY',cs:hex(p[2],4),eip:hex(p[3],8),nativeTicks:dec(p[4]),successfulQuanta:dec(p[5])};
  }
  if(p[1]==='REQ'){
    check(p.length===10&&['READ','WRITE','PAGE','QUANTUM','NATIVE_TICK','PIO_OUT','PIO_IN','ACK'].includes(p[3]),'REQ field count or operation');
    const r={kind:'REQ',seq:dec(p[2]),operation:p[3],arg0:dec(p[4],0xffffffff),arg1:dec(p[5],0xffffffff),arg2:dec(p[6],0xffffffff),payload:p[7],nativeTicks:dec(p[8]),successfulQuanta:dec(p[9])};
    check(r.seq>0,'zero request sequence');
    if(r.operation==='WRITE')check(r.arg1>=1&&r.arg1<=16&&new RegExp(`^[0-9a-f]{${2*r.arg1}}$`).test(r.payload),'WRITE payload');
    else check(r.payload==='-','unexpected scalar payload');return r;
  }
  if(p[1]==='REP'){
    check([5,7].includes(p.length)&&p[3]==='OK','scalar reply shape');return {kind:'REP',seq:dec(p[2]),value:dec(p[4],0xffffffff),...(p.length===7?{a20:dec(p[5],1),mappingEpoch:dec(p[6],0xffffffff)}:{})};
  }
  if(p[1]==='MEM'){
    check(p.length===10&&p[3]==='OK'&&/^(?:[0-9a-f]{2}){1,16}$/.test(p[7]),'memory reply shape');
    const r={kind:'MEM',seq:dec(p[2]),decoded:hex(p[4],8),class:dec(p[5],4),effect:dec(p[6],8),hex:p[7],generation:dec(p[8],0xffffffff),mappingEpoch:dec(p[9],0xffffffff)};
    check(({1:[1,2],2:[3,4],4:[7,8]})[r.class]?.includes(r.effect),'memory kind/effect pair');return r;
  }
  if(p[1]==='PAGE'){
    check(p.length===8&&/^[0-9a-f]{64}$/.test(p[6]),'page reply shape');
    const r={kind:'PAGE',seq:dec(p[2]),decoded:hex(p[3],8),generation:dec(p[4],0xffffffff),class:dec(p[5],4),sha256:p[6],mappingEpoch:dec(p[7],0xffffffff)};
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
    check([1,3,4,7].includes(r.reason),'unsupported ram slice reason');return r;
  }
  throw Error('ram board host: unknown BWR10 record');
}
export function encodeRamCommand(seq,verb,arg0=0,arg1=0,deadline='0'){
  const line=['BWR10','CMD',seq,verb,arg0,arg1,deadline].join('\t');parseRamRpcLine(line);return line;
}
export function encodeRamReply(reply){
  let lines;
  if(reply.kind==='REP')lines=[['BWR10','REP',reply.seq,'OK',reply.value,...(Object.hasOwn(reply,'a20')?[reply.a20,reply.mappingEpoch]:[])].join('\t')];
  else if(reply.kind==='MEM')lines=[['BWR10','MEM',reply.seq,'OK',reply.decoded.toString(16).padStart(8,'0'),reply.class,reply.effect,reply.hex,reply.generation,reply.mappingEpoch].join('\t')];
  else{
    check(reply.kind==='PAGE'&&reply.chunks.length===64,'page reply count');
    lines=[['BWR10','PAGE',reply.seq,reply.decoded.toString(16).padStart(8,'0'),reply.generation,reply.class,reply.sha256,reply.mappingEpoch].join('\t'),
      ...reply.chunks.map(c=>['BWR10','DATA',reply.seq,c.index,c.hex].join('\t')),['BWR10','END',reply.seq].join('\t')];
  }
  lines.forEach(parseRamRpcLine);return lines;
}
export function assembleRamPageReply(lines){
  check(lines.length===66,'page requires metadata, 64 chunks and END');
  const records=lines.map(parseRamRpcLine),header=records[0];check(header.kind==='PAGE','page metadata missing');
  const chunks=records.slice(1,65);
  for(let i=0;i<64;i++)check(chunks[i].kind==='DATA'&&chunks[i].seq===header.seq&&chunks[i].index===i,'page chunk sequence/index');
  const end=records[65];check(end.kind==='END'&&end.seq===header.seq,'page END sequence');
  const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c.hex,'hex')));
  check(bytes.length===4096&&ramSha(bytes)===header.sha256,'complete page digest');return {...header,bytes};
}
