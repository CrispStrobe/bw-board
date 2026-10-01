/** Source-owned I8254/I8259 clock for successful CPU work and native ticks. */
import {I8254} from '../src/i8254.js';
import {I8259} from '../src/i8259.js';
import {PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';

export const boardHz=PCAT80386_EXPERIMENTAL.clockHz;
export const clocksPerQuantum=PCAT80386_EXPERIMENTAL.functionalInstructionCycles;
export const pitHz=1_193_182;
const assert=(ok,why)=>{if(!ok)throw Error(`device quantum host: ${why}`);};
const integer=(value,why,max=Number.MAX_SAFE_INTEGER)=>{
  assert(Number.isSafeInteger(value)&&value>=0&&value<=max,`${why} out of range`);
  return value;
};

export class NativeDeviceQuantumHost {
  constructor(){
    assert(boardHz===6_000_000&&clocksPerQuantum===6,
      'source AT functional clock profile changed');
    this.nativeTicks=0;
    this.successfulQuanta=0;
    this.boardCycles=0;
    this.lineAsserted=false;
    this.marker=[];
    this.journal=[];
    this._inQuantum=false;
    this._transition=false;
    this.pic=new I8259({onInterrupt:active=>{
      if(this._inQuantum)this._transition=true;
      this._record('pic-int',{active});
    }});
    this.pit=new I8254({clockHz:pitHz,onOutput:(channel,level)=>{
      if(channel===0&&this._inQuantum)this._transition=true;
      this._record('pit-output',{channel,level});
      if(channel===0)this.pic.setIRQ(0,level);
    }});
  }

  _record(kind,details={}){
    this.journal.push({ordinal:this.journal.length,kind,
      nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,
      boardCycles:this.boardCycles,...details});
  }

  state(){
    const fraction=this.pit._frac;
    assert(Number.isFinite(fraction)&&fraction>=0&&fraction<1,
      'PIT fractional crystal state invalid');
    return {nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,
      boardCycles:this.boardCycles,pitFraction:fraction,
      pitClockHz:this.pit.clockHz,pitVariant:this.pit.variant,
      pit:this.pit.getState(),pic:this.pic.getState(),
      lineAsserted:this.lineAsserted,marker:Buffer.from(this.marker).toString('ascii')};
  }

  /** One synchronous BWR8 callback. Native and functional clocks stay disjoint. */
  handleRequest(kind,arg0,arg1,arg2,nativeTick,successfulQuanta){
    integer(nativeTick,'request native tick');
    integer(successfulQuanta,'request successful quantum');
    assert(nativeTick===this.nativeTicks&&successfulQuanta===this.successfulQuanta,
      'request clock tuple disagrees with host ledger');
    for(const [label,value] of [['arg0',arg0],['arg1',arg1],['arg2',arg2]])
      integer(value,label,0xffffffff);
    if(kind==='NATIVE_TICK'){
      assert(arg0===1&&arg1===0&&arg2===0,'NATIVE_TICK shape changed');
      const before=this.state();
      this.nativeTicks++;
      this._record('native-tick',{chargedNativeTicks:1});
      assert(this.boardCycles===before.boardCycles&&
        this.successfulQuanta===before.successfulQuanta&&
        this.pit._frac===before.pitFraction,
      'native tick advanced functional clock or PIT');
      return 0;
    }
    if(kind==='QUANTUM'){
      assert((arg0===0||arg0===1)&&arg1===0&&arg2===0,
        'QUANTUM kind or reserved arguments changed');
      const before=this.pit._frac;
      this.successfulQuanta++;
      this.boardCycles+=clocksPerQuantum;
      this._inQuantum=true;this._transition=false;
      try{this.pit.advanceMs(clocksPerQuantum*1000/boardHz);}
      finally{this._inQuantum=false;}
      this._record('quantum',{quantumKind:arg0===1?'rep-element':'ordinary-or-zero',
        chargedBoardCycles:clocksPerQuantum,pitFractionBefore:before,
        pitFractionAfter:this.pit._frac,eventDue:this._transition});
      return this._transition?1:0;
    }
    if(kind==='ACK'){
      assert(arg0===0&&arg1===0&&arg2===0,'ACK shape changed');
      assert(this.pic.intActive,'PIC ACK without serviceable IR0');
      const before=this.pic.getState();
      const vector=this.pic.acknowledge();
      assert(vector===0x20,'PIC supplied non-IR0 vector');
      this._record('pic-ack',{vector,beforePic:before,afterPic:this.pic.getState()});
      return vector;
    }
    assert(kind==='PIO_IN'||kind==='PIO_OUT','unknown host callback');
    const port=integer(arg0,'port',0xffff);
    assert(arg1===1,'only byte PIO is owned');
    if(kind==='PIO_IN')assert(arg2===0,'PIO_IN reserved argument changed');
    assert([0x20,0x21,0x40,0x43,0xe9].includes(port),'unowned PIO port');
    const before=this.state(); // every prior successful quantum already settled
    let value;
    if(kind==='PIO_IN'){
      assert(port!==0xe9,'diagnostic port has no input');
      value=port<0x40?this.pic.read(port&1):this.pit.read(port&3);
      assert(value>=0&&value<=255,'device read was not a byte');
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

  /** Device-to-native INTR handoff only between resume calls. */
  stageLine(){
    const wanted=this.pic.intActive;
    if(wanted!==this.lineAsserted){
      this.lineAsserted=wanted;
      this._record('line-stage',{asserted:wanted,pic:this.pic.getState()});
    }
    return wanted;
  }
}
