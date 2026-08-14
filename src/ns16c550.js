/**
 * NS16C550 UART — the industry-standard serial chip, our own model from
 * the National/TI 16550 datasheet. The KiT-class 6502 builds pick this
 * part over the W65C51 precisely because of the ACIA's TDRE silicon bug:
 * on a 16550, polling LSR bit 5 (THRE) is the CORRECT idiom, so that is
 * the behavior the model must get right.
 *
 * Eight registers (A0-A2), with LCR bit 7 (DLAB) banking registers 0-1:
 *   0 RBR read / THR write        (DLAB=1: DLL divisor low)
 *   1 IER                          (DLAB=1: DLM divisor high)
 *   2 IIR read / FCR write
 *   3 LCR   4 MCR   5 LSR   6 MSR   7 SCR
 *
 * Modeled: divisor latch and the baud it implies (baud = clock/16/divisor
 * — a 1 MHz system clock with divisor 13 gives the KiT's ~4800), 16-deep
 * RX FIFO with trigger levels, overrun latching, LSR/IIR semantics
 * including the interrupt priority order (line status > RX data > THRE >
 * modem) and the datasheet subtlety that enabling ETBEI while THR is
 * already empty raises the THRE interrupt immediately. MCR loopback wraps
 * THR into the RX path with SOUT disconnected.
 *
 * Deliberately unmodeled, stated: TX is instantaneous (THRE/TEMT never
 * drop — firmware that polls THRE behaves identically, like the W65C51
 * model's same superset), character-timeout interrupts (needs char-time
 * bookkeeping no firmware of ours relies on), parity/framing/break
 * generation, and the modem lines beyond reading MSR as "ready".
 *
 * @module
 */

const TRIGGER = [1, 4, 8, 14];

export class NS16C550 {
    /**
     * @param {{ onTx?: (byte: number) => void,
     *           onIrqChange?: (asserted: boolean) => void,
     *           clockHz?: number }} [hooks] clockHz is the UART input clock
     *           (XIN), 1.8432 MHz canonical; the KiT drives it at 1 MHz.
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.clockHz = hooks.clockHz || 1_843_200;
        this.reset();
    }

    reset() {
        /** @type {number[]} */
        this.rxFifo = [];
        this.divisor = 0;      // 0 = baud generator idle until programmed
        this.ier = 0;
        this.lcr = 0;
        this.mcr = 0;
        this.fcr = 0;
        this.scr = 0;
        this.overrun = false;
        this._thrEvent = false; // a pending THR-empty interrupt condition
        this._irq = false;
    }

    get _dlab() { return (this.lcr & 0x80) !== 0; }
    get _fifoEnabled() { return (this.fcr & 0x01) !== 0; }
    get _rxTrigger() { return this._fifoEnabled ? TRIGGER[(this.fcr >> 6) & 0x03] : 1; }
    get _loop() { return (this.mcr & 0x10) !== 0; }

    /** baud = clock / (16 × divisor); 0 until the divisor is programmed. */
    get baud() { return this.divisor ? this.clockHz / (16 * this.divisor) : 0; }

    /** Highest-priority pending interrupt, or null. Order per datasheet. */
    _pending() {
        if ((this.ier & 0x04) && this.overrun) return 'rls';
        if ((this.ier & 0x01) && this.rxFifo.length >= this._rxTrigger) return 'rx';
        if ((this.ier & 0x02) && this._thrEvent) return 'thre';
        return null;
    }

    _syncIrq() {
        const asserted = this._pending() !== null;
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    get irqAsserted() { return this._irq; }

    /**
     * Machine-side: a byte arrives on SIN. The two overrun behaviors are
     * DIFFERENT per the datasheet and both matter to firmware: in 16450
     * mode the new byte OVERWRITES the unread RBR (OE = "was overwritten");
     * in FIFO mode the FIFO contents are preserved and the newcomer is
     * lost once the shift register is also occupied.
     */
    rxPush(byte) {
        if (this._fifoEnabled) {
            if (this.rxFifo.length >= 16) this.overrun = true;
            else this.rxFifo.push(byte & 0xff);
        } else if (this.rxFifo.length) {
            this.rxFifo[0] = byte & 0xff;
            this.overrun = true;
        } else {
            this.rxFifo.push(byte & 0xff);
        }
        this._syncIrq();
    }

    /** @param {number} reg 0-7 */
    read(reg) {
        switch (reg & 0x07) {
            case 0: {
                if (this._dlab) return this.divisor & 0xff;
                const b = this.rxFifo.length ? this.rxFifo.shift() : 0;
                this._syncIrq();
                return b;
            }
            case 1: return this._dlab ? (this.divisor >> 8) & 0xff : this.ier;
            case 2: {
                const p = this._pending();
                const fifoBits = this._fifoEnabled ? 0xc0 : 0;
                if (p === null) return fifoBits | 0x01;      // no interrupt pending
                if (p === 'rls') return fifoBits | 0x06;
                if (p === 'rx') return fifoBits | 0x04;
                // Reading IIR with THRE as the reported source clears it.
                this._thrEvent = false;
                this._syncIrq();
                return fifoBits | 0x02;
            }
            case 3: return this.lcr;
            case 4: return this.mcr;
            case 5: {
                // bit0 DR, bit1 OE, bit5 THRE, bit6 TEMT; no parity/framing/
                // break sources exist in the model, so those bits stay 0.
                const s = (this.rxFifo.length ? 0x01 : 0) | (this.overrun ? 0x02 : 0)
                    | 0x20 | 0x40;
                this.overrun = false;                        // reading LSR clears OE
                this._syncIrq();
                return s;
            }
            case 6:
                // CTS+DSR+DCD present (ready); in loopback they mirror MCR
                // per datasheet (DTR→DSR, RTS→CTS, OUT1→RI, OUT2→DCD).
                if (this._loop) {
                    return ((this.mcr & 0x01) ? 0x20 : 0) | ((this.mcr & 0x02) ? 0x10 : 0)
                        | ((this.mcr & 0x04) ? 0x40 : 0) | ((this.mcr & 0x08) ? 0x80 : 0);
                }
                return 0xb0;
            default: return this.scr;
        }
    }

    /** @param {number} reg 0-7 @param {number} val */
    write(reg, val) {
        val &= 0xff;
        switch (reg & 0x07) {
            case 0:
                if (this._dlab) { this.divisor = (this.divisor & 0xff00) | val; break; }
                if (this._loop) this.rxPush(val);            // SOUT disconnected
                else if (this.hooks.onTx) this.hooks.onTx(val);
                // TX is instantaneous: THR is empty again, so with ETBEI on
                // the THRE interrupt re-arms for the next byte.
                this._thrEvent = true;
                this._syncIrq();
                break;
            case 1:
                if (this._dlab) { this.divisor = (this.divisor & 0x00ff) | (val << 8); break; }
                {
                    const enablingThre = (val & 0x02) && !(this.ier & 0x02);
                    this.ier = val & 0x0f;
                    // Datasheet: setting ETBEI while THRE is set interrupts
                    // immediately — and THRE is always set in this model.
                    if (enablingThre) this._thrEvent = true;
                    this._syncIrq();
                }
                break;
            case 2:
                this.fcr = val;
                if (val & 0x02) { this.rxFifo = []; this._syncIrq(); }   // clear RX FIFO
                // bit 2 clears the TX FIFO — instantaneous TX means it is
                // always already empty.
                break;
            case 3: this.lcr = val; break;
            case 4: this.mcr = val & 0x1f; break;
            case 5: break;                                   // LSR is read-only
            case 6: break;                                   // MSR is read-only
            default: this.scr = val; break;
        }
    }
}

export default NS16C550;
