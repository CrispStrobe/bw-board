/** Channel-2 register bridge with separately gated pin transfers; no DMA memory callbacks. */
import {I8237} from '../i8237.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const level=(read,p)=>{const v=read(p);if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);return v;};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const RELEASED_DATA=Object.freeze(Object.fromEntries(D.map(p=>[p,'Z'])));
const released=()=>({...RELEASED_DATA});
const RELEASED_ADDRESS=Object.freeze(Object.fromEntries(A.map(p=>[p,'Z'])));
export class HarrisDMAAdapter {
    #core;
    constructor({enabled=false,id='dma',transferEnabled=false}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        this.id=id;this.ioInterface='harris-dma-registers';
        if(typeof transferEnabled!=='boolean')throw new TypeError('transferEnabled');
        this.transferEnabled=transferEnabled;
        this.capabilities=Object.freeze({experimental:true,channel2Registers:true,transfers:transferEnabled,
            hold:transferEnabled,hlda:transferEnabled,terminalCount:transferEnabled,callbacks:false});
        this.#core=new I8237();this.reset();
    }
    reset(){this.#core.reset();this.readCycle=null;this.writeCycle=null;this.reads=0;this.writes=0;this.master='IDLE';this.byte=null;this.transferred=0;this.tcPulses=0;}
    part(){const extra=this.transferEnabled?['hlda','hold','dack2_n','tc','s0_n','s1_n','cod_inta_n',...A.map(p=>`io_${p}`),'io_bhe_n','io_m_io']:[];
        return {id:this.id,pins:['reset','ior_n','iow_n','bhe_n','m_io','dreq2',...A,...D,...extra],
            outputs:[...D,...(this.transferEnabled?[...A,'bhe_n','m_io','hold','dack2_n','tc','s0_n','s1_n','cod_inta_n']:[])]};}
    masterDrives(){
        const active=this.byte&&['TS1','TS2','TC1','TC2','DONE'].includes(this.master),ts=this.master==='TS1'||this.master==='TS2';
        return {...(active?bitDrives(A,this.byte.address):RELEASED_ADDRESS),
            bhe_n:active?((this.byte.address&1)?0:1):'Z',m_io:active?1:'Z',cod_inta_n:active?0:'Z',
            s0_n:ts&&!this.byte.verify?(this.byte.write?0:1):1,s1_n:ts&&!this.byte.verify?(this.byte.write?1:0):1,
            hold:Number(this.master!=='DROP'&&(this.master!=='IDLE'||this.#core.hrq)),
            dack2_n:Number(!['TC1','TC2'].includes(this.master)),tc:Number(!!this.byte?.last&&['TC1','TC2','DONE'].includes(this.master))};
    }
    beginMaster(read){
        if(level(read,'reset')){this.reset();return this.masterDrives();}
        const grant=level(read,'hlda');
        if(this.master==='DONE'){this.master='DROP';this.byte=null;}
        else if(this.master==='DROP'){if(!grant)this.master='IDLE';}
        else if(this.master==='IDLE'&&grant&&this.#core.hrq){
            const c=this.#core.channels[2];
            this.byte={address:(c.page<<16)|c.curAddr,write:c.transferType===1,verify:c.transferType===0,last:c.curCount===0};this.master='TS1';
        }
        return this.masterDrives();
    }
    endMaster(read){
        if(['TS1','TS2','TC1','TC2'].includes(this.master)&&!level(read,'hlda'))throw new CircuitFault('DMA_LOST_GRANT',this.master);
        if(this.master==='TS1')this.master='TS2';
        else if(this.master==='TS2')this.master='TC1';
        else if(this.master==='TC1')this.master='TC2';
        else if(this.master==='TC2'&&(this.byte.verify||!level(read,'ready_n'))){
            // Validate the actual byte before advancing counters. No memory callback.
            if(!this.byte.verify)bits(D.slice((this.byte.address&1)*8,(this.byte.address&1)*8+8),read);
            const c=this.#core.channels[2];c.curAddr=(c.curAddr+1)&65535;c.curCount=(c.curCount-1)&65535;
            if(this.byte.last){this.#core.status|=4;c.masked=true;this.tcPulses++;}
            this.transferred++;this.master='DONE';this.#core.dreq(2,level(read,'dreq2'));
            return {dack2_n:1};
        } else if(this.master==='TC2')this.master='TC1';
        return null;
    }
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
        if(reg===11&&![0x46,0x4a,...(this.transferEnabled?[0x42]:[])].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_MODE','channel 2, single, increment, no autoinit; verify requires transfer gate');
        if(reg===14||reg===15&&![0x0b,0x0f].includes(value))throw new CircuitFault('UNSUPPORTED_DMA_CHANNEL','other channels must stay masked');
        this.#core.write(reg,value);this.writes++;
    }
    update(read) {
        if(level(read,'reset')){this.reset();return {...released(),...(this.transferEnabled?this.masterDrives():{})};}
        const request=level(read,'dreq2');
        if(request&&!this.transferEnabled)throw new CircuitFault('UNSUPPORTED_DMA_TRANSFER','DREQ2 requires HOLD/HLDA, ownership and TC');
        if(this.transferEnabled)this.#core.dreq(2,request);
        const rd=level(read,'ior_n'),wr=level(read,'iow_n');let access=null;
        if(rd===0||wr===0) {
            if(rd===0&&wr===0)throw new CircuitFault('DMA_COMMAND_OVERLAP','RD and WR');
            const ioRead=p=>read(this.transferEnabled?`io_${p}`:p);
            if(level(ioRead,'m_io')!==0)throw new CircuitFault('DMA_IO_STATUS','memory status during I/O');
            const reg=bits(A,ioRead);
            if(reg<16||reg===0x81) {
                if(level(ioRead,'bhe_n')!==((reg&1)?0:1))throw new CircuitFault('UNSUPPORTED_DMA_WORD_IO','byte cycles only');
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
        return {...drive,...(this.transferEnabled?{hold:Number(this.master!=='DROP'&&(this.master!=='IDLE'||this.#core.hrq))}:{})};
    }
    inspect(){const s=this.#core.getState();return {channel2:{...s.channels[2]},command:s.command,
        status:s.status,byteHigh:s.ff,hrq:s.hrq,reads:this.reads,writes:this.writes,
        ...(this.transferEnabled?{master:this.master,transferred:this.transferred,tcPulses:this.tcPulses}:{})};}
}
