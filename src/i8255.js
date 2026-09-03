/**
 * Intel 8255 PPI — the parallel port every 8086 breadboard computer hangs
 * its LEDs, switches and character LCD off, clean-room from the datasheet
 * in the same shape as the W65C22: an output latch per port, a direction
 * mask per port, an input register the board writes through setInput(),
 * and an onPortChange notification the adapter turns into pin edges.
 *
 * FOUR REGISTERS, and the fourth is not a port. 0=A, 1=B, 2=C, 3=control.
 * The control register is WRITE ONLY -- the 8255 has no path to read the
 * mode back, and a program that tries gets the undriven bus, so reading it
 * here answers 0xff rather than the mode word it might feel entitled to.
 *
 * PORT C IS TWO PORTS. Its upper nibble (PC7-PC4) and lower nibble
 * (PC3-PC0) carry independent directions, which is what makes it the
 * handshake port in modes 1 and 2 and, in mode 0, an eight-bit port that
 * can be half in and half out. Code that treats it as one direction bit
 * works until the first LCD wiring that uses PC3-PC0 for the data nibble
 * and PC7-PC6 for RS and E.
 *
 * A MODE-SET WORD CLEARS THE OUTPUT LATCHES. Writing bit 7 high does not
 * merely reconfigure: ports A, B and C all drop to zero. On a breadboard
 * that is visible -- every LED goes dark for the instant between the
 * configuration write and the first data write -- and a model that keeps
 * the latches makes an LED that should blink appear to stay lit.
 *
 * MODES 1 AND 2 ARE NOT MODELLED, deliberately and not silently. They are
 * the strobed and bidirectional handshake modes, they need OBF/ACK/STB/IBF
 * on port C plus an interrupt path, and nothing in the teaching corpus uses
 * them. A control word selecting one is accepted, the data paths behave as
 * mode 0, and `modeWarning` says so in words the machine layer can surface.
 * Pretending to implement them would be worse than refusing.
 *
 * @module
 */

/** Control-word bit meanings, named so the decode below reads as prose. */
const MODE_SET = 0x80;

export class I8255 {
    /**
     * @param {{ onPortChange?: (port: 'a'|'b'|'c', value: number, out: number) => void }} [hooks]
     *   `out` is the direction mask with 1 = DRIVEN BY THE CHIP, matching
     *   the W65C22's DDR sense so one adapter path serves both.
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        // Power-on and the RESET pin both land on control word 9Bh: mode 0
        // everywhere, every port an input. A breadboard that forgets to
        // configure the chip therefore drives nothing, which is the safe
        // answer and the one the datasheet gives.
        this.control = 0x9b;
        this.outA = 0; this.outB = 0; this.outC = 0;
        this.inA = 0xff; this.inB = 0xff; this.inC = 0xff;
        this.modeWarning = null;
        this._applyControl(0x9b, false);
    }

    // ---- direction ------------------------------------------------------
    /** 1 where the chip drives. Port C is assembled from its two halves. */
    get dirA() { return (this.control & 0x10) ? 0x00 : 0xff; }
    get dirB() { return (this.control & 0x02) ? 0x00 : 0xff; }
    get dirC() {
        return ((this.control & 0x08) ? 0x00 : 0xf0) | ((this.control & 0x01) ? 0x00 : 0x0f);
    }

    /** What the pins carry: the latch where we drive, the input elsewhere. */
    _pinsA() { return (this.outA & this.dirA) | (this.inA & ~this.dirA & 0xff); }
    _pinsB() { return (this.outB & this.dirB) | (this.inB & ~this.dirB & 0xff); }
    _pinsC() { return (this.outC & this.dirC) | (this.inC & ~this.dirC & 0xff); }

    _notify(port) {
        if (!this.hooks.onPortChange) return;
        if (port === 'a') this.hooks.onPortChange('a', this.outA, this.dirA);
        else if (port === 'b') this.hooks.onPortChange('b', this.outB, this.dirB);
        else this.hooks.onPortChange('c', this.outC, this.dirC);
    }

    _applyControl(val, notify = true) {
        this.control = val & 0xff;
        const groupA = (val >> 5) & 3, groupB = (val >> 2) & 1;
        this.modeWarning = (groupA !== 0 || groupB !== 0)
            ? `8255 control ${val.toString(16)}h selects mode ${groupA !== 0 ? `${groupA} on group A` : ''}`
                + `${groupA !== 0 && groupB !== 0 ? ' and ' : ''}${groupB !== 0 ? 'mode 1 on group B' : ''}`
                + ' — strobed handshake is not modelled; the data paths behave as mode 0'
            : null;
        // The latches clear. This is the part that surprises people.
        this.outA = 0; this.outB = 0; this.outC = 0;
        if (notify) { this._notify('a'); this._notify('b'); this._notify('c'); }
    }

    // ---- bus ------------------------------------------------------------
    /** @param {number} reg 0=A 1=B 2=C 3=control */
    read(reg) {
        switch (reg & 3) {
            case 0: return this._pinsA();
            case 1: return this._pinsB();
            case 2: return this._pinsC();
            // Write-only. The bus floats and reads high; answering with the
            // control word would invent a register the chip does not have.
            default: return 0xff;
        }
    }

    /** @param {number} reg 0=A 1=B 2=C 3=control */
    write(reg, val) {
        val &= 0xff;
        switch (reg & 3) {
            case 0: this.outA = val; this._notify('a'); return;
            case 1: this.outB = val; this._notify('b'); return;
            case 2: this.outC = val; this._notify('c'); return;
            default: break;
        }
        if (val & MODE_SET) { this._applyControl(val); return; }
        // Bit set/reset: bits 3-1 name a bit of port C, bit 0 is the value.
        // This is how a program toggles one LCD strobe without touching the
        // data nibble beside it, and it is why port C is the control port.
        const bit = (val >> 1) & 7, level = val & 1;
        this.outC = level ? (this.outC | (1 << bit)) : (this.outC & ~(1 << bit));
        this.outC &= 0xff;
        this._notify('c');
    }

    // ---- the world outside ----------------------------------------------
    /** @param {'a'|'b'|'c'} port @param {number} bit @param {0|1} level */
    setInput(port, bit, level) {
        const mask = 1 << (bit & 7);
        if (port === 'a') this.inA = level ? this.inA | mask : this.inA & ~mask;
        else if (port === 'b') this.inB = level ? this.inB | mask : this.inB & ~mask;
        else this.inC = level ? this.inC | mask : this.inC & ~mask;
    }

    /** Whole-port input write, for a board sync that has all eight levels. */
    setInputPort(port, value) {
        if (port === 'a') this.inA = value & 0xff;
        else if (port === 'b') this.inB = value & 0xff;
        else this.inC = value & 0xff;
    }

    getState() {
        return {
            control: this.control,
            outA: this.outA, outB: this.outB, outC: this.outC,
            inA: this.inA, inB: this.inB, inC: this.inC,
        };
    }

    setState(s) {
        this.control = s.control;
        this.outA = s.outA; this.outB = s.outB; this.outC = s.outC;
        this.inA = s.inA; this.inB = s.inB; this.inC = s.inC;
    }
}

export default I8255;
