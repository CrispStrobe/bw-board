/** Bounded, synchronous IBM AT 8042 keyboard/system-control model. */
export class AT8042A20 {
    constructor({a20Enabled=false,onA20Change=null,onIRQ=null,queueLimit=16}={}) {
        if (!Number.isInteger(queueLimit)||queueLimit<1||queueLimit>256) throw new Error('AT 8042 queueLimit must be 1..256');
        this.initialA20Enabled=!!a20Enabled;
        this.onA20Change=onA20Change;
        this.onIRQ=onIRQ;
        this.queueLimit=queueLimit;
        this.reset();
    }
    reset() {
        this.outputPort=1|(this.initialA20Enabled?2:0);
        this.commandByte=0;
        this.pendingCommand=null;
        this.outputQueue=[];
        this._publish();
    }
    _publish() {
        this.onA20Change?.(!!(this.outputPort&2));
        const active=!!((this.commandByte&1)&&this.outputQueue[0]?.keyboard);
        if(active!==this._irq) {
            this._irq=active;
            this.onIRQ?.(active);
        }
    }
    _queue(value,keyboard=false) {
        if(this.outputQueue.length>=this.queueLimit) throw new Error('AT 8042 output queue full');
        this.outputQueue.push({value:value&255,keyboard:!!keyboard});
        this._publish();
    }
    setA20Enabled(enabled) { this.outputPort=(this.outputPort&~2)|(enabled?2:0); this._publish(); }
    readStatus() { return this.outputQueue.length?1:0; }
    readData() {
        if(!this.outputQueue.length)return 0xff;
        const entry=this.outputQueue.shift();
        const v=entry.value;
        // Two queued keyboard bytes are two edges. The first acknowledge may
        // have cleared the PIC IRR while the controller output stayed full.
        if(entry.keyboard&&this._irq&&this.outputQueue[0]?.keyboard) {
            this._irq=false;
            this.onIRQ?.(false);
        }
        this._publish();
        return v;
    }
    writeCommand(value) {
        value&=255;
        if(value===0x20){this._queue(this.commandByte);this.pendingCommand=null;return;}
        if(value===0x60){this.pendingCommand=0x60;return;}
        if(value===0xad){this.commandByte|=0x10;this._publish();return;}
        if(value===0xae){this.commandByte&=~0x10;this._publish();return;}
        if(value===0xaa){this._queue(0x55);this.pendingCommand=null;return;}
        if(value===0xab){this._queue(0x00);this.pendingCommand=null;return;}
        if(value===0xd0){if(this.outputQueue.length)throw new Error('AT 8042 D0 refused: output buffer is full');this.pendingCommand=null;this._queue(this.outputPort);return;}
        if(value===0xd1){this.pendingCommand=0xd1;return;}
        throw new Error(`AT 8042 command ${value.toString(16).padStart(2,'0')}h is outside the bounded A20 subset and keyboard extension`);
    }
    writeData(value) {
        value&=255;
        if(this.pendingCommand===0x60){this.pendingCommand=null;this.commandByte=value;this._publish();return;}
        if(this.pendingCommand!==0xd1)throw new Error('AT 8042 data write refused: no D1 output-port command or 60h command-byte command is pending');
        if(!(value&1))throw new Error('AT 8042 output-port write refused: bit 0 low requests unsupported CPU reset');
        this.pendingCommand=null;this.outputPort=value;this._publish();
    }
    injectSet1(value) {
        if(!Number.isInteger(value)||value<0||value>255)throw new Error('AT 8042 scancode must be a byte');
        if(this.commandByte&0x10)return false;
        this._queue(value,true);
        return true;
    }
    getState() {
        return {v:2,outputPort:this.outputPort,commandByte:this.commandByte,
            pendingCommand:this.pendingCommand,outputQueue:this.outputQueue.map(e=>({...e}))};
    }
    validateState(s) {
        if(!s||s.v!==2||!Number.isInteger(s.outputPort)||s.outputPort<0||s.outputPort>255||!(s.outputPort&1)||
            !Number.isInteger(s.commandByte)||s.commandByte<0||s.commandByte>255||
            ![null,0x60,0xd1].includes(s.pendingCommand)||!Array.isArray(s.outputQueue)||
            s.outputQueue.length>this.queueLimit||s.outputQueue.some(e=>!e||!Number.isInteger(e.value)||
                e.value<0||e.value>255||typeof e.keyboard!=='boolean'))throw new Error('AT 8042 state is invalid');
    }
    setState(s) {
        this.validateState(s);
        this.outputPort=s.outputPort;
        this.commandByte=s.commandByte;
        this.pendingCommand=s.pendingCommand;
        this.outputQueue=s.outputQueue.map(e=>({...e}));
        this._irq=undefined;
        this._publish();
    }
}
