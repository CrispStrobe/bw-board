/** Bounded, cycle-driven IBM AT 8042 keyboard/system-control model. */
export class AT8042A20 {
    constructor({a20Enabled=false,onA20Change=null,onIRQ=null,onResetRequest=null,allowReset=false,
        queueLimit=16,inputBusyCycles=0,responseDelayCycles=0,inputPort=0xb0,
        powerOnKeyboardBatCycles=null,keyboardAckCycles=null,keyboardBatCycles=null,
        keyboardUnlocked=false}={}) {
        if (!Number.isInteger(queueLimit)||queueLimit<1||queueLimit>256) throw new Error('AT 8042 queueLimit must be 1..256');
        this.initialA20Enabled=!!a20Enabled;
        this.onA20Change=onA20Change;
        this.onIRQ=onIRQ;
        this.onResetRequest=onResetRequest;
        this.allowReset=!!allowReset;
        this.queueLimit=queueLimit;
        if(!Number.isInteger(responseDelayCycles)||responseDelayCycles<0||responseDelayCycles>1_000_000)
            throw new Error('AT 8042 responseDelayCycles must be 0..1000000');
        this.responseDelayCycles=responseDelayCycles;
        if(!Number.isInteger(inputBusyCycles)||inputBusyCycles<0||inputBusyCycles>responseDelayCycles)
            throw new Error('AT 8042 inputBusyCycles must be 0..responseDelayCycles');
        this.inputBusyCycles=inputBusyCycles;
        if(!Number.isInteger(inputPort)||inputPort<0||inputPort>255)throw new Error('AT 8042 inputPort must be a byte');
        this.inputPort=inputPort;
        for(const [name,value] of Object.entries({powerOnKeyboardBatCycles,keyboardAckCycles,keyboardBatCycles}))
            if(value!==null&&(!Number.isInteger(value)||value<1||value>100_000_000))
                throw new Error(`AT 8042 ${name} must be null or 1..100000000 cycles`);
        this.powerOnKeyboardBatCycles=powerOnKeyboardBatCycles;
        this.keyboardAckCycles=keyboardAckCycles;
        this.keyboardBatCycles=keyboardBatCycles;
        this.keyboardUnlocked=!!keyboardUnlocked;
        if((keyboardAckCycles===null)!==(keyboardBatCycles===null))
            throw new Error('AT 8042 keyboard ACK and BAT timings must be configured together');
        if(keyboardAckCycles!==null&&keyboardAckCycles>=keyboardBatCycles)
            throw new Error('AT 8042 keyboard ACK deadline must precede BAT deadline');
        this.reset();
    }
    reset() {
        this.outputPort=1|(this.initialA20Enabled?2:0);
        this.commandByte=0;
        this.pendingCommand=null;
        this.outputQueue=[];
        this.responseCyclesRemaining=0;
        this.inputBusyCyclesRemaining=0;
        this.delayedResponse=null;
        this.systemFlag=false;
        this.keyboardSchedule=this.powerOnKeyboardBatCycles===null?[]:
            [{remaining:this.powerOnKeyboardBatCycles,value:0xaa}];
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
    _respond(value) {
        if(!this.responseDelayCycles){this._queue(value);return;}
        if(this.delayedResponse)throw new Error('AT 8042 response refused: another response is pending');
        this.responseCyclesRemaining=this.responseDelayCycles;
        this.inputBusyCyclesRemaining=this.inputBusyCycles;
        this.delayedResponse={value:value&255};
    }
    _releaseKeyboardSchedule() {
        if(this.commandByte&0x10)return;
        while(this.keyboardSchedule[0]?.remaining<=0) {
            const event=this.keyboardSchedule.shift();
            this._queue(event.value,true);
            if(event.afterRelease!==undefined)
                this.keyboardSchedule.push({remaining:event.afterRelease,value:0xaa});
        }
    }
    setA20Enabled(enabled) { this.outputPort=(this.outputPort&~2)|(enabled?2:0); this._publish(); }
    readStatus() {
        return (this.outputQueue.length?1:0)|(this.inputBusyCyclesRemaining>0?2:0)|
            (this.systemFlag?4:0)|(this.keyboardUnlocked?0x10:0);
    }
    advance(cycles) {
        if(!Number.isFinite(cycles)||cycles<=0)return;
        let remaining=cycles;
        while(remaining>0) {
            const controllerDeadline=this.delayedResponse
                ? (this.inputBusyCyclesRemaining>0
                    ? Math.min(this.inputBusyCyclesRemaining,this.responseCyclesRemaining)
                    : this.responseCyclesRemaining)
                : Infinity;
            const keyboardDeadline=(this.commandByte&0x10)
                ? Infinity:(this.keyboardSchedule[0]?.remaining??Infinity);
            const delta=Math.min(remaining,controllerDeadline,keyboardDeadline);
            if(this.delayedResponse) {
                this.responseCyclesRemaining-=delta;
                this.inputBusyCyclesRemaining=Math.max(0,this.inputBusyCyclesRemaining-delta);
            }
            if(this.keyboardSchedule.length)
                this.keyboardSchedule[0].remaining=Math.max(0,this.keyboardSchedule[0].remaining-delta);
            remaining-=delta;
            if(this.delayedResponse&&this.responseCyclesRemaining<=0) {
                const value=this.delayedResponse.value;
                this.delayedResponse=null;this.responseCyclesRemaining=0;this.inputBusyCyclesRemaining=0;
                this._queue(value);
            }
            this._releaseKeyboardSchedule();
            if(delta===0&&controllerDeadline===Infinity&&keyboardDeadline===Infinity)break;
        }
    }
    nextWake() {
        const controller=!this.delayedResponse?Infinity:(this.inputBusyCyclesRemaining>0
            ? Math.min(this.inputBusyCyclesRemaining,this.responseCyclesRemaining)
            : this.responseCyclesRemaining);
        const keyboard=(this.commandByte&0x10)?Infinity:(this.keyboardSchedule[0]?.remaining??Infinity);
        return Math.min(controller,keyboard);
    }
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
        if(value===0x20){this._respond(this.commandByte);this.pendingCommand=null;return;}
        if(value===0x60){this.pendingCommand=0x60;return;}
        if(value===0xad){this.commandByte|=0x10;this._publish();return;}
        if(value===0xae){this.commandByte&=~0x10;this._releaseKeyboardSchedule();this._publish();return;}
        if(value===0xaa){this._respond(0x55);this.pendingCommand=null;return;}
        if(value===0xab){this._respond(0x00);this.pendingCommand=null;return;}
        if(value===0xc0){this._respond(this.inputPort);this.pendingCommand=null;return;}
        if(value===0xd0){if(this.outputQueue.length)throw new Error('AT 8042 D0 refused: output buffer is full');this.pendingCommand=null;this._respond(this.outputPort);return;}
        if(value===0xd1){this.pendingCommand=0xd1;return;}
        if(value===0xe0){this._respond((this.commandByte&0x10)?2:3);this.pendingCommand=null;return;}
        if(value===0xfe){
            if(!this.allowReset)throw new Error('AT 8042 command feh is outside the bounded A20 subset unless CPU reset is enabled');
            this.pendingCommand=null;
            this.onResetRequest?.();
            return;
        }
        throw new Error(`AT 8042 command ${value.toString(16).padStart(2,'0')}h is outside the bounded A20 subset and keyboard extension`);
    }
    writeData(value) {
        value&=255;
        if(this.pendingCommand===0x60){
            this.pendingCommand=null;this.commandByte=value;this.systemFlag=!!(value&4);
            this._releaseKeyboardSchedule();this._publish();return;
        }
        if(this.pendingCommand===null&&value===0xff&&this.keyboardAckCycles!==null) {
            this.keyboardSchedule=[{remaining:this.keyboardAckCycles,value:0xfa,
                afterRelease:this.keyboardBatCycles}];
            return;
        }
        if(this.pendingCommand!==0xd1)throw new Error('AT 8042 data write refused: no D1 output-port command, 60h command-byte command, or configured keyboard reset is pending');
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
        return {v:5,outputPort:this.outputPort,commandByte:this.commandByte,
            pendingCommand:this.pendingCommand,outputQueue:this.outputQueue.map(e=>({...e})),
            responseCyclesRemaining:this.responseCyclesRemaining,inputBusyCyclesRemaining:this.inputBusyCyclesRemaining,
            delayedResponse:this.delayedResponse&&{...this.delayedResponse},
            keyboardSchedule:this.keyboardSchedule.map(event=>({...event})),
            systemFlag:this.systemFlag};
    }
    validateState(s) {
        if(!s||s.v!==5||!Number.isInteger(s.outputPort)||s.outputPort<0||s.outputPort>255||!(s.outputPort&1)||
            !Number.isInteger(s.commandByte)||s.commandByte<0||s.commandByte>255||
            ![null,0x60,0xd1].includes(s.pendingCommand)||!Array.isArray(s.outputQueue)||
            s.outputQueue.length>this.queueLimit||s.outputQueue.some(e=>!e||!Number.isInteger(e.value)||
                e.value<0||e.value>255||typeof e.keyboard!=='boolean')||
            !Number.isFinite(s.responseCyclesRemaining)||s.responseCyclesRemaining<0||
            s.responseCyclesRemaining>this.responseDelayCycles||
            !Number.isFinite(s.inputBusyCyclesRemaining)||s.inputBusyCyclesRemaining<0||
            s.inputBusyCyclesRemaining>this.inputBusyCycles||
            !(s.delayedResponse===null||(s.delayedResponse&&Number.isInteger(s.delayedResponse.value)&&
                s.delayedResponse.value>=0&&s.delayedResponse.value<=255))||
            (!!s.delayedResponse)!==(s.responseCyclesRemaining>0)||
            !Array.isArray(s.keyboardSchedule)||s.keyboardSchedule.length>2||s.keyboardSchedule.some((event,index)=>!event||
                !Number.isFinite(event.remaining)||event.remaining<0||event.remaining>100_000_000||
                (index>0&&event.remaining<s.keyboardSchedule[index-1].remaining)||
                !Number.isInteger(event.value)||![0xaa,0xfa].includes(event.value)||
                !(event.afterRelease===undefined||(event.value===0xfa&&Number.isInteger(event.afterRelease)&&
                    event.afterRelease>0&&event.afterRelease<=100_000_000)))||
            (this.keyboardAckCycles===null&&this.powerOnKeyboardBatCycles===null&&s.keyboardSchedule.length>0)||
            typeof s.systemFlag!=='boolean')throw new Error('AT 8042 state is invalid');
    }
    setState(s) {
        this.validateState(s);
        this.outputPort=s.outputPort;
        this.commandByte=s.commandByte;
        this.pendingCommand=s.pendingCommand;
        this.outputQueue=s.outputQueue.map(e=>({...e}));
        this.responseCyclesRemaining=s.responseCyclesRemaining;
        this.inputBusyCyclesRemaining=s.inputBusyCyclesRemaining;
        this.delayedResponse=s.delayedResponse&&{...s.delayedResponse};
        this.keyboardSchedule=s.keyboardSchedule.map(event=>({...event}));
        this.systemFlag=s.systemFlag;
        this._irq=undefined;
        this._releaseKeyboardSchedule();
        this._publish();
    }
}
