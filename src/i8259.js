/**
 * Intel 8259A PIC — the interrupt controller that sits between the
 * peripherals and the 8086's INTR line, clean-room from the datasheet
 * in the same shape as the 8255 and 8254.
 *
 * TWO ADDRESSES: A0=0 is the command port, A0=1 is the data port.
 * The difference between a command and data write at A0=0 is the
 * bit pattern: bit 4 high starts an ICW sequence, bit 3 is OCW3,
 * otherwise OCW2.
 *
 * INITIALIZATION: writing ICW1 (bit 4 set) to port A0=0 starts a
 * fixed sequence. ICW2 (vector base) comes next at A0=1. ICW3
 * (cascade) follows if ICW1.SNGL=0. ICW4 (mode) follows if
 * ICW1.IC4=1. After initialization, the chip is in "operation mode."
 *
 * OPERATION: the three OCW commands configure masking (OCW1 at A0=1),
 * EOI and rotation (OCW2 at A0=0), and poll/read-register (OCW3 at
 * A0=0). The mask register (IMR) lives at A0=1 in operation mode.
 *
 * PRIORITY RESOLUTION: IRQ 0 has the highest default priority. When
 * an interrupt is acknowledged, the corresponding ISR bit is set and
 * lower-priority interrupts are blocked until EOI clears it. The
 * fixed-priority model is the only one modelled.
 *
 * @module
 */

export class I8259 {
    /**
     * @param {{ onInterrupt?: (active: boolean) => void }} [hooks]
     *   Called when INT output changes state.
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.irr = 0;       // interrupt request register
        this.isr = 0;       // in-service register
        this.imr = 0;       // interrupt mask register
        this.vectorBase = 0; // ICW2: upper 5 bits of the vector number
        this.icw4 = 0;      // ICW4 value
        this.autoEOI = false;
        this.readISR = false; // false=read IRR, true=read ISR on A0=0 reads

        this._initPhase = 0; // 0=operational, 1=waiting ICW2, 2=ICW3, 3=ICW4
        this._needICW3 = false;
        this._needICW4 = false;

        // A non-null string while the chip is mid-initialisation, in the
        // house `modeWarning` shape (see 8255/8251). A correct 8259 waiting
        // for an init word it will never receive is SILENT — it just never
        // interrupts — so the diagnostic is the whole point: a learner who
        // wrote ICW1 as 11h (cascade) but sent no ICW3 can see why nothing
        // fires. The machine layer can surface this string.
        this.initWarning = null;

        this._intActive = false;
    }

    /** @param {number} reg A0 line: 0 or 1 */
    read(reg) {
        if (reg & 1) return this.imr;
        return this.readISR ? this.isr : this.irr;
    }

    /** @param {number} reg A0 line: 0 or 1 */
    write(reg, val) {
        val &= 0xff;
        if (reg & 1) {
            this._writeData(val);
        } else {
            this._writeCommand(val);
        }
    }

    _writeCommand(val) {
        if (val & 0x10) {
            // ICW1: bit 4 set
            this._startInit(val);
            return;
        }
        if (this._initPhase) return;

        if (val & 0x08) {
            // OCW3: bit 3 set
            if (val & 0x02) {
                this.readISR = !!(val & 0x01);
            }
            // Poll mode (bit 2) not modelled
            return;
        }

        // OCW2: EOI commands
        this._ocw2(val);
    }

    _writeData(val) {
        if (this._initPhase === 1) {
            // ICW2: vector base (upper 5 bits)
            this.vectorBase = val & 0xf8;
            this._setInitPhase(this._needICW3 ? 2 : (this._needICW4 ? 3 : 0));
            return;
        }
        if (this._initPhase === 2) {
            // ICW3: cascade config (ignored in single mode but consumed)
            this._setInitPhase(this._needICW4 ? 3 : 0);
            return;
        }
        if (this._initPhase === 3) {
            // ICW4: mode
            this.icw4 = val;
            this.autoEOI = !!(val & 0x02);
            this._setInitPhase(0);
            return;
        }
        // OCW1: interrupt mask
        this.imr = val;
        this._updateInt();
    }

    _startInit(icw1) {
        this.imr = 0;
        this.isr = 0;
        this.irr = 0;
        this.readISR = false;
        this.autoEOI = false;
        this._needICW3 = !(icw1 & 0x02);  // SNGL bit: 1 = single, no ICW3
        this._needICW4 = !!(icw1 & 0x01); // IC4 bit
        this._setInitPhase(1);             // expect ICW2 next
        this._updateInt();
    }

    _ocw2(val) {
        const cmd = (val >> 5) & 7;
        const level = val & 7;

        if (cmd === 1 || cmd === 3) {
            // Non-specific EOI (cmd=1) or specific EOI (cmd=3)
            if (cmd === 1) {
                // Clear the highest-priority in-service bit
                for (let i = 0; i < 8; i++) {
                    if (this.isr & (1 << i)) {
                        this.isr &= ~(1 << i);
                        break;
                    }
                }
            } else {
                // Specific EOI: clear the named level
                this.isr &= ~(1 << level);
            }
            this._updateInt();
        }
        // Rotation commands (cmd 5,6,7) not modelled
    }

    /**
     * Raise or lower an IRQ line.
     * @param {number} irq 0-7
     * @param {boolean|0|1} level true/1 = asserted
     */
    setIRQ(irq, level) {
        const mask = 1 << (irq & 7);
        if (level) this.irr |= mask;
        else this.irr &= ~mask;
        this._updateInt();
    }

    /**
     * Acknowledge: the CPU is taking the interrupt. Returns the vector
     * number. Sets the ISR bit and clears the IRR bit. If autoEOI, the
     * ISR bit is cleared immediately.
     * @returns {number} vector number (0-255)
     */
    acknowledge() {
        const pending = this.irr & ~this.imr;
        for (let i = 0; i < 8; i++) {
            if (pending & (1 << i)) {
                // Block this in IRR only if it was edge-triggered
                // (in level mode the device keeps it asserted). For
                // simplicity, clear it — the device can reassert.
                this.irr &= ~(1 << i);
                if (!this.autoEOI) this.isr |= (1 << i);
                this._updateInt();
                return this.vectorBase | i;
            }
        }
        // Spurious — no pending interrupt
        return this.vectorBase | 7;
    }

    /** True when the INT output is asserted (there's a serviceable interrupt). */
    get intActive() { return this._intActive; }

    /**
     * 0 when operational; 1/2/3 while the chip is still waiting for ICW2 /
     * ICW3 / ICW4. Non-zero means the chip is deaf to interrupts until the
     * init sequence finishes.
     */
    get initPhase() { return this._initPhase; }

    /** Set the init phase AND the human-readable warning that mirrors it. */
    _setInitPhase(n) {
        this._initPhase = n;
        this.initWarning = n === 0 ? null
            : n === 1 ? '8259 still initialising: wrote ICW1, awaiting ICW2 (vector base)'
                : n === 2 ? '8259 still initialising: awaiting ICW3 (cascade map) — ICW1 selected cascade mode'
                    : '8259 still initialising: awaiting ICW4 (mode) — no interrupts until it arrives';
    }

    _updateInt() {
        // A chip still in its ICW sequence does not drive INT, however its
        // IRR fills — which is exactly why a PIC stuck mid-init is silent
        // rather than wrong. IRR still latches; it just cannot be serviced.
        const pending = this._initPhase !== 0 ? 0 : (this.irr & ~this.imr);
        // Find highest-priority pending
        let hasPending = false;
        for (let i = 0; i < 8; i++) {
            if (pending & (1 << i)) {
                // Is there a higher-or-equal priority interrupt in service?
                let blocked = false;
                for (let j = 0; j <= i; j++) {
                    if (this.isr & (1 << j)) { blocked = true; break; }
                }
                if (!blocked) { hasPending = true; break; }
            }
        }
        if (hasPending !== this._intActive) {
            this._intActive = hasPending;
            if (this.hooks.onInterrupt) this.hooks.onInterrupt(hasPending);
        }
    }

    getState() {
        return {
            irr: this.irr, isr: this.isr, imr: this.imr,
            vectorBase: this.vectorBase, icw4: this.icw4,
            autoEOI: this.autoEOI, readISR: this.readISR,
            initPhase: this._initPhase, needICW3: this._needICW3,
            needICW4: this._needICW4, intActive: this._intActive,
        };
    }

    setState(s) {
        this.irr = s.irr; this.isr = s.isr; this.imr = s.imr;
        this.vectorBase = s.vectorBase; this.icw4 = s.icw4;
        this.autoEOI = s.autoEOI; this.readISR = s.readISR;
        this._needICW3 = s.needICW3;
        this._needICW4 = s.needICW4; this._intActive = s.intActive;
        this._setInitPhase(s.initPhase);   // restores initWarning to match
    }
}

export default I8259;
