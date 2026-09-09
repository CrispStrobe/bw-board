/** Gated ideal digital FDC control/byte-lane bridge, not a bare 765 pin model.
 * Reuses the sector-level core only for control commands. No media or DMA API.
 */
import {UPD765} from '../upd765.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const level=(read,p)=>{const v=read(p);if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);return v;};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const released=()=>Object.fromEntries(D.map(p=>[p,'Z']));
export class HarrisFDCAdapter {
    #core;
    constructor({enabled=false,id='fdc',portBase=0x3f0}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        if(!Number.isInteger(portBase)||portBase<0||portBase>0xfff8||(portBase&7))throw new RangeError('8-aligned portBase required');
        this.id=id;this.portBase=portBase;this.ioInterface='harris-fdc-byte-lanes';
        this.capabilities=Object.freeze({experimental:true,controlOnly:true,irq6:true,
            sectorTransfers:false,dma:false,pioTransfers:false,media:false,electricalTiming:false});
        this.#core=new UPD765();this.reset();
    }
    reset(){this.#core.reset();this.readCycle=null;this.writeCycle=null;this.reads=0;this.writes=0;}
    part(){return {id:this.id,pins:['reset','ior_n','iow_n','bhe_n','m_io','irq6',...A,...D],outputs:['irq6',...D]};}
    _write(reg,value) {
        if(reg===4)throw new CircuitFault('FDC_READ_ONLY','MSR');
        if(reg===5) {
            if(!(this.#core.dor&4))throw new CircuitFault('FDC_HELD_RESET','FIFO write');
            if(this.#core.phase!=='command')throw new CircuitFault('FDC_FIFO_DIRECTION','drain results before commands');
            if(!this.#core.cmdBuf.length&&![3,4,7,8,15].includes(value))
                throw new CircuitFault('UNSUPPORTED_FDC_COMMAND','control-only bridge; no sector/DMA/PIO transfers');
        }
        this.#core.write(reg,value);this.writes++;
    }
    update(read) {
        if(level(read,'reset')){this.reset();return {irq6:0,...released()};}
        const rd=level(read,'ior_n'),wr=level(read,'iow_n');let access=null;
        if(rd===0||wr===0) {
            if(rd===0&&wr===0)throw new CircuitFault('FDC_COMMAND_OVERLAP','RD and WR');
            if(level(read,'m_io')!==0)throw new CircuitFault('FDC_IO_STATUS','memory status during I/O');
            const address=bits(A,read),reg=address-this.portBase;
            if([2,4,5].includes(reg)) {
                if(level(read,'bhe_n')!==((address&1)?0:1))throw new CircuitFault('UNSUPPORTED_FDC_WORD_IO','byte ports only');
                // DOR is write-only; undriven reads remain genuinely floating.
                if(wr===0||reg!==2)access={reg,lane:(address&1)*8};
            }
        }
        if(this.writeCycle&&wr===1){this._write(this.writeCycle.reg,this.writeCycle.value);this.writeCycle=null;}
        if(access&&wr===0) {
            if(this.writeCycle&&this.writeCycle.reg!==access.reg)throw new CircuitFault('FDC_PORT_CHANGED','during WR');
            this.writeCycle={...access,value:bits(D.slice(access.lane,access.lane+8),read)};
        } else if(this.writeCycle)throw new CircuitFault('FDC_PORT_CHANGED','select removed before WR trailing edge');
        if(rd===1)this.readCycle=null;
        if(access&&rd===0) {
            if(this.readCycle&&this.readCycle.reg!==access.reg)throw new CircuitFault('FDC_PORT_CHANGED','during RD');
            if(!this.readCycle) {
                if(access.reg===5&&this.#core.phase!=='result')throw new CircuitFault('FDC_FIFO_DIRECTION','no result to read');
                this.readCycle={...access,value:this.#core.read(access.reg)};this.reads++;
            }
        } else if(this.readCycle)throw new CircuitFault('FDC_PORT_CHANGED','select removed during RD');
        const drive=released();
        if(this.readCycle)Object.assign(drive,bitDrives(D.slice(this.readCycle.lane,this.readCycle.lane+8),this.readCycle.value));
        return {...drive,irq6:Number(this.#core.irq)};
    }
    inspect(){const c=this.#core;return {dor:c.dor,irq6:Number(c.irq),phase:c.phase,pendingInterrupts:c.pendingInt.length,
        commandBytes:[...c.cmdBuf],resultRemaining:c.resultBuf.length-c.resultIdx,nonDma:c.nonDma,
        srt:c.srt,hut:c.hut,hlt:c.hlt,reads:this.reads,writes:this.writes};}
}
