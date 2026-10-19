/**
 * Gated ideal digital PIC + address decoder/byte-lane bridge, NOT a bare
 * 8259 pin model. Single, edge-triggered, fixed-priority, explicit EOI only.
 * Protocol basis and limitations: docs/HARRIS-286-PIC.md.
 */
import {I8259} from '../i8259.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';

const A=bitPins('a',24),D=bitPins('d',16),IR=bitPins('ir',8);
const level=(read,p)=>{
    const v=read(p);
    if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);
    return v;
};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+level(read,p)*2**i,0);
const RELEASED_DATA=Object.freeze(Object.fromEntries(D.map(p=>[p,'Z'])));
const released=()=>({...RELEASED_DATA});

export class Harris8259Adapter {
    constructor({enabled=false,id='pic',portBase=0x20}={}) {
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        if(!Number.isInteger(portBase)||portBase<0||portBase>0xfffe||(portBase&1))throw new RangeError('even 16-bit portBase required');
        this.id=id;this.portBase=portBase;this.ioInterface='harris-pic-byte-lanes';
        this.capabilities=Object.freeze({experimental:true,single:true,edgeTriggered:true,
            fixedPriority:true,explicitEOI:true,poll:true,cascade:false,autoEOI:false,
            levelTriggered:false,full8259:false,electricalTiming:false});
        this.core=new I8259();this.reset();
    }
    reset() {
        this.core.reset();this.initialized=false;this.previousIR=Array(8).fill(0);
        this.previousINTA=1;this.pulse=0;this.vector=null;
        this.readCycle=null;this.writeCycle=null;this.writes=0;this.reads=0;this.pairs=0;
    }
    part() {
        return {id:this.id,pins:['reset','inta_n','ior_n','iow_n','bhe_n','m_io','intr',...A,...D,...IR],outputs:['intr',...D]};
    }
    _write(reg,value) {
        if(reg===0&&(value&0x10)) {
            if((value&0x0b)!==3)throw new CircuitFault('UNSUPPORTED_PIC_MODE','ICW1 requires single, edge, ICW4');
            this.core.reset();this.initialized=false;
        } else if(reg===1&&this.core.initPhase===3) {
            if(value!==1)throw new CircuitFault('UNSUPPORTED_PIC_MODE','ICW4 must be 01h (8086, normal EOI)');
        } else if(this.core.initPhase===0) {
            if(!this.initialized)throw new CircuitFault('PIC_NOT_INITIALIZED','write ICW1 first');
            if(reg===0&&![0x20,0x40,0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,0x0a,0x0b,0x0c].includes(value))
                throw new CircuitFault('UNSUPPORTED_PIC_MODE','only EOI, no-op, IRR/ISR selection and poll commands');
        } else if(reg===0)throw new CircuitFault('PIC_INIT_SEQUENCE','data port expected');
        this.core.write(reg,value);this.writes++;
        this.initialized=this.core.initPhase===0;
    }
    update(read) {
        if(level(read,'reset')) {this.reset();return {intr:0,...released()};}
        const inta=level(read,'inta_n'),rd=level(read,'ior_n'),wr=level(read,'iow_n');
        const ir=IR.map(p=>level(read,p));
        // A held request must not retrigger after EOI. A new edge is required.
        // Deassertion before acknowledgement withdraws the request (spurious
        // IRQ7 if the CPU has already accepted INT). No sub-clock pulse model.
        if(this.initialized)for(let i=0;i<8;i++)if(ir[i]!==this.previousIR[i])this.core.setIRQ(i,ir[i]);
        this.previousIR=ir;
        let access=null;
        if(rd===0||wr===0) {
            if(rd===0&&wr===0)throw new CircuitFault('PIC_COMMAND_OVERLAP','RD and WR');
            if(inta===0||this.pulse!==0)throw new CircuitFault('PIC_COMMAND_OVERLAP','I/O during INTA pair');
            if(level(read,'m_io')!==0)throw new CircuitFault('PIC_IO_STATUS','memory status during I/O');
            const address=bits(A,read),bhe=level(read,'bhe_n');
            if(address===this.portBase||address===this.portBase+1) {
                if((address&1)?bhe!==0:bhe!==1)throw new CircuitFault('UNSUPPORTED_PIC_WORD_IO','byte ports only');
                access={reg:address-this.portBase,lane:(address&1)*8};
            }
        }
        if(this.writeCycle&&wr===1) {
            this._write(this.writeCycle.reg,this.writeCycle.value);this.writeCycle=null;
        }
        if(access&&wr===0) {
            if(this.writeCycle&&this.writeCycle.reg!==access.reg)throw new CircuitFault('PIC_PORT_CHANGED','during WR');
            this.writeCycle={...access,value:bits(D.slice(access.lane,access.lane+8),read)};
        } else if(this.writeCycle)throw new CircuitFault('PIC_PORT_CHANGED','select removed before WR trailing edge');
        if(rd===1)this.readCycle=null;
        if(access&&rd===0) {
            if(!this.initialized)throw new CircuitFault('PIC_NOT_INITIALIZED','read before ICW completion');
            if(this.readCycle&&this.readCycle.reg!==access.reg)throw new CircuitFault('PIC_PORT_CHANGED','during RD');
            if(!this.readCycle) {this.readCycle={...access,value:this.core.read(access.reg)};this.reads++;}
        } else if(this.readCycle)throw new CircuitFault('PIC_PORT_CHANGED','select removed during RD');
        if(this.previousINTA===1&&inta===0) {
            if(!this.initialized)throw new CircuitFault('PIC_NOT_INITIALIZED','INTA before ICW completion');
            this.pulse++;
            if(this.pulse===1)this.vector=this.core.acknowledge();
        }
        if(this.previousINTA===0&&inta===1&&this.pulse===2) {this.pairs++;this.pulse=0;this.vector=null;}
        this.previousINTA=inta;
        const drive=released();
        if(this.readCycle)Object.assign(drive,bitDrives(D.slice(this.readCycle.lane,this.readCycle.lane+8),this.readCycle.value));
        if(inta===0&&this.pulse===2)Object.assign(drive,bitDrives(D.slice(0,8),this.vector));
        return {...drive,intr:Number(this.initialized&&this.pulse===0&&this.core.intActive)};
    }
    inspect() {
        return {initialized:this.initialized,initPhase:this.core.initPhase,irr:this.core.irr,isr:this.core.isr,
            imr:this.core.imr,vectorBase:this.core.vectorBase,pulse:this.pulse,vector:this.vector,
            writes:this.writes,reads:this.reads,pairs:this.pairs};
    }
}
