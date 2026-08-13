/**
 * MC6850 ACIA — the Z80 breadboard scene's serial chip (Grant Searle's
 * minimal design, RC2014 and their descendants all speak it). Our own
 * model, from the Motorola datasheet: two registers selected by RS —
 * control (write) / status (read) at RS=0, TX / RX data at RS=1.
 *
 * Status: bit0 RDRF, bit1 TDRE (always set here — the emulated wire is
 * infinitely fast; the pacing caveats of the 6551 world do not apply to
 * the 6850's polling idiom), bit7 IRQ. Control: bits 5-6 TX interrupt
 * modes (unused here), bit7 RX interrupt enable; the divide/format bits
 * are stored but do not change behavior at instruction resolution.
 * Master reset (control = 0x03) clears the receiver.
 *
 * @module
 */

export class MC6850 {
    /** @param {{ onTx?: (byte:number)=>void, onIrqChange?: (a:boolean)=>void }} [hooks] */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.rx = [];
        this.rdrf = false;
        this.overrun = false;
        this.control = 0;
        this._rxByte = 0;
        this._irq = false;
    }

    _syncIrq() {
        const asserted = !!(this.control & 0x80) && this.rdrf;
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    /** Machine-side: a byte arrives on RX. */
    rxPush(byte) {
        if (this.rdrf) { this.overrun = true; this.rx.push(byte & 0xff); }
        else { this._rxByte = byte & 0xff; this.rdrf = true; }
        this._syncIrq();
    }

    /** @param {0|1} rs */
    read(rs) {
        if (rs === 0) {
            return (this.rdrf ? 0x01 : 0) | 0x02 /* TDRE */
                | (this.overrun ? 0x20 : 0) | (this._irq ? 0x80 : 0);
        }
        const b = this._rxByte;
        this.rdrf = this.rx.length > 0;
        if (this.rdrf) this._rxByte = this.rx.shift();
        this.overrun = false;
        this._syncIrq();
        return b;
    }

    /** @param {0|1} rs @param {number} v */
    write(rs, v) {
        if (rs === 0) {
            this.control = v & 0xff;
            if ((v & 0x03) === 0x03) this.reset();   // master reset
            this._syncIrq();
            return;
        }
        if (this.hooks.onTx) this.hooks.onTx(v & 0xff);
    }

    get irqAsserted() { return this._irq; }
}

export default MC6850;
