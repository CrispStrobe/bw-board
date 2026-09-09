/** Gated ideal digital FDC control/byte-lane bridge, not a bare 765 pin model.
 * Control-only by default; transfer mode advances the sector core via DACK/TC,
 * without a DMA memory callback. See HARRIS-286-PHYSICAL-DMA.md for the limits.
 */
import {UPD765} from '../upd765.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const level=(read,p)=>{const v=read(p);if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);return v;};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const RELEASED_DATA=Object.freeze(Object.fromEntries(D.map(p=>[p,'Z'])));
const released=()=>({...RELEASED_DATA});
// This variant never enters the core's synchronous callback pump or automatic
// PIO fallback. Bytes advance only after the external DACK edge below.
class PinTransferFDC extends UPD765 {
    _pio(){return this.nonDma;}
    _pumpDma(){}
    acceptPinByte(value,tc){
        if(this.phase!=='exec')throw new CircuitFault('FDC_DMA_PHASE','DACK without execution');
        if(tc)this.exec.tc=true;
        if(this.exec.toHost)this._advanceOut();else this._acceptIn(value);
        if(this.phase==='exec'&&this.exec.tc)this._endTransferOnTc();
    }
}
export class HarrisFDCAdapter {
    #core;
    constructor({enabled=false,id='fdc',portBase=0x3f0,transferEnabled=false}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        if(!Number.isInteger(portBase)||portBase<0||portBase>0xfff8||(portBase&7))throw new RangeError('8-aligned portBase required');
        this.id=id;this.portBase=portBase;this.ioInterface='harris-fdc-byte-lanes';
        if(typeof transferEnabled!=='boolean')throw new TypeError('transferEnabled');this.transferEnabled=transferEnabled;
        this.capabilities=Object.freeze({experimental:true,controlOnly:!transferEnabled,irq6:true,
            sectorTransfers:transferEnabled,dma:transferEnabled,pioTransfers:false,media:transferEnabled,electricalTiming:false});
        this.#core=transferEnabled?new PinTransferFDC():new UPD765();this.reset();
    }
    reset(){this.#core.reset();this.readCycle=null;this.writeCycle=null;this.reads=0;this.writes=0;this.dmaCycle=null;this.dmaBytes=0;}
    loadMedia(bytes,geometry){
        if(!this.transferEnabled)throw new CircuitFault('EXPERIMENT_DISABLED','FDC transfer mode required');
        if(this.#core.phase!=='command'||this.dmaCycle)throw new CircuitFault('FDC_BUSY','media replacement during command');
        if(!(bytes instanceof Uint8Array))throw new TypeError('media bytes');
        this.#core.insert(0,bytes.slice(),geometry);
    }
    part(){return {id:this.id,pins:['reset','ior_n','iow_n','bhe_n','m_io','irq6',...A,...D,
        ...(this.transferEnabled?['dreq2','dack2_n','tc','dma_a0','dma_write_n']:[])],outputs:['irq6',...D,...(this.transferEnabled?['dreq2']:[])]};}
    _write(reg,value) {
        if(reg===4)throw new CircuitFault('FDC_READ_ONLY','MSR');
        if(reg===5) {
            if(!(this.#core.dor&4))throw new CircuitFault('FDC_HELD_RESET','FIFO write');
            if(this.#core.phase!=='command')throw new CircuitFault('FDC_FIFO_DIRECTION','drain results before commands');
            // Flat sector images have no deleted-data marks. SK has no effect
            // on these normal sectors, matching the sector core's contract.
            const data=this.transferEnabled&&[5,6].includes(value&0x1f);
            if(!this.#core.cmdBuf.length&&data&&this.#core.nonDma)throw new CircuitFault('UNSUPPORTED_FDC_PIO','DMA only');
            if(!this.#core.cmdBuf.length&&![3,4,7,8,15].includes(value)&&!data)
                throw new CircuitFault('UNSUPPORTED_FDC_COMMAND','control-only bridge; no sector/DMA/PIO transfers');
        }
        this.#core.write(reg,value);this.writes++;
    }
    update(read) {
        if(level(read,'reset')){this.reset();return {irq6:0,...released(),...(this.transferEnabled?{dreq2:0}:{})};}
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
        if(this.transferEnabled){
            const ack=level(read,'dack2_n');
            if(!ack&&!this.dmaCycle){
                if(this.#core.phase!=='exec')throw new CircuitFault('FDC_DMA_PHASE','DACK without execution');
                const x=this.#core.exec;this.dmaCycle={lane:level(read,'dma_a0')*8,toHost:x.toHost,byte:x.toHost?x.buf[x.idx]:null,done:false};
            }
            if(ack&&this.dmaCycle&&!this.dmaCycle.done){
                const c=this.dmaCycle;
                this.#core.acceptPinByte(c.toHost?c.byte:bits(D.slice(c.lane,c.lane+8),read),level(read,'tc'));
                c.done=true;this.dmaBytes++;
            }
            if(this.dmaCycle?.done&&level(read,'dma_write_n'))this.dmaCycle=null;
            if(this.dmaCycle?.toHost)Object.assign(drive,bitDrives(D.slice(this.dmaCycle.lane,this.dmaCycle.lane+8),this.dmaCycle.byte));
        }
        return {...drive,irq6:Number(this.#core.irq),...(this.transferEnabled?{dreq2:Number(this.#core.phase==='exec'&&!!(this.#core.dor&8))}:{})};
    }
    inspect(){const c=this.#core;return {dor:c.dor,irq6:Number(c.irq),phase:c.phase,pendingInterrupts:c.pendingInt.length,
        commandBytes:[...c.cmdBuf],resultRemaining:c.resultBuf.length-c.resultIdx,nonDma:c.nonDma,
        srt:c.srt,hut:c.hut,hlt:c.hlt,reads:this.reads,writes:this.writes,...(this.transferEnabled?{dmaBytes:this.dmaBytes}:{})};}
}
