/** Deterministic, cycle-driven MC146818 subset for the opt-in AT profile. */
export class MC146818 {
    constructor(clockHz,{initialUnixSeconds=0,onIRQ=null,onNmiMask=null}={}) {
        if(!Number.isInteger(clockHz)||clockHz<1)throw new Error('MC146818 clockHz must be positive');
        if(!Number.isSafeInteger(initialUnixSeconds)||initialUnixSeconds<0||initialUnixSeconds>8640000000)throw new Error('MC146818 initialUnixSeconds is outside the supported Date range');
        this.clockHz=clockHz;
        this.initialUnixSeconds=initialUnixSeconds;
        this.onIRQ=onIRQ;
        this.onNmiMask=onNmiMask;
        this.reset();
    }
    reset() {
        this.index=0;
        this.nmiMasked=false;
        this.seconds=this.initialUnixSeconds;
        this.cyclePhase=0;
        this.periodicPhase=0;
        this.ram=new Uint8Array(128);
        this.ram[0x0a]=0x26;
        this.ram[0x0b]=0x02;
        this.ram[0x0c]=0;
        this.ram[0x0d]=0x80;
        this._irq=false;
        this._publish();
    }
    _publish() {
        const enabled=((this.ram[0x0c]&0x40)&&(this.ram[0x0b]&0x40))||
            ((this.ram[0x0c]&0x20)&&(this.ram[0x0b]&0x20))||
            ((this.ram[0x0c]&0x10)&&(this.ram[0x0b]&0x10));
        if(enabled)this.ram[0x0c]|=0x80;else this.ram[0x0c]&=0x7f;
        const active=!!enabled;
        if(active!==this._irq) {
            this._irq=active;
            this.onIRQ?.(active);
        }
        this.onNmiMask?.(this.nmiMasked);
    }
    _enc(n) { return(this.ram[0x0b]&4)?n:((n/10|0)<<4)|(n%10); }
    _timeReg(r) {
        const d=new Date(this.seconds*1000);
        let v={0:d.getUTCSeconds(),2:d.getUTCMinutes(),4:d.getUTCHours(),6:d.getUTCDay()+1,
            7:d.getUTCDate(),8:d.getUTCMonth()+1,9:d.getUTCFullYear()%100}[r];
        if(r===4&&!(this.ram[0x0b]&2)) {
            const pm=v>=12;
            v%=12;
            if(v===0)v=12;
            return this._enc(v)|(pm?0x80:0);
        }
        return this._enc(v);
    }
    read(reg){
        if(!(reg&1))return this.index|(this.nmiMasked?0x80:0);
        const r=this.index;
        if([0,2,4,6,7,8,9].includes(r))return this._timeReg(r);
        if(r===0x0a) {
            const uip=!(this.ram[0x0b]&0x80)&&
                this.cyclePhase>=this.clockHz-Math.max(1,Math.floor(this.clockHz*244/1_000_000));
            return(this.ram[r]&0x7f)|(uip?0x80:0);
        }
        if(r===0x0c) {
            const v=this.ram[r];
            this.ram[r]=0;
            this._publish();
            return v;
        }
        return this.ram[r];
    }
    write(reg,value){
        value&=255;
        if(!(reg&1)) {
            this.index=value&0x7f;
            this.nmiMasked=!!(value&0x80);
            this._publish();
            return;
        }
        const r=this.index;
        if([0,2,4,6,7,8,9].includes(r))throw new Error('MC146818 calendar writes are outside the bounded deterministic subset');
        if(r===0x0c||r===0x0d)throw new Error('MC146818 read-only register write refused');
        if(r===0x0a) {
            const rate=value&15;
            if((value&0x70)!==0x20||rate===1||rate===2)throw new Error('MC146818 unsupported divider/rate');
            this.ram[r]=value&0x7f;
            return;
        }
        if(r===0x0b) {
            if(value&0x09)throw new Error('MC146818 DSE/square-wave modes are outside the bounded subset');
            this.ram[r]=value;
            this._publish();
            return;
        }
        this.ram[r]=value;
    }
    _raise(flag) { this.ram[0x0c]|=flag; }
    advance(n) {
        if(!Number.isFinite(n)||n<0)return;
        const elapsed=Math.floor((this.cyclePhase+n)/this.clockHz);
        if(!(this.ram[0x0b]&0x80)&&this.seconds+elapsed>8640000000)
            throw new Error('MC146818 deterministic time exceeds supported Date range');
        this.cyclePhase+=n;
        while(this.cyclePhase>=this.clockHz) {
            this.cyclePhase-=this.clockHz;
            if(!(this.ram[0x0b]&0x80)) {
                this.seconds++;
                this._raise(0x10);
                const match=[[1,0],[3,2],[5,4]].every(([a,t])=>(this.ram[a]&0xc0)===0xc0||
                    this.ram[a]===this._timeReg(t));
                if(match)this._raise(0x20);
            }
        }
        const rate=this.ram[0x0a]&15;
        const hz=rate>=3?32768>>(rate-1):0;
        if(hz) {
            this.periodicPhase+=n*hz;
            if(this.periodicPhase>=this.clockHz) {
                this.periodicPhase%=this.clockHz;
                this._raise(0x40);
            }
        }
        this._publish();
    }
    nextWake() {
        let n=this.clockHz-this.cyclePhase;
        const rate=this.ram[0x0a]&15,hz=rate>=3?32768>>(rate-1):0;
        if(hz&&(this.ram[0x0b]&0x40))n=Math.min(n,Math.ceil((this.clockHz-this.periodicPhase)/hz));
        return Math.max(1,n);
    }
    getState() {
        return {v:1,index:this.index,nmiMasked:this.nmiMasked,seconds:this.seconds,
            cyclePhase:this.cyclePhase,periodicPhase:this.periodicPhase,ram:Array.from(this.ram)};
    }
    validateState(s) {
        const rate=s?.ram?.[0x0a]&15;
        const irq=((s?.ram?.[0x0c]&0x40)&&(s?.ram?.[0x0b]&0x40))||
            ((s?.ram?.[0x0c]&0x20)&&(s?.ram?.[0x0b]&0x20))||
            ((s?.ram?.[0x0c]&0x10)&&(s?.ram?.[0x0b]&0x10));
        if(!s||s.v!==1||!Number.isInteger(s.index)||s.index<0||s.index>127||
            typeof s.nmiMasked!=='boolean'||!Number.isSafeInteger(s.seconds)||s.seconds<0||s.seconds>8640000000||
            !Number.isFinite(s.cyclePhase)||s.cyclePhase<0||s.cyclePhase>=this.clockHz||
            !Number.isFinite(s.periodicPhase)||s.periodicPhase<0||s.periodicPhase>=this.clockHz||
            !Array.isArray(s.ram)||s.ram.length!==128||s.ram.some(v=>!Number.isInteger(v)||v<0||v>255)||
            (s.ram[0x0a]&0xf0)!==0x20||rate===1||rate===2||(s.ram[0x0b]&0x09)||
            (s.ram[0x0c]&0x0f)||!!(s.ram[0x0c]&0x80)!==!!irq||s.ram[0x0d]!==0x80)
            throw new Error('MC146818 state is invalid');
    }
    setState(s) {
        this.validateState(s);
        this.index=s.index;
        this.nmiMasked=s.nmiMasked;
        this.seconds=s.seconds;
        this.cyclePhase=s.cyclePhase;
        this.periodicPhase=s.periodicPhase;
        this.ram.set(s.ram);
        this._irq=false;
        this._publish();
    }
}
