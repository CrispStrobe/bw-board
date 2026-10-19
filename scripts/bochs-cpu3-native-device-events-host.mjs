/** Actual board PIT/PIC models for the free CPU3 timer-wake proof. */
import {I8254} from '../src/i8254.js';
import {I8259} from '../src/i8259.js';
import {PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';

// PCAT80386_EXPERIMENTAL inherits 6 MHz from PCAT80286_BOOT_640K and declares
// six functional board clocks per successful CPU step. These constants are
// source-pinned by the runner. They are not measured physical 386 timings.
export const boardHz=PCAT80386_EXPERIMENTAL.clockHz;
export const clocksPerQuantum=PCAT80386_EXPERIMENTAL.functionalInstructionCycles;
export const pitHz=1_193_182;
const assert=(condition,message)=>{if(!condition)throw Error(`device host: ${message}`);};
const finite=(value,label)=>{assert(Number.isFinite(value),`${label} is nonfinite`);return value;};
const integer=(value,label,max=Number.MAX_SAFE_INTEGER)=>{
  assert(Number.isSafeInteger(value)&&value>=0&&value<=max,`${label} out of range`);
  return value;
};

export class NativeDeviceHost {
  constructor(){
    assert(boardHz===6_000_000&&clocksPerQuantum===6,
      'source AT functional clock profile changed');
    this.nativeTicks=0;
    this.successfulQuanta=0;
    this.boardCycles=0;
    this.idleBoardCycles=0;
    this.lineAsserted=false;
    this._inTick=false;
    this._tickTransition=false;
    this.journal=[];
    this.marker=[];
    this.pic=new I8259({onInterrupt:active=>{
      if(this._inTick)this._tickTransition=true;
      this._record('pic-int',{active});
    }});
    this.pit=new I8254({clockHz:pitHz,onOutput:(channel,level)=>{
      if(channel===0&&this._inTick)this._tickTransition=true;
      this._record('pit-output',{channel,level});
      if(channel===0)this.pic.setIRQ(0,level);
    }});
  }

  _record(kind,details={}){
    this.journal.push({ordinal:this.journal.length,kind,nativeTicks:this.nativeTicks,
      successfulQuanta:this.successfulQuanta,boardCycles:this.boardCycles,...details});
  }

  state(){
    return {nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,
      boardCycles:this.boardCycles,idleBoardCycles:this.idleBoardCycles,
      pitFraction:finite(this.pit._frac,'PIT fraction'),pitClockHz:this.pit.clockHz,
      pitVariant:this.pit.variant,pit:this.pit.getState(),pic:this.pic.getState(),
      lineAsserted:this.lineAsserted,marker:Buffer.from(this.marker).toString('ascii')};
  }

  nextNativeDeadline(){
    const ms=this.pit.nextWakeMs();
    if(ms===Infinity)return null;
    finite(ms,'PIT wake');
    assert(ms>=0,'PIT wake moved backward');
    const until=Math.max(1,Math.ceil(ms*boardHz/(1000*clocksPerQuantum)));
    return integer(this.nativeTicks+until,'absolute native deadline');
  }

  handleRequest(kind,arg0,arg1,arg2,nativeTick){
    integer(nativeTick,'request native tick');
    assert(nativeTick===this.nativeTicks,'request tick disagrees with host ledger');
    for(const [label,value] of [['arg0',arg0],['arg1',arg1],['arg2',arg2]])
      integer(value,label,0xffffffff);
    if(kind==='TICK'){
      assert(arg0===1&&arg1===0&&arg2===0,'TICK shape changed');
      const pitFractionBefore=this.pit._frac;
      this.nativeTicks++;
      this.successfulQuanta++;
      this.boardCycles+=clocksPerQuantum;
      this._inTick=true;
      this._tickTransition=false;
      try{this.pit.advanceMs(clocksPerQuantum*1000/boardHz);}
      finally{this._inTick=false;}
      this._record('quantum',{chargedBoardCycles:clocksPerQuantum,
        pitFractionBefore,pitFractionAfter:this.pit._frac,
        eventDue:this._tickTransition});
      return this._tickTransition?1:0;
    }
    if(kind==='ACK'){
      assert(arg0===0&&arg1===0&&arg2===0,'ACK shape changed');
      assert(this.pic.intActive,'PIC ACK without serviceable IR0');
      const before=this.state();
      const vector=this.pic.acknowledge();
      assert(vector===0x20,'PIC supplied non-IR0 vector');
      this._record('pic-ack',{vector,beforePic:before.pic,afterPic:this.pic.getState()});
      return vector;
    }
    assert(kind==='PIO_IN'||kind==='PIO_OUT','unknown callback kind');
    const port=integer(arg0,'port',0xffff);
    assert(arg1===1,'only byte PIO is owned');
    if(kind==='PIO_IN')assert(arg2===0,'PIO_IN reserved argument changed');
    const supported=[0x20,0x21,0x40,0x43,0xe9];
    assert(supported.includes(port),'unowned PIO port');
    const before=this.state(); // prior successful quantum debt is already settled
    let value;
    if(kind==='PIO_IN'){
      assert(port!==0xe9,'diagnostic port has no input');
      value=port<0x40?this.pic.read(port&1):this.pit.read(port&3);
      assert(value>=0&&value<=255,'device read returned nonbyte');
    }else{
      value=integer(arg2,'PIO_OUT value',255);
      if(port===0xe9)this.marker.push(value);
      else if(port<0x40)this.pic.write(port&1,value);
      else this.pit.write(port&3,value);
    }
    const after=this.state();
    this._record('pio',{direction:kind==='PIO_IN'?'in':'out',port,width:1,value,
      before:{boardCycles:before.boardCycles,pitFraction:before.pitFraction,
        pit:before.pit,pic:before.pic},
      after:{boardCycles:after.boardCycles,pitFraction:after.pitFraction,
        pit:after.pit,pic:after.pic}});
    return kind==='PIO_IN'?value:0;
  }

  stageLine(){
    const wanted=this.pic.intActive;
    if(wanted!==this.lineAsserted){
      this.lineAsserted=wanted;
      this._record('line-stage',{asserted:wanted,pic:this.pic.getState()});
    }
    return wanted;
  }

  advanceHaltedToFirstEdge(){
    assert(!this.pic.intActive,'idle advance would hide already eligible interrupt');
    const before=this.state(),wakeMs=this.pit.nextWakeMs();
    assert(Number.isFinite(wakeMs)&&wakeMs>0,'halt lacks finite PIT horizon');
    const first=integer(Math.ceil(wakeMs*boardHz/1000),'idle horizon cycles');
    assert(first>0&&first<boardHz,'idle horizon exceeds one second');
    this.boardCycles+=first;
    this.idleBoardCycles+=first;
    this.pit.advanceMs(first*1000/boardHz);
    // Binary floating conversion can land one host board clock shy of an edge.
    // Record the actual extra clock if needed; never synthesize a PIC request.
    let correction=0;
    while(!this.pic.intActive&&correction<2){
      this.boardCycles++;
      this.idleBoardCycles++;
      this.pit.advanceMs(1000/boardHz);
      correction++;
    }
    assert(this.pic.intActive,'PIT failed to drive PIC after bounded idle advance');
    assert(this.nativeTicks===before.nativeTicks&&
      this.successfulQuanta===before.successfulQuanta,'HLT advanced CPU');
    this._record('idle-advance',{requestedCycles:first,correctionCycles:correction,
      elapsedBoardCycles:first+correction,wakeMs,
      pitFractionBefore:before.pitFraction,pitFractionAfter:this.pit._frac,
      picBefore:before.pic,picAfter:this.pic.getState()});
    return first+correction;
  }
}
