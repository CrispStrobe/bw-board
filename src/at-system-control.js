/** IBM AT port 61h system-control latch and timer-status input. */
export class ATSystemControl {
    constructor({onTimer2Gate=null}={}) {
        this.onTimer2Gate=onTimer2Gate;
        this.reset();
    }
    reset() {
        this.latch=0;
        this.refresh=false;
        this.refreshClock=false;
        this.timer2=false;
        this.onTimer2Gate?.(false);
    }
    read() {
        return (this.latch&0x0f)|(this.refresh?0x10:0)|(this.timer2?0x20:0);
    }
    write(_reg,value) {
        this.latch=value&0x0f;
        this.onTimer2Gate?.(!!(this.latch&1));
    }
    setRefresh(level) {
        level=!!level;
        if(level&&!this.refreshClock)this.refresh=!this.refresh;
        this.refreshClock=level;
    }
    setTimer2(level) { this.timer2=!!level; }
    getState() { return {v:1,latch:this.latch,refresh:this.refresh,refreshClock:this.refreshClock,timer2:this.timer2}; }
    validateState(s) {
        if(!s||s.v!==1||!Number.isInteger(s.latch)||s.latch<0||s.latch>15||
            typeof s.refresh!=='boolean'||typeof s.refreshClock!=='boolean'||typeof s.timer2!=='boolean')
            throw new Error('AT system-control state is invalid');
    }
    setState(s) {
        this.validateState(s);
        this.latch=s.latch;this.refresh=s.refresh;this.refreshClock=s.refreshClock;this.timer2=s.timer2;
        this.onTimer2Gate?.(!!(this.latch&1));
    }
}

/** IBM AT 80h-8Fh DMA page-register file, including diagnostic latches. */
export class ATDMAPageRegisters {
    constructor({primary,secondary}) {
        if(!primary||!secondary)throw new Error('AT DMA page registers require both DMA controllers');
        this.primary=primary;this.secondary=secondary;this.reset();
    }
    reset() {
        this.bytes=new Uint8Array(16);
        for(const dma of [this.primary,this.secondary])
            for(const channel of dma.channels)channel.page=0;
    }
    read(reg) { return this.bytes[reg&15]; }
    write(reg,value) {
        reg&=15;value&=255;this.bytes[reg]=value;
        const primary={1:2,2:3,3:1,7:0}[reg];
        const secondary={9:2,10:3,11:1,15:0}[reg];
        if(primary!==undefined)this.primary.channels[primary].page=value;
        if(secondary!==undefined)this.secondary.channels[secondary].page=value;
    }
    getState() { return {v:1,bytes:[...this.bytes]}; }
    validateState(s) {
        if(!s||s.v!==1||!Array.isArray(s.bytes)||s.bytes.length!==16||
            s.bytes.some(v=>!Number.isInteger(v)||v<0||v>255))
            throw new Error('AT DMA page-register state is invalid');
    }
    setState(s) {
        this.validateState(s);this.reset();
        s.bytes.forEach((value,reg)=>this.write(reg,value));
    }
}
