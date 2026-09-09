/** Channel-2 programmer-register bridge only. No bus mastering or DMA callbacks. */
import {I8237} from '../i8237.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const level=(read,p)=>{const v=read(p);if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);return v;};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const released=()=>Object.fromEntries(D.map(p=>[p,'Z']));
export class HarrisDMAAdapter {
    #core;
    constructor({enabled=false,id='dma'}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        this.id=id;this.ioInterface='harris-dma-registers';
        this.capabilities=Object.freeze({experimental:true,channel2Registers:true,transfers:false,
            hold:false,hlda:false,terminalCount:false,callbacks:false});
        this.#core=new I8237();this.reset();
    }
    reset(){this.#core.reset();this.readCycle=null;this.writeCycle=null;this.reads=0;this.writes=0;}
    part(){return {id:this.id,pins:['reset','ior_n','iow_n','bhe_n','m_io','dreq2',...A,...D],outputs:[...D]};}
    _write(reg,value) {
        if(reg===0x81) {
            if(value>15)throw new CircuitFault('UNSUPPORTED_DMA_PAGE','XT-style 20-bit page subset');
            this.#core.writePage(reg,value);this.writes++;return;
        }
        if([0,1,2,3,6,7].includes(reg))throw new CircuitFault('UNSUPPORTED_DMA_CHANNEL','channel 2 only');
        if(reg===8&&![0,4].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_MODE','only normal/disabled controller command');
        if(reg===9) {
            if((value&3)!==2||value>7)throw new CircuitFault('UNSUPPORTED_DMA_CHANNEL','channel 2 only');
            if(value&4)throw new CircuitFault('UNSUPPORTED_DMA_TRANSFER','software request requires bus ownership');
        }
        if(reg===10&&![2,6].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_CHANNEL','channel-2 mask only');
        if(reg===11&&![0x46,0x4a].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_MODE','channel 2, single, increment, no autoinit, read/write only');
        if(reg===14||reg===15&&![0x0b,0x0f].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_CHANNEL','other channels must stay masked');
        this.#core.write(reg,value);this.writes++;
    }
    update(read) {
        if(level(read,'reset')){this.reset();return released();}
        if(level(read,'dreq2'))throw new CircuitFault('UNSUPPORTED_DMA_TRANSFER','DREQ2 requires HOLD/HLDA, ownership and TC');
        const rd=level(read,'ior_n'),wr=level(read,'iow_n');let access=null;
        if(rd===0||wr===0) {
            if(rd===0&&wr===0)throw new CircuitFault('DMA_COMMAND_OVERLAP','RD and WR');
            if(level(read,'m_io')!==0)throw new CircuitFault('DMA_IO_STATUS','memory status during I/O');
            const reg=bits(A,read);
            if(reg<16||reg===0x81) {
                if(level(read,'bhe_n')!==((reg&1)?0:1))throw new CircuitFault('UNSUPPORTED_DMA_WORD_IO','byte cycles only');
                // Undefined/write-only register reads stay undriven; never clear
                // the shared byte pointer as a side effect of reading port 0Ch.
                if(wr===0||[4,5,8].includes(reg))access={reg,lane:(reg&1)*8};
            }
        }
        if(this.writeCycle&&wr===1){this._write(this.writeCycle.reg,this.writeCycle.value);this.writeCycle=null;}
        if(access&&wr===0) {
            if(this.writeCycle&&this.writeCycle.reg!==access.reg)throw new CircuitFault('DMA_PORT_CHANGED','during WR');
            this.writeCycle={...access,value:bits(D.slice(access.lane,access.lane+8),read)};
        } else if(this.writeCycle)throw new CircuitFault('DMA_PORT_CHANGED','select removed before WR trailing edge');
        if(rd===1)this.readCycle=null;
        if(access&&rd===0) {
            if(this.readCycle&&this.readCycle.reg!==access.reg)throw new CircuitFault('DMA_PORT_CHANGED','during RD');
            if(!this.readCycle){this.readCycle={...access,value:this.#core.read(access.reg)};this.reads++;}
        } else if(this.readCycle)throw new CircuitFault('DMA_PORT_CHANGED','select removed during RD');
        const drive=released();
        if(this.readCycle)Object.assign(drive,bitDrives(D.slice(this.readCycle.lane,this.readCycle.lane+8),this.readCycle.value));
        return drive;
    }
    inspect(){const s=this.#core.getState();return {channel2:{...s.channels[2]},command:s.command,
        status:s.status,byteHigh:s.ff,hrq:s.hrq,reads:this.reads,writes:this.writes};}
}
