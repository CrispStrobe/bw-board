/** Deterministic, cycle-driven MC146818 subset for the opt-in AT profile. */
export class MC146818 {
    constructor(clockHz,{initialUnixSeconds=0,initialCmos=[],onIRQ=null,onNmiMask=null}={}) {
        if(!Number.isInteger(clockHz)||clockHz<1)throw new Error('MC146818 clockHz must be positive');
        if(!Number.isSafeInteger(initialUnixSeconds)||initialUnixSeconds<0||initialUnixSeconds>8640000000)throw new Error('MC146818 initialUnixSeconds is outside the supported Date range');
        this.clockHz=clockHz;
        this.initialUnixSeconds=initialUnixSeconds;
        if(!Array.isArray(initialCmos)||initialCmos.some(entry=>!Array.isArray(entry)||entry.length!==2||
            !Number.isInteger(entry[0])||entry[0]<0x0e||entry[0]>0x3f||
            !Number.isInteger(entry[1])||entry[1]<0||entry[1]>255)||
            new Set(initialCmos.map(entry=>entry[0])).size!==initialCmos.length)
            throw new Error('MC146818 initialCmos must contain unique [0Eh..3Fh, byte] entries');
        this.initialCmos=initialCmos.map(entry=>[...entry]);
        this.onIRQ=onIRQ;
        this.onNmiMask=onNmiMask;
        this.reset();
    }
    reset() {
        this.index=0;
        this.nmiMasked=false;
        this.seconds=this.initialUnixSeconds;
        this.dayOfWeek=new Date(this.seconds*1000).getUTCDay()+1;
        this.setCalendar=null;
        this.pendingCalendar=null;
        this.cyclePhase=0;
        this.periodicPhase=0;
        this.ram=new Uint8Array(128);
        this.ram[0x0a]=0x26;
        this.ram[0x0b]=0x02;
        this.ram[0x0c]=0;
        this.ram[0x0d]=0x80;
        for(const [address,value] of this.initialCmos)this.ram[address]=value;
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
    _dec(value,max,name) {
        const n=(this.ram[0x0b]&4)?value:((value>>4)*10+(value&15));
        if((!(this.ram[0x0b]&4)&&((value&15)>9||(value>>4)>9))||n<0||n>max)
            throw new Error(`MC146818 invalid ${name}`);
        return n;
    }
    _calendar() {
        const d=new Date(this.seconds*1000);
        return {second:d.getUTCSeconds(),minute:d.getUTCMinutes(),hour:d.getUTCHours(),
            dayOfWeek:this.dayOfWeek,day:d.getUTCDate(),month:d.getUTCMonth()+1,
            year:d.getUTCFullYear()%100};
    }
    _commitCalendar(c) {
        const d=new Date(0);d.setUTCFullYear(2000+c.year,c.month-1,c.day);
        d.setUTCHours(c.hour,c.minute,c.second,0);
        if(d.getUTCFullYear()!==2000+c.year||d.getUTCMonth()!==c.month-1||d.getUTCDate()!==c.day)return false;
        this.seconds=Math.floor(d.getTime()/1000);this.dayOfWeek=c.dayOfWeek;
        return true;
    }
    _timeReg(r) {
        const d=new Date(this.seconds*1000);
        const c=this.setCalendar??this.pendingCalendar;
        let v=c?{0:c.second,2:c.minute,4:c.hour,6:c.dayOfWeek,7:c.day,8:c.month,9:c.year}[r]:
            {0:d.getUTCSeconds(),2:d.getUTCMinutes(),4:d.getUTCHours(),6:this.dayOfWeek,
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
        if([0,2,4,6,7,8,9].includes(r)) {
            const calendar=this.setCalendar??this.pendingCalendar??this._calendar();
            if(r===4) {
                const pm=!(this.ram[0x0b]&2)&&!!(value&0x80);
                let hour=this._dec(value&0x7f,(this.ram[0x0b]&2)?23:12,'hour');
                if(!(this.ram[0x0b]&2)) {
                    if(hour<1)throw new Error('MC146818 invalid hour');
                    hour=(hour%12)+(pm?12:0);
                }
                calendar.hour=hour;
            } else {
                const [field,max,name]={0:['second',59,'second'],2:['minute',59,'minute'],
                    6:['dayOfWeek',7,'day of week'],7:['day',31,'day'],8:['month',12,'month'],
                    9:['year',99,'year']}[r];
                const decoded=this._dec(value,max,name);
                if((r===6||r===7||r===8)&&decoded<1)throw new Error(`MC146818 invalid ${name}`);
                calendar[field]=decoded;
            }
            if(this.setCalendar)this.setCalendar=calendar;
            else if(this._commitCalendar(calendar))this.pendingCalendar=null;
            else this.pendingCalendar=calendar;
            return;
        }
        if(r===0x0c||r===0x0d)throw new Error('MC146818 read-only register write refused');
        if(r===0x0a) {
            const rate=value&15;
            if((value&0x70)!==0x20||rate===1||rate===2)throw new Error('MC146818 unsupported divider/rate');
            this.ram[r]=value&0x7f;
            return;
        }
        if(r===0x0b) {
            if(value&0x09)throw new Error('MC146818 DSE/square-wave modes are outside the bounded subset');
            const wasSet=!!(this.ram[r]&0x80),willSet=!!(value&0x80);
            if(!wasSet&&willSet) {
                this.setCalendar=this.pendingCalendar??this._calendar();this.pendingCalendar=null;
            }
            if(wasSet&&!willSet) {
                const c=this.setCalendar;
                if(!this._commitCalendar(c))
                    throw new Error('MC146818 invalid staged calendar date');
                this.setCalendar=null;
            }
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
                if(this.pendingCalendar) {
                    if(!this._commitCalendar(this.pendingCalendar))
                        throw new Error('MC146818 invalid live calendar at update boundary');
                    this.pendingCalendar=null;
                }
                if(this.seconds%86400===86399)this.dayOfWeek=this.dayOfWeek%7+1;
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
        return {v:2,index:this.index,nmiMasked:this.nmiMasked,seconds:this.seconds,
            dayOfWeek:this.dayOfWeek,setCalendar:this.setCalendar&&{...this.setCalendar},
            pendingCalendar:this.pendingCalendar&&{...this.pendingCalendar},
            cyclePhase:this.cyclePhase,periodicPhase:this.periodicPhase,ram:Array.from(this.ram)};
    }
    validateState(s) {
        const rate=s?.ram?.[0x0a]&15;
        const irq=((s?.ram?.[0x0c]&0x40)&&(s?.ram?.[0x0b]&0x40))||
            ((s?.ram?.[0x0c]&0x20)&&(s?.ram?.[0x0b]&0x20))||
            ((s?.ram?.[0x0c]&0x10)&&(s?.ram?.[0x0b]&0x10));
        const calendar=s?.setCalendar,pending=s?.pendingCalendar;
        if(!s||s.v!==2||!Number.isInteger(s.index)||s.index<0||s.index>127||
            typeof s.nmiMasked!=='boolean'||!Number.isSafeInteger(s.seconds)||s.seconds<0||s.seconds>8640000000||
            !Number.isInteger(s.dayOfWeek)||s.dayOfWeek<1||s.dayOfWeek>7||
            (!!(s.ram?.[0x0b]&0x80)!==!!calendar)||
            !(calendar===null||(calendar&&Object.values(calendar).every(Number.isInteger)&&
                calendar.second>=0&&calendar.second<=59&&calendar.minute>=0&&calendar.minute<=59&&
                calendar.hour>=0&&calendar.hour<=23&&calendar.dayOfWeek>=1&&calendar.dayOfWeek<=7&&
                calendar.day>=1&&calendar.day<=31&&calendar.month>=1&&calendar.month<=12&&
                calendar.year>=0&&calendar.year<=99))||
            !(pending===null||(pending&&Object.values(pending).every(Number.isInteger)&&
                pending.second>=0&&pending.second<=59&&pending.minute>=0&&pending.minute<=59&&
                pending.hour>=0&&pending.hour<=23&&pending.dayOfWeek>=1&&pending.dayOfWeek<=7&&
                pending.day>=1&&pending.day<=31&&pending.month>=1&&pending.month<=12&&
                pending.year>=0&&pending.year<=99))||
            (!!calendar&&!!pending)||
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
        this.dayOfWeek=s.dayOfWeek;
        this.setCalendar=s.setCalendar&&{...s.setCalendar};
        this.pendingCalendar=s.pendingCalendar&&{...s.pendingCalendar};
        this.cyclePhase=s.cyclePhase;
        this.periodicPhase=s.periodicPhase;
        this.ram.set(s.ram);
        this._irq=false;
        this._publish();
    }
}
