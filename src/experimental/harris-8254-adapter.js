/** Pin-clocked timer/decoder/byte-lane subset, not a full 8254. See HARRIS-286-TIMER.md. */
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const level=(read,p)=>{
    const v=read(p);
    if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);
    return v;
};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const released=()=>Object.fromEntries(D.map(p=>[p,'Z']));

export class Harris8254Adapter {
    constructor({enabled=false,id='pit',portBase=0x40}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        if(!Number.isInteger(portBase)||portBase<0||portBase>0xfffc||(portBase&3))throw new RangeError('aligned four-port range required');
        this.id=id;this.portBase=portBase;this.ioInterface='harris-pit-byte-lanes';
        this.capabilities=Object.freeze({experimental:true,full8254:false,channels:1,modes:[0,2,3],
            binaryOnly:true,lsbThenMsbOnly:true,evenMode3Only:true,liveReload:false,electricalTiming:false});
        this.reset();
    }
    reset() {
        this.configured=false;this.mode=0;this.divisor=null;this.count=0;this.out=0;
        this.lowByte=null;this.loadPending=false;this.loaded=false;this.latched=null;this.readPhase=0;
        this.previousClock=0;this.previousGate=1;this.sampledGate=1;
        this.writeCycle=null;this.readCycle=null;this.writes=0;this.reads=0;this.ticks=0;
    }
    part() {
        return {id:this.id,pins:['reset','clk0','gate0','out0','ior_n','iow_n','bhe_n','m_io',...A,...D],outputs:['out0',...D]};
    }
    _write(reg,value) {
        if(reg===3) {
            if(value&0xc0)throw new CircuitFault('UNSUPPORTED_PIT_MODE','counter 0 only; no read-back');
            const rw=(value>>4)&3,mode=(value>>1)&7;
            if(rw===0) {
                if(!this.loaded)throw new CircuitFault('PIT_NOT_LOADED','latch before initial count');
                if(this.latched===null){this.latched=this.count&0xffff;this.readPhase=0;}
            } else {
                if(rw!==3||(value&1)||![0,2,3].includes(mode))throw new CircuitFault('UNSUPPORTED_PIT_MODE','binary modes 0/2/3, LSB/MSB only');
                this.configured=true;this.mode=mode;this.out=Number(mode!==0);this.divisor=null;
                this.loaded=false;this.loadPending=false;this.lowByte=null;this.latched=null;this.readPhase=0;this.count=0;
            }
        } else if(reg===0) {
            if(!this.configured)throw new CircuitFault('PIT_NOT_CONFIGURED','control word required');
            if(this.divisor!==null)throw new CircuitFault('UNSUPPORTED_PIT_RELOAD','new control word required before another count');
            if(this.lowByte===null)this.lowByte=value;
            else {
                const divisor=(this.lowByte|(value<<8))||65536;
                if(this.mode!==0&&divisor<2||this.mode===3&&(divisor&1))throw new CircuitFault('UNSUPPORTED_PIT_COUNT','mode 2 minimum 2; mode 3 even only');
                this.divisor=divisor;this.loadPending=true;this.lowByte=null;
            }
        } else throw new CircuitFault('UNSUPPORTED_PIT_CHANNEL','counter 0 only');
        this.writes++;
    }
    _read(reg) {
        if(reg!==0)throw new CircuitFault('UNSUPPORTED_PIT_READ','counter 0 only');
        if(!this.loaded)throw new CircuitFault('PIT_NOT_LOADED','read before initial count');
        const value=this.latched??(this.count&0xffff);
        const result=(value>>(8*this.readPhase))&255;
        this.readPhase^=1;if(this.readPhase===0)this.latched=null;
        this.reads++;return result;
    }
    _tick() {
        this.ticks++;
        if(this.divisor===null)return;
        // Initial load is a separate falling edge, not an immediate decrement.
        if(this.loadPending) {
            if(this.mode!==0&&!this.sampledGate)return;
            this.count=this.divisor;this.loaded=true;this.loadPending=false;return;
        }
        if(!this.loaded||!this.sampledGate)return;
        if(this.mode===0) {
            if(this.count>0&&--this.count===0)this.out=1;
        } else if(this.mode===2) {
            if(this.count===1){this.count=this.divisor;this.out=1;}
            else {this.count--;if(this.count===1)this.out=0;}
        } else {
            this.count-=2;
            if(this.count===0){this.count=this.divisor;this.out^=1;}
        }
    }
    update(read) {
        if(level(read,'reset')){this.reset();return {out0:0,...released()};}
        const clk=level(read,'clk0'),gate=level(read,'gate0');
        if(this.configured&&this.mode!==0) {
            if(!gate)this.out=1;
            if(gate&&!this.previousGate)this.loadPending=this.divisor!==null;
        }
        if(!this.previousClock&&clk)this.sampledGate=gate;
        if(this.previousClock&&!clk)this._tick();
        if(this.configured&&this.mode!==0&&!gate)this.out=1;
        this.previousClock=clk;this.previousGate=gate;
        const rd=level(read,'ior_n'),wr=level(read,'iow_n');
        let access=null;
        if(!rd||!wr) {
            if(!rd&&!wr)throw new CircuitFault('PIT_COMMAND_OVERLAP','RD and WR');
            if(level(read,'m_io')!==0)throw new CircuitFault('PIT_IO_STATUS','memory status during I/O');
            const address=bits(A,read),bhe=level(read,'bhe_n');
            if(address>=this.portBase&&address<this.portBase+4) {
                if((address&1)?bhe!==0:bhe!==1)throw new CircuitFault('UNSUPPORTED_PIT_WORD_IO','byte transfers only');
                access={reg:address-this.portBase,lane:(address&1)*8};
            }
        }
        if(this.writeCycle&&wr){this._write(this.writeCycle.reg,this.writeCycle.value);this.writeCycle=null;}
        if(access&&!wr) {
            if(this.writeCycle&&this.writeCycle.reg!==access.reg)throw new CircuitFault('PIT_PORT_CHANGED','during WR');
            this.writeCycle={...access,value:bits(D.slice(access.lane,access.lane+8),read)};
        } else if(this.writeCycle)throw new CircuitFault('PIT_PORT_CHANGED','during WR');
        if(rd)this.readCycle=null;
        if(access&&!rd) {
            if(this.readCycle&&this.readCycle.reg!==access.reg)throw new CircuitFault('PIT_PORT_CHANGED','during RD');
            if(!this.readCycle)this.readCycle={...access,value:this._read(access.reg)};
        } else if(this.readCycle)throw new CircuitFault('PIT_PORT_CHANGED','during RD');
        const drive=released();
        if(this.readCycle)Object.assign(drive,bitDrives(D.slice(this.readCycle.lane,this.readCycle.lane+8),this.readCycle.value));
        return {...drive,out0:this.out};
    }
    inspect() {
        return {configured:this.configured,mode:this.mode,divisor:this.divisor,count:this.count,out:this.out,
            loaded:this.loaded,loadPending:this.loadPending,lowByte:this.lowByte,latched:this.latched,
            writes:this.writes,reads:this.reads,ticks:this.ticks};
    }
}

/** Independent ideal divider: one advance per board system-clock period. */
export class HarrisTimerClock {
    constructor({enabled=false,halfPeriod=8,id='timer_clock'}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        if(!Number.isSafeInteger(halfPeriod)||halfPeriod<1)throw new RangeError('positive integer halfPeriod');
        this.id=id;this.halfPeriod=halfPeriod;this.elapsed=0;this.output=0;
    }
    part(){return {id:this.id,pins:['reset','clk'],outputs:['clk']};}
    advance(read) {
        if(level(read,'reset')){this.elapsed=0;this.output=0;}
        else if(++this.elapsed===this.halfPeriod){this.elapsed=0;this.output^=1;}
        return {clk:this.output};
    }
}
