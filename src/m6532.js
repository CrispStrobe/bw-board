/**
 * MOS 6532 RIOT — RAM + I/O + Timer, clean-room from the datasheet.
 *
 * The 6532 integrates 128 bytes of RAM, two 8-bit I/O ports with data
 * direction registers, and an interval timer with four prescaler modes.
 *
 * Address decode (active when chip-selected):
 *   A6=0 (RS low):  128-byte static RAM (A0–A6)
 *   A6=1 (RS high): I/O and timer registers
 *     A4=0: port registers  — A1 selects port (0=A, 1=B), A0 selects DDR
 *     A4=1: timer
 *       WRITE: A1:A0 = prescaler (00=/1, 01=/8, 10=/64, 11=/1024)
 *              A3 = interrupt enable on write (1=enable, 0=disable)
 *       READ:  A0 = 0 → read timer value (A3 controls interrupt flag peek)
 *              A0 = 1 → read interrupt flags
 *
 * Timer behaviour: writes to the timer registers load the counter and select
 * the prescaler. The prescaler counts down, and when it reaches zero the main
 * counter decrements. When the counter underflows from $00 to $FF, the timer
 * interrupt flag is set and the prescaler switches to /1 for the remaining
 * countdown (the counter free-runs at /1 until read or re-loaded).
 *
 * PA7 edge detect: a negative or positive transition on PA7 (depending on
 * configuration) sets the PA7 interrupt flag. The edge polarity is set by
 * writing to the edge-detect register addresses.
 *
 * Documented limitation: the underlying CPU core is a W65C02 (CMOS), not the
 * NMOS 6502/6507. No NMOS undocumented opcodes are modeled.
 *
 * @module
 */

const PRESCALE = [1, 8, 64, 1024];

export class M6532 {
    /**
     * @param {{ onPortChange?: (port: 'a'|'b', value: number, ddr: number) => void,
     *           onIrqChange?: (asserted: boolean) => void }} [hooks]
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        /** 128 bytes of on-chip RAM. */
        this.ram = new Uint8Array(128);
        /** Output registers. */
        this.ora = 0; this.orb = 0;
        /** Data direction: 1 = output, 0 = input. */
        this.ddra = 0; this.ddrb = 0;
        /** External input pin levels (undriven reads high). */
        this.inA = 0xff; this.inB = 0xff;
        /** Timer state. */
        this.timerValue = 0x00;       // 8-bit counter
        this.prescaler = 1024;        // current prescaler divisor
        this.prescaleCounter = 1024;  // countdown within current prescale
        this.timerIrqEnabled = false;
        this.timerFlag = false;       // set on underflow
        this.timerUnderflowed = false; // after underflow, prescaler = /1
        /** PA7 edge detect. */
        this.pa7Flag = false;
        this.pa7IrqEnabled = false;
        this.pa7Positive = false; // false = negative edge, true = positive
        this.pa7Last = 1;         // last PA7 input level (pins default high)
        this._irq = false;
    }

    /** The irqAsserted getter matches the VIA/ACIA convention. */
    get irqAsserted() { return this._irq; }

    _syncIrq() {
        const asserted = (this.timerFlag && this.timerIrqEnabled) ||
                         (this.pa7Flag && this.pa7IrqEnabled);
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    /**
     * Set an external input pin level.
     * @param {'a'|'b'} port
     * @param {number} bit 0-7
     * @param {0|1} level
     */
    setInput(port, bit, level) {
        const mask = 1 << bit;
        if (port === 'a') {
            this.inA = level ? (this.inA | mask) : (this.inA & ~mask);
            // PA7 edge detection
            if (bit === 7) {
                const cur = level ? 1 : 0;
                if (this.pa7Last !== cur) {
                    if ((this.pa7Positive && cur === 1) ||
                        (!this.pa7Positive && cur === 0)) {
                        this.pa7Flag = true;
                        this._syncIrq();
                    }
                    this.pa7Last = cur;
                }
            }
        } else {
            this.inB = level ? (this.inB | mask) : (this.inB & ~mask);
        }
    }

    /**
     * Read a register or RAM byte. The address is the offset within the
     * chip's address window (A0–A6 + RS encoded in the address).
     *
     * In the 6507SBC decode: RS = A7, so:
     *   addr & 0x80 = 0: RAM (addr & 0x7F)
     *   addr & 0x80 = 1: registers
     */
    read(addr) {
        // RS = bit 7 of the address in our decode
        if (!(addr & 0x80)) {
            // RAM access
            return this.ram[addr & 0x7f];
        }
        // Register space
        if (!(addr & 0x04)) {
            // A2=0: I/O port registers
            // A1 selects port, A0 selects data vs DDR
            const port = addr & 0x02;
            const isDdr = addr & 0x01;
            if (port) {
                // Port B
                if (isDdr) return this.ddrb;
                return (this.orb & this.ddrb) | (this.inB & ~this.ddrb);
            } else {
                // Port A
                if (isDdr) return this.ddra;
                return (this.ora & this.ddra) | (this.inA & ~this.ddra);
            }
        }
        // A2=1: Timer / interrupt flags
        if (addr & 0x01) {
            // Read interrupt flags: bit 7 = timer, bit 6 = PA7
            const val = (this.timerFlag ? 0x80 : 0) | (this.pa7Flag ? 0x40 : 0);
            // Reading interrupt flags clears the PA7 flag
            this.pa7Flag = false;
            this._syncIrq();
            return val;
        }
        // Read timer value
        // A3 controls: 1 = enable timer IRQ on read, 0 = disable
        this.timerIrqEnabled = !!(addr & 0x08);
        // Reading the timer clears the timer flag
        this.timerFlag = false;
        this._syncIrq();
        return this.timerValue;
    }

    /**
     * Write a register or RAM byte.
     */
    write(addr, val) {
        if (!(addr & 0x80)) {
            // RAM
            this.ram[addr & 0x7f] = val;
            return;
        }
        // Register space
        if (!(addr & 0x04)) {
            // A2=0: I/O port registers or PA7 edge detect
            if (addr & 0x10) {
                // A4=1: PA7 edge detect control
                // A0 selects polarity: 0 = negative, 1 = positive
                // A1 selects IRQ enable: 0 = disable, 1 = enable (undocumented on some datasheets
                // but the standard decode is A1 for enable, A0 for polarity)
                this.pa7Positive = !!(addr & 0x01);
                this.pa7IrqEnabled = !!(addr & 0x02);
                this._syncIrq();
                return;
            }
            // A1 selects port, A0 selects data vs DDR
            const port = addr & 0x02;
            const isDdr = addr & 0x01;
            if (port) {
                if (isDdr) {
                    this.ddrb = val;
                } else {
                    this.orb = val;
                }
                if (this.hooks.onPortChange) {
                    this.hooks.onPortChange('b', this.orb, this.ddrb);
                }
            } else {
                if (isDdr) {
                    this.ddra = val;
                } else {
                    this.ora = val;
                    // Check PA7 edge when output changes
                    const pa7Out = (val & this.ddra & 0x80) ? 1 : 0;
                    if (this.ddra & 0x80) {
                        const cur = pa7Out;
                        if (this.pa7Last !== cur) {
                            if ((this.pa7Positive && cur === 1) ||
                                (!this.pa7Positive && cur === 0)) {
                                this.pa7Flag = true;
                            }
                            this.pa7Last = cur;
                        }
                    }
                }
                if (this.hooks.onPortChange) {
                    this.hooks.onPortChange('a', this.ora, this.ddra);
                }
            }
            this._syncIrq();
            return;
        }
        // A2=1: Timer registers
        if (addr & 0x10) {
            // A4=1: Timer write — load counter and select prescaler
            // A1:A0 = prescaler select
            const prescaleIndex = addr & 0x03;
            this.prescaler = PRESCALE[prescaleIndex];
            this.prescaleCounter = this.prescaler;
            this.timerValue = val;
            this.timerFlag = false;
            this.timerUnderflowed = false;
            // A3 = interrupt enable
            this.timerIrqEnabled = !!(addr & 0x08);
            this._syncIrq();
            return;
        }
        // A4=0, A2=1: PA7 edge detect (same as when A4=0 actually)
        // Some datasheets put edge detect at A4=0,A2=1 for writes
        this.pa7Positive = !!(addr & 0x01);
        this.pa7IrqEnabled = !!(addr & 0x02);
        this._syncIrq();
    }

    /**
     * Advance by N phi2 cycles. Timer decrements once per prescaler period.
     * @param {number} cycles
     */
    /** Cycles until the timer underflow flag sets — the WAI wake horizon.
     *  After the first underflow no new flag can set, so Infinity. */
    nextWake() {
        if (this.timerUnderflowed) return Infinity;
        return Math.max(1, this.prescaleCounter + this.timerValue * this.prescaler);
    }

    advance(cycles) {
        for (let i = 0; i < cycles; i++) {
            this.prescaleCounter--;
            if (this.prescaleCounter <= 0) {
                // Prescaler expired — decrement the timer
                if (this.timerValue === 0) {
                    // Underflow: $00 → $FF
                    this.timerValue = 0xff;
                    if (!this.timerUnderflowed) {
                        this.timerFlag = true;
                        this.timerUnderflowed = true;
                        this._syncIrq();
                    }
                    // After underflow, prescaler switches to /1
                    this.prescaler = 1;
                    this.prescaleCounter = 1;
                } else {
                    this.timerValue--;
                    this.prescaleCounter = this.timerUnderflowed ? 1 : this.prescaler;
                }
            }
        }
    }
}
