/**
 * W65C22 VIA — the retro tier's timer/GPIO chip, our own model.
 *
 * The composable 6502 machine maps this chip at whatever address the config
 * (preset, declared, or wired-and-extracted) says; the chip itself only sees
 * register selects 0-15. Timers count phi2, so the machine calls
 * advance(cycles) with each instruction's cycle count.
 *
 * What the generated C leans on and is therefore modeled exactly:
 *   - T1 free-run: period is LATCH+2 cycles (the datasheet's N+2), IFR6 set
 *     on every reload, cleared by reading T1C-L or writing T1C-H/T1L-H.
 *     bw_now() polls IFR6 and accumulates milliseconds — the +2 matters.
 *   - T1 one-shot: fires once, keeps counting through $FFFF.
 *   - T2 one-shot (ACR5=0) and PB6 pulse-count (ACR5=1).
 *   - IER bit-7 set/clear write semantics; IFR bit 7 = OR of enabled flags.
 *   - Ports with DDR masking; reads return pin levels for input bits;
 *     PB7 is owned by T1 when ACR7 is set (toggle in free-run, low-then-high
 *     in one-shot).
 *   - CA1/CA2/CB1/CB2 edge detection per PCR polarity, flags cleared by
 *     ORA/ORB access except in the independent PCR modes.
 * Not modeled: the shift register (SR is storage only — none of our
 * firmware shapes use it; the machine refuses configs that ask for it).
 *
 * @module
 */

// IFR/IER bits.
const CA2 = 0x01, CA1 = 0x02, SR = 0x04, CB2 = 0x08, CB1 = 0x10, T2 = 0x20, T1 = 0x40;

export class W65C22 {
    /**
     * @param {{ onPortChange?: (port: 'a'|'b', value: number, ddr: number) => void,
     *           onIrqChange?: (asserted: boolean) => void }} [hooks]
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.ora = 0; this.orb = 0; this.ddra = 0; this.ddrb = 0;
        /** External input levels per port, one bit per pin; undriven reads high. */
        this.inA = 0xff; this.inB = 0xff;
        this.t1c = 0xffff; this.t1l = 0xffff; this.t1Fired = true; this.t1pb7 = 1;
        this.t2c = 0xffff; this.t2ll = 0xff; this.t2Fired = true;
        this.sr = 0; this.acr = 0; this.pcr = 0;
        this.ifr = 0; this.ier = 0;
        this.ca1 = 1; this.ca2 = 1; this.cb1 = 1; this.cb2 = 1;
        this._irq = false;
    }

    _setIfr(bits) { this.ifr |= bits; this._syncIrq(); }
    _clearIfr(bits) { this.ifr &= ~bits; this._syncIrq(); }
    _syncIrq() {
        const asserted = (this.ifr & this.ier & 0x7f) !== 0;
        if (asserted !== this._irq) {
            this._irq = asserted;
            if (this.hooks.onIrqChange) this.hooks.onIrqChange(asserted);
        }
    }

    /** Effective port B output value (PB7 owned by T1 when ACR7 set). */
    _pbOut() {
        let v = this.orb;
        if (this.acr & 0x80) v = (v & 0x7f) | (this.t1pb7 << 7);
        return v;
    }

    _notifyA() { if (this.hooks.onPortChange) this.hooks.onPortChange('a', this.ora, this.ddra); }
    _notifyB() { if (this.hooks.onPortChange) this.hooks.onPortChange('b', this._pbOut(), this.ddrb); }

    /** @param {number} reg register select 0-15 */
    read(reg) {
        switch (reg & 0x0f) {
            case 0x0: // IRB: output bits read ORB, input bits read pins
                if ((this.pcr & 0xe0) !== 0x20) this._clearIfr(CB1 | CB2); else this._clearIfr(CB1);
                return (this._pbOut() & this.ddrb) | (this.inB & ~this.ddrb);
            case 0x1: // IRA: reads the pins themselves
                if ((this.pcr & 0x0e) !== 0x02) this._clearIfr(CA1 | CA2); else this._clearIfr(CA1);
                return (this.ora & this.ddra) | (this.inA & ~this.ddra);
            case 0x2: return this.ddrb;
            case 0x3: return this.ddra;
            case 0x4: this._clearIfr(T1); return this.t1c & 0xff;
            case 0x5: return (this.t1c >> 8) & 0xff;
            case 0x6: return this.t1l & 0xff;
            case 0x7: return (this.t1l >> 8) & 0xff;
            case 0x8: this._clearIfr(T2); return this.t2c & 0xff;
            case 0x9: return (this.t2c >> 8) & 0xff;
            case 0xa: return this.sr;
            case 0xb: return this.acr;
            case 0xc: return this.pcr;
            case 0xd: return (this.ifr & 0x7f) | ((this.ifr & this.ier & 0x7f) ? 0x80 : 0);
            case 0xe: return this.ier | 0x80;
            default: // 0xf: ORA without handshake — no flag clearing
                return (this.ora & this.ddra) | (this.inA & ~this.ddra);
        }
    }

    /** @param {number} reg register select 0-15 @param {number} val */
    write(reg, val) {
        val &= 0xff;
        switch (reg & 0x0f) {
            case 0x0:
                if ((this.pcr & 0xe0) !== 0x20) this._clearIfr(CB1 | CB2); else this._clearIfr(CB1);
                this.orb = val; this._notifyB(); break;
            case 0x1:
                if ((this.pcr & 0x0e) !== 0x02) this._clearIfr(CA1 | CA2); else this._clearIfr(CA1);
                this.ora = val; this._notifyA(); break;
            case 0x2: this.ddrb = val; this._notifyB(); break;
            case 0x3: this.ddra = val; this._notifyA(); break;
            case 0x4: case 0x6:
                this.t1l = (this.t1l & 0xff00) | val; break;
            case 0x5: // load + start
                this.t1l = (this.t1l & 0x00ff) | (val << 8);
                this.t1c = this.t1l;
                this.t1Fired = false;
                this._clearIfr(T1);
                if ((this.acr & 0xc0) === 0x80) { this.t1pb7 = 0; this._notifyB(); } // one-shot: PB7 low while counting
                break;
            case 0x7:
                this.t1l = (this.t1l & 0x00ff) | (val << 8);
                this._clearIfr(T1);
                break;
            case 0x8: this.t2ll = val; break;
            case 0x9:
                this.t2c = (val << 8) | this.t2ll;
                this.t2Fired = false;
                this._clearIfr(T2);
                break;
            case 0xa: this.sr = val; break;
            case 0xb: { const was = this._pbOut(); this.acr = val; if (this._pbOut() !== was) this._notifyB(); break; }
            case 0xc: this.pcr = val; break;
            case 0xd: this._clearIfr(val & 0x7f); break;
            default: // 0xe IER: bit 7 selects set (1) or clear (0)
                if (val & 0x80) this.ier |= val & 0x7f; else this.ier &= ~(val & 0x7f);
                this._syncIrq();
        }
    }

    /**
     * Advance the phi2 clock. Rollover arithmetic, not a per-cycle loop —
     * the machine calls this once per instruction.
     * @param {number} n cycles
     */
    advance(n) {
        // Timer 1
        let c = this.t1c - n;
        if (c < 0) {
            if (this.acr & 0x40) { // free-run: reload every LATCH+2
                const period = this.t1l + 2;
                while (c < 0) {
                    this._setIfr(T1);
                    if (this.acr & 0x80) { this.t1pb7 ^= 1; this._notifyB(); }
                    c += period;
                }
            } else {
                if (!this.t1Fired) {
                    this.t1Fired = true;
                    this._setIfr(T1);
                    if (this.acr & 0x80) { this.t1pb7 = 1; this._notifyB(); }
                }
                while (c < 0) c += 0x10000;
            }
        }
        this.t1c = c;
        // Timer 2, one-shot mode only counts phi2
        if (!(this.acr & 0x20)) {
            let c2 = this.t2c - n;
            if (c2 < 0) {
                if (!this.t2Fired) { this.t2Fired = true; this._setIfr(T2); }
                while (c2 < 0) c2 += 0x10000;
            }
            this.t2c = c2;
        }
    }

    /**
     * External input level change on a port pin.
     * @param {'a'|'b'} port @param {number} bit 0-7 @param {0|1} level
     */
    setInput(port, bit, level) {
        const mask = 1 << bit;
        if (port === 'a') {
            this.inA = level ? this.inA | mask : this.inA & ~mask;
        } else {
            const falling = (this.inB & mask) && !level;
            this.inB = level ? this.inB | mask : this.inB & ~mask;
            // T2 pulse-count mode decrements on PB6 falling edges; IFR5 sets
            // when the counter REACHES ZERO (datasheet §2.10, Figure 2-5).
            // KNOWN DIVERGENCE: MAME's 6522 (BSD-3, MOS/Rockwell lineage)
            // fires on UNDERFLOW instead — the N+1th pulse. We model the
            // W65C22 and follow WDC's figure; any MAME differential must
            // expect this diff, and a silicon probe is the tiebreaker.
            if (bit === 6 && falling && (this.acr & 0x20)) {
                this.t2c = (this.t2c - 1) & 0xffff;
                if (this.t2c === 0 && !this.t2Fired) { this.t2Fired = true; this._setIfr(T2); }
            }
        }
    }

    /**
     * Edge on a control line. Polarity per PCR: flag on the ACTIVE edge.
     * @param {'ca1'|'ca2'|'cb1'|'cb2'} line @param {0|1} level
     */
    setControl(line, level) {
        const prev = this[line];
        this[line] = level;
        if (prev === level) return;
        const rising = level === 1;
        switch (line) {
            case 'ca1': if (rising === !!(this.pcr & 0x01)) this._setIfr(CA1); break;
            case 'ca2': if (!(this.pcr & 0x08) && rising === !!(this.pcr & 0x04)) this._setIfr(CA2); break;
            case 'cb1': if (rising === !!(this.pcr & 0x10)) this._setIfr(CB1); break;
            case 'cb2': if (!(this.pcr & 0x80) && rising === !!(this.pcr & 0x40)) this._setIfr(CB2); break;
        }
    }

    /** IRQ line state (active = true). */
    get irqAsserted() { return this._irq; }
}

export default W65C22;
