/**
 * Intel 8251A USART — the Intel-family serial chip, the sibling of the
 * MC6850 for an all-Intel breadboard. Our own model, from the Intel
 * datasheet, in the same shape as the MC6850: two registers selected by
 * C/D (the 8251's name for RS) — data at C/D=0, control/status at C/D=1.
 *
 * THE CONTROL PORT IS A SEQUENCE, NOT A REGISTER. This is the one thing
 * that trips code written for a 6850. The 8251 has no address bit to tell
 * a mode word from a command word: after a reset the FIRST write to the
 * control port is the MODE instruction (baud factor, character length,
 * parity, stop bits), and EVERY control write after that is a COMMAND
 * instruction (TxEN, RxEN, error-reset, and the internal-reset bit). A
 * command whose bit 6 is set (internal reset) returns the chip to
 * "expecting mode", and the next control write is a mode word again. A
 * model that treats the control port as one register desynchronises the
 * moment the program reconfigures the chip.
 *
 * SYNC MODE IS NOT MODELLED, deliberately and not silently. If the mode
 * word's low two bits are 00 the chip is in synchronous mode and one or
 * two SYNC-character writes follow the mode word before commands — a
 * fourth sub-state, plus hunt/SYNDET behaviour, that nothing in the
 * teaching corpus uses. A sync mode word is accepted, the sync chars are
 * consumed so the sequence stays aligned, and `modeWarning` says the data
 * path runs as async. Pretending to implement sync would be worse.
 *
 * TX is infinitely fast at instruction resolution, exactly as with the
 * MC6850: TxRDY and TxEMPTY read set whenever the transmitter is enabled,
 * so the 6850's polling idiom (spin on the ready bit, then write) works
 * unchanged. RxRDY is set when a received byte is waiting.
 *
 * ACCURACY TIER: THE PROTOCOL, NOT THE WIRE. The mode->command sequence and
 * its internal-reset rewind, the TxEN/RxEN gating, the RxRDY and overrun
 * status, and byte-level transmit and receive are all exact. What is NOT
 * here, named rather than left to be discovered:
 *
 *   - NO BIT TIMING. Transmit is instantaneous; the baud-rate factor and the
 *     character-length and stop-bit fields are stored but not enforced — a
 *     byte crosses in zero machine time regardless of the programmed rate.
 *   - NO PARITY OR FRAMING. The parity configuration is stored and never
 *     checked; parity and framing errors never arise on the clean model wire.
 *   - NO SYNC. A synchronous mode word is accepted and its sync characters
 *     consumed to keep the sequence aligned, but the data path runs as async
 *     (modeWarning says so).
 *
 * @module
 */

// Status register bits.
const ST_TXRDY = 0x01;
const ST_RXRDY = 0x02;
const ST_TXEMPTY = 0x04;
const ST_PE = 0x08;
const ST_OE = 0x10;
const ST_FE = 0x20;
const ST_SYNDET = 0x40;
const ST_DSR = 0x80;

// Command instruction bits.
const CMD_TXEN = 0x01;
const CMD_DTR = 0x02;
const CMD_RXEN = 0x04;
const CMD_SBRK = 0x08;
const CMD_ER = 0x10;   // error reset
const CMD_RTS = 0x20;
const CMD_IR = 0x40;   // internal reset -> expect a mode word next
const CMD_EH = 0x80;   // enter hunt mode (sync only)

export class I8251 {
    /** @param {{ onTx?: (byte:number)=>void, onIrqChange?: (a:boolean)=>void }} [hooks] */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.rx = [];
        this.rxRdy = false;
        this.overrun = false;
        this._rxByte = 0;

        this.mode = 0;
        this.command = 0;
        this.modeWarning = null;

        // Sequence state: after a reset the control port expects a mode word.
        this._expect = 'mode';       // 'mode' | 'sync1' | 'sync2' | 'command'
        this._sync = false;          // set true by a sync-mode mode word

        this._irq = false;
    }

    get txEnabled() { return !!(this.command & CMD_TXEN); }
    get rxEnabled() { return !!(this.command & CMD_RXEN); }

    _syncIrq() {
        // RxRDY drives the interrupt line on the 8251 (there is no mask bit
        // in the command word for it; the RxRDY pin is the interrupt source
        // a breadboard wires to the PIC). Enabled receiver + waiting byte.
        const asserted = this.rxEnabled && this.rxRdy;
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    /** Machine-side: a byte arrives on RX. */
    rxPush(byte) {
        if (this.rxRdy) { this.overrun = true; this.rx.push(byte & 0xff); }
        else { this._rxByte = byte & 0xff; this.rxRdy = true; }
        this._syncIrq();
    }

    /** @param {0|1} cd  C/D line: 0 = data, 1 = control/status */
    read(cd) {
        if (cd === 1) return this._status();
        // Data read: the received byte.
        const b = this._rxByte;
        this.rxRdy = this.rx.length > 0;
        if (this.rxRdy) this._rxByte = this.rx.shift();
        this.overrun = false;
        this._syncIrq();
        return b;
    }

    _status() {
        let s = 0;
        // Transmitter is infinitely fast: ready and empty whenever enabled.
        if (this.txEnabled) s |= ST_TXRDY | ST_TXEMPTY;
        else s |= ST_TXEMPTY;   // empty, but not "ready" to accept until enabled
        if (this.rxRdy) s |= ST_RXRDY;
        if (this.overrun) s |= ST_OE;
        // DSR reflects the command's DTR loopback on most breadboard wirings;
        // we report it clear (no modem). PE/FE never occur on the clean wire.
        return s;
    }

    /** @param {0|1} cd @param {number} v */
    write(cd, v) {
        v &= 0xff;
        if (cd === 0) { this._writeData(v); return; }
        this._writeControl(v);
    }

    _writeData(v) {
        // A write to the data port is a transmit. On real silicon it is
        // dropped if TxEN is clear; we honour that so a program that forgets
        // to enable the transmitter sees nothing on the wire, as on the bench.
        if (!this.txEnabled) return;
        if (this.hooks.onTx) this.hooks.onTx(v & 0xff);
    }

    _writeControl(v) {
        switch (this._expect) {
            case 'mode':
                this._applyMode(v);
                return;
            case 'sync1':
                // Consume the first sync character; move on.
                this._expect = this._sync2Needed ? 'sync2' : 'command';
                return;
            case 'sync2':
                this._expect = 'command';
                return;
            default:
                this._applyCommand(v);
        }
    }

    _applyMode(v) {
        this.mode = v;
        const baud = v & 0x03;
        if (baud === 0) {
            // Synchronous mode. Bit 7 selects single (1) vs double (0) sync
            // char; internal (0) vs external (1) sync on bit 6.
            this._sync = true;
            this._sync2Needed = !(v & 0x80);   // double sync char if bit7=0
            this._expect = 'sync1';
            this.modeWarning =
                `8251 mode ${v.toString(16)}h selects synchronous mode`
                + ' — sync/hunt is not modelled; the data path runs as async';
        } else {
            this._sync = false;
            this._expect = 'command';
            this.modeWarning = null;
        }
    }

    _applyCommand(v) {
        this.command = v;

        if (v & CMD_ER) {
            // Error reset clears PE / OE / FE.
            this.overrun = false;
        }
        if (v & CMD_IR) {
            // Internal reset: the next control write is a mode word again.
            // The command's other bits are ignored on an internal reset.
            const hooks = this.hooks;
            this.reset();
            this.hooks = hooks;
            return;
        }
        this._syncIrq();
    }

    get irqAsserted() { return this._irq; }

    saveState() {
        return {
            rx: this.rx.slice(),
            rxRdy: this.rxRdy,
            overrun: this.overrun,
            _rxByte: this._rxByte,
            mode: this.mode,
            command: this.command,
            _expect: this._expect,
            _sync: this._sync,
            _sync2Needed: this._sync2Needed,
            _irq: this._irq,
        };
    }

    loadState(s) {
        this.rx = s.rx.slice();
        this.rxRdy = s.rxRdy;
        this.overrun = s.overrun;
        this._rxByte = s._rxByte;
        this.mode = s.mode;
        this.command = s.command;
        this._expect = s._expect;
        this._sync = s._sync;
        this._sync2Needed = s._sync2Needed;
        this._irq = s._irq ?? false;
        this.modeWarning = null;
    }
}

export default I8251;
