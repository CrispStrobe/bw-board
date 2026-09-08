/**
 * W65C51 ACIA — the retro tier's serial chip, our own model.
 *
 * Four registers (RS0-RS1): 0 data, 1 status (write = programmed reset),
 * 2 command, 3 control. TX bytes go to the onTx hook immediately with the
 * transmit-data-register-empty bit modeled per the DATASHEET (bit 4 sets
 * when the byte is taken). NOTE the real current WDC silicon has the
 * infamous TDRE bug (bit 4 stuck high, firmware must pace TX with delay
 * loops instead of polling) — firmware written the delay-loop way runs
 * identically here; firmware that polls bit 4 runs here but would ALSO run
 * on the pre-bug parts. Our generated C uses delay pacing so it is correct
 * on both, and that choice is documented where the C is emitted.
 *
 * RX: the machine queues bytes with rxPush(); bit 3 (RDRF) tracks the
 * queue, overrun (status bit 2) sets if a byte arrives while one is
 * unread. IRQ (status bit 7) on RX per command bit 1, on TX per command
 * bits 2-3 — the machine polls irqAsserted like the VIA's.
 *
 * @module
 */

export class W65C51 {
    /** @param {{ onTx?: (byte: number) => void, onIrqChange?: (asserted: boolean) => void }} [hooks] */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset(true);
    }

    /** @param {boolean} [hard] hardware reset clears everything; programmed reset keeps control */
    reset(hard = false) {
        this.rx = [];
        this.rdrf = false; this.overrun = false;
        this.cmd = 0;
        if (hard) this.ctrl = 0;
        this._irq = false;
        this._rxByte = 0;
    }

    /**
     * Snapshot the whole programmer-visible state, in the shape the machine
     * layer's saveState() takes (`getState`/`setState`, as NS16C550 and I8255
     * do). Written 2026-09-04 on the OWNER'S EXPLICIT INSTRUCTION to close all
     * gaps -- the boundary was crossed deliberately, not forgotten.
     *
     * Until now this chip had NEITHER method, and `M6502Machine.saveState()`
     * walks its chip map taking whichever of the two exists and SKIPS, without
     * comment, any chip that has neither. So every snapshot of the 6502
     * machine silently lost its serial state: the receive queue, the latched
     * byte, RDRF, overrun, the command and control registers and the interrupt
     * line. Its neighbour W65C22 has had saveState all along, which is why
     * this read as a decision about serial rather than as one chip missed.
     *
     * Found by `test/machine-contract.test.mjs`, which asserts that every chip
     * on a machine either round-trips or is NAMED as one that cannot. It
     * cannot be found by a lockstep test: the CPU has to touch the chip for
     * its state to reach a trace, and nothing in a default config does.
     *
     * `rx` is copied rather than shared, or a restored machine would hand
     * bytes back to the snapshot it came from.
     */
    getState() {
        return {
            rx: this.rx.slice(), rxByte: this._rxByte,
            rdrf: this.rdrf, overrun: this.overrun,
            cmd: this.cmd, ctrl: this.ctrl, irq: !!this._irq,
        };
    }

    /** Restore a getState() snapshot. The IRQ line is restored as a VALUE and
     *  not re-derived: _syncIrq() would recompute it from cmd and rdrf, which
     *  is right at every other moment and wrong here, because a status read
     *  clears the line without changing either of them. Re-deriving would
     *  resurrect an interrupt the program had already acknowledged. */
    setState(s) {
        this.rx = (s.rx || []).slice();
        this._rxByte = s.rxByte ?? 0;
        this.rdrf = !!s.rdrf; this.overrun = !!s.overrun;
        this.cmd = s.cmd ?? 0; this.ctrl = s.ctrl ?? 0;
        this._irq = !!s.irq;
    }

    _syncIrq() {
        // DTR must be active (cmd bit 0) for the receiver/transmitter to run.
        const rxIrqEnabled = (this.cmd & 0x01) && !(this.cmd & 0x02);
        const txIrqEnabled = (this.cmd & 0x01) && (this.cmd & 0x0c) === 0x04;
        const asserted = (rxIrqEnabled && this.rdrf) || txIrqEnabled; // TDRE always empty here
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    /**
     * Machine-side: a byte arrives on RxD. The real chip has a single data
     * register and loses bytes on overrun; we queue instead (a superset —
     * firmware that honors RDRF behaves identically), but the overrun
     * status bit still latches so firmware that checks it sees the truth.
     */
    rxPush(byte) {
        if (this.rdrf) {
            this.overrun = true;
            this.rx.push(byte & 0xff);
        } else {
            this._rxByte = byte & 0xff;
            this.rdrf = true;
        }
        this._syncIrq();
    }

    /** @param {number} reg 0-3 */
    read(reg) {
        switch (reg & 0x03) {
            case 0: {
                const b = this._rxByte;
                this.rdrf = this.rx.length > 0;
                if (this.rdrf) this._rxByte = this.rx.shift();
                this.overrun = false;
                this._syncIrq();
                return b;
            }
            case 1: {
                // bit7 IRQ, bit4 TDRE (always empty — see header), bit3 RDRF,
                // bit2 overrun; DCD/DSR low (ready).
                const s = (this._irq ? 0x80 : 0) | 0x10 | (this.rdrf ? 0x08 : 0)
                    | (this.overrun ? 0x04 : 0);
                if (this._irq) { this._irq = false; this._syncIrq(); } // reading status clears IRQ
                return s;
            }
            case 2: return this.cmd;
            default: return this.ctrl;
        }
    }

    /** @param {number} reg 0-3 @param {number} val */
    write(reg, val) {
        val &= 0xff;
        switch (reg & 0x03) {
            case 0:
                if (this.hooks.onTx) this.hooks.onTx(val);
                this._syncIrq();
                break;
            case 1: this.reset(false); break; // programmed reset
            case 2: this.cmd = val; this._syncIrq(); break;
            default: this.ctrl = val; break;
        }
    }

    /** Baud rate selected by control bits 0-3 (0 = external/16x, modeled as 115200). */
    get baud() {
        const table = [115200, 50, 75, 110, 135, 150, 300, 600, 1200,
            1800, 2400, 3600, 4800, 7200, 9600, 19200];
        return table[this.ctrl & 0x0f];
    }

    get irqAsserted() { return this._irq; }
}

export default W65C51;
