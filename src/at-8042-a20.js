/**
 * Deliberately bounded IBM AT 8042 system-control subset.
 *
 * This is not a keyboard emulator. It implements only the two original-AT
 * commands needed to observe and change output-port bit 1 (gate A20): D0 and
 * D1. Unsupported commands throw instead of pretending that a keyboard/reset
 * operation completed.
 */
export class AT8042A20 {
    constructor({a20Enabled = false, onA20Change = null} = {}) {
        this.initialA20Enabled=!!a20Enabled;
        this.onA20Change=onA20Change;
        this.reset();
    }

    reset() {
        this.outputPort=0x01 | (this.initialA20Enabled ? 0x02 : 0x00);
        this.pendingCommand=null;
        this.outputBuffer=null;
        if (this.onA20Change) this.onA20Change(!!(this.outputPort&2));
    }

    setA20Enabled(enabled) {
        this.outputPort=(this.outputPort&~2)|(enabled?2:0);
        if (this.onA20Change) this.onA20Change(!!enabled);
    }

    readStatus() {
        // Bit 0: output buffer full. Input writes are consumed synchronously,
        // so bit 1 (input buffer full) stays clear even while D1 awaits data.
        return this.outputBuffer === null ? 0 : 1;
    }

    readData() {
        if (this.outputBuffer === null) return 0xff;
        const value=this.outputBuffer; this.outputBuffer=null; return value;
    }

    writeCommand(value) {
        value&=0xff;
        if (value === 0xd0) {
            if (this.outputBuffer !== null) throw new Error('AT 8042 D0 refused: output buffer is full');
            this.pendingCommand=null; this.outputBuffer=this.outputPort; return;
        }
        if (value === 0xd1) { this.pendingCommand=0xd1; return; }
        throw new Error(`AT 8042 command ${value.toString(16).padStart(2,'0')}h is outside the bounded A20 subset`);
    }

    writeData(value) {
        if (this.pendingCommand !== 0xd1)
            throw new Error('AT 8042 data write refused: no D1 output-port command is pending');
        value&=0xff;
        if (!(value&1)) throw new Error('AT 8042 output-port write refused: bit 0 low requests unsupported CPU reset');
        this.pendingCommand=null; this.outputPort=value;
        if (this.onA20Change) this.onA20Change(!!(this.outputPort&2));
    }

    getState() {
        return {v:1,outputPort:this.outputPort,pendingCommand:this.pendingCommand,outputBuffer:this.outputBuffer};
    }

    validateState(state) {
        if (!state || state.v !== 1 || !Number.isInteger(state.outputPort) || state.outputPort < 0 || state.outputPort > 255 || !(state.outputPort&1) ||
            ![null,0xd1].includes(state.pendingCommand) ||
            !(state.outputBuffer === null || Number.isInteger(state.outputBuffer) && state.outputBuffer >= 0 && state.outputBuffer <= 255))
            throw new Error('AT 8042 state is invalid');
    }

    setState(state) {
        this.validateState(state);
        this.outputPort=state.outputPort; this.pendingCommand=state.pendingCommand; this.outputBuffer=state.outputBuffer;
        if (this.onA20Change) this.onA20Change(!!(this.outputPort&2));
    }
}
