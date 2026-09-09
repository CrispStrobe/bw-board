/** Explicit XT-style scancode latch + mode-0 8255 byte-lane bridge. No BIOS traps. */
import {I8255} from '../i8255.js';
import {CircuitFault,bitPins,bitDrives} from './digital-circuit.js';
const A=bitPins('a',24),D=bitPins('d',16);
const bit=(read,p)=>{const v=read(p);if(v!==0&&v!==1)throw new CircuitFault(v==='Z'?'FLOATING':'UNKNOWN',p);return v;};
const bits=(pins,read)=>pins.reduce((v,p,i)=>v+bit(read,p)*2**i,0);
const release=()=>Object.fromEntries(D.map(p=>[p,'Z']));
export class HarrisKeyboardAdapter {
    #core=new I8255();
    constructor({enabled=false,id='keyboard'}={}){
        if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
        this.id=id;this.portBase=0x60;this.ioInterface='harris-keyboard-byte-lanes';this.reset();
    }
    reset(){this.#core.reset();this.scan=null;this.irq=0;this.portB=0;this.configured=false;this.readCycle=null;this.writeCycle=null;this.keys=0;}
    press(scan){
        if(!Number.isInteger(scan)||scan<0||scan>255)throw new RangeError('scancode');
        if(this.scan!==null)throw new CircuitFault('KEYBOARD_BUSY','previous scancode not acknowledged');
        this.scan=scan;this.#core.setInputPort('a',scan);this.irq=1;this.keys++;
    }
    part(){return {id:this.id,pins:['reset','ior_n','iow_n','bhe_n','m_io','irq1',...A,...D],outputs:['irq1',...D]};}
    write(reg,value){
        if(reg===3){if(value!==0x99)throw new CircuitFault('UNSUPPORTED_PPI_MODE','99h required');this.configured=true;}
        else if(reg!==1||!this.configured)throw new CircuitFault('UNSUPPORTED_PPI_WRITE','configured port B only');
        this.#core.write(reg,value);
        if(reg===1){if(!(this.portB&128)&&(value&128)){this.irq=0;this.scan=null;}this.portB=value;}
    }
    update(read){
        if(bit(read,'reset')){this.reset();return {...release(),irq1:0};}
        const rd=bit(read,'ior_n'),wr=bit(read,'iow_n');let access=null;
        if(!rd||!wr){
            if(!rd&&!wr)throw new CircuitFault('PPI_COMMAND_OVERLAP','RD/WR');
            if(bit(read,'m_io'))throw new CircuitFault('PPI_IO_STATUS','memory during I/O');
            const addr=bits(A,read),reg=addr-0x60;
            if(reg>=0&&reg<4){
                if(bit(read,'bhe_n')!==((addr&1)?0:1))throw new CircuitFault('UNSUPPORTED_PPI_WORD_IO','byte cycles only');
                if(!wr||reg<3)access={reg,lane:(addr&1)*8};
            }
        }
        if(this.writeCycle&&wr){this.write(this.writeCycle.reg,this.writeCycle.value);this.writeCycle=null;}
        if(access&&!wr){
            if(this.writeCycle&&this.writeCycle.reg!==access.reg)throw new CircuitFault('PPI_PORT_CHANGED','WR');
            this.writeCycle={...access,value:bits(D.slice(access.lane,access.lane+8),read)};
        }else if(this.writeCycle)throw new CircuitFault('PPI_PORT_CHANGED','WR selection removed');
        if(rd)this.readCycle=null;
        if(access&&!rd){
            if(this.readCycle&&this.readCycle.reg!==access.reg)throw new CircuitFault('PPI_PORT_CHANGED','RD');
            if(!this.readCycle)this.readCycle={...access,value:this.#core.read(access.reg)};
        }else if(this.readCycle)throw new CircuitFault('PPI_PORT_CHANGED','RD selection removed');
        const drive=release();if(this.readCycle)Object.assign(drive,bitDrives(D.slice(this.readCycle.lane,this.readCycle.lane+8),this.readCycle.value));
        return {...drive,irq1:this.irq};
    }
    inspect(){return {configured:this.configured,scan:this.scan,irq1:this.irq,portB:this.portB,keys:this.keys};}
}
