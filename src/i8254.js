/**
 * Intel 8254 PIT — three independent 16-bit down-counters, clean-room from
 * the datasheet in the same shape as the 8255: a handful of registers, a
 * write() / read() bus interface, and an advance(cycles) method the machine
 * layer calls on every instruction boundary.
 *
 * FOUR ADDRESSES: 0=counter 0, 1=counter 1, 2=counter 2, 3=control word.
 * The control word selects which counter to configure and never reads back
 * (the read-back command is an 8254 extension over the 8253 and IS handled).
 * A machine may declare `variant: '8253'` for the earlier part the original
 * IBM PC/XT used: identical but for the read-back command, which the 8253 does
 * not have and ignores as an illegal (counter-3) control word.
 *
 * MODES: only 0, 2 and 3 are modelled because that is what the teaching
 * corpus runs. Mode 0 is "interrupt on terminal count" — OUT goes high
 * when the count reaches zero and stays there. Mode 2 is "rate generator" —
 * OUT is high for (count−1) ticks, low for one tick, then reloads. Mode 3
 * is "square wave" — OUT toggles every (count/2) ticks.
 *
 * The counter's value is a 16-bit RELOAD register loaded through one or
 * two byte writes (selected by RW bits in the control word) and a 16-bit
 * COUNTING ELEMENT (CE) that counts down. A read returns the CE (or a
 * latched copy). The reload happens on the next clock after a mode-set or
 * after the CE reaches zero (in modes 2/3).
 *
 * ACCURACY TIER: THE COUNT, AT INSTRUCTION GRANULARITY. The control word,
 * modes 0/2/3/4, the reload divisor, the count latch, the read-back status
 * command and the OUT-pin transitions relative to the count are all exact.
 * What is NOT here, named rather than left to be discovered:
 *
 *   - NO SUB-INSTRUCTION TIME. The counter advances by each instruction's
 *     cycle budget, not per 1.193 MHz PIT tick, so a count READ between two
 *     instructions is quantised to instruction boundaries — exact at that
 *     granularity, but not to the individual clock.
 *
 * THE CRYSTAL IS THE CHIP'S OWN, AND IT IS NOT THE CPU'S. A PIT on a PC runs
 * from a 1.193182 MHz oscillator — a third of the 3.579545 MHz colour burst —
 * whatever the processor beside it is clocked at. This chip used to be handed
 * MACHINE CYCLES and count them as its own ticks, which made a 5 MHz bench run
 * the timer 4.19x fast: the "18.2 Hz" BIOS tick measured 76.35 Hz. It is
 * advanced in MILLISECONDS of emulated time now, the same way the OPL and the
 * AY are, because a chip with its own oscillator has to convert from the
 * machine's time base rather than borrow it.
 *
 * THE FRACTIONAL CARRY IS LOAD-BEARING. `_advanceChips` is called per
 * instruction — n=4 cycles for a short one, which at 5 MHz is 0.8 us and
 * therefore LESS THAN ONE 1.193 MHz count. Truncating each call to whole ticks
 * would round almost every one of them to zero and stop the clock nearly dead.
 * The remainder is accumulated across calls.
 *   - MODES 0-5 ALL MODELLED (1 and 5 added 2026-09-05). The two GATE-triggered
 *     forms need a real gate INPUT, not an assumed level: `setGate` handles the
 *     edge, because a one-shot armed by an edge that never reaches the counter
 *     can never fire. Modes 0 and 4 are level-gated, 1 and 5 are edge-triggered
 *     and then indifferent to the level, and 2 and 3 are both -- a low gate
 *     forces OUT high rather than merely pausing.
 *   - BCD COUNTS IN DECADES (added 2026-09-05). It previously did not, and the
 *     shape of that bug is worth keeping: the BCD bit ROUND-TRIPPED. A program
 *     could set it, read the status byte back, and see it set. The one check a
 *     program is likely to make agreed with the datasheet while the counting
 *     did not -- an instrument confirming its own setting rather than its
 *     effect. 0x20 - 1 is 0x19, and a reload of 0 is ten thousand, not 65536.
 *   - STILL NO SUB-INSTRUCTION TIMING. Counts advance in whole ticks converted
 *     from emulated milliseconds; a program that reads the counter twice within
 *     one instruction sees one value.
 *
 * @module
 */

export class I8254 {
    /**
     * @param {{ onOutput?: (channel: number, level: 0|1) => void }} [hooks]
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        /** The 8254's own oscillator: 1.193182 MHz on a PC, a third of the
         *  colour burst. A board with a different crystal says so. */
        this.clockHz = hooks.clockHz || 1_193_182;
        /** Ticks owed but not yet whole. See THE FRACTIONAL CARRY above. */
        this._frac = 0;
        // '8253' is the earlier part (original IBM PC/XT): it has NO read-back
        // command. The read-back (SC field = 11b) is an 8254 extension; on an
        // 8253 that control word selects a non-existent counter 3 and is ignored.
        this.variant = hooks.variant === '8253' ? '8253' : '8254';
        this.counters = [new Counter(0, hooks), new Counter(1, hooks), new Counter(2, hooks)];
    }

    reset() { for (const c of this.counters) c.reset(); }

    read(reg) {
        if ((reg & 3) === 3) return 0xff;
        return this.counters[reg & 3].read();
    }

    write(reg, val) {
        val &= 0xff;
        if ((reg & 3) < 3) { this.counters[reg & 3].writeData(val); return; }

        const sc = (val >> 6) & 3;
        if (sc === 3) {
            // Read-back command (8254 only): latch count and/or status. On the
            // 8253 this control word is illegal (counter 3) and does nothing.
            if (this.variant === '8253') return;
            for (let ch = 0; ch < 3; ch++) {
                if (!(val & (2 << ch))) continue;
                if (!(val & 0x20)) this.counters[ch].latchCount();
                if (!(val & 0x10)) this.counters[ch].latchStatus();
            }
            return;
        }
        const rw = (val >> 4) & 3;
        if (rw === 0) {
            this.counters[sc].latchCount();
            return;
        }
        this.counters[sc].writeControl(val);
    }

    /**
     * ADVANCE BY EMULATED TIME, not by machine cycles. The machine layer
     * prefers this method over `advance()` when a chip offers it, which is how
     * the OPL and this chip both get their own time base.
     * @param {number} ms milliseconds of emulated time
     */
    advanceMs(ms) {
        const exact = (ms * this.clockHz / 1000) + this._frac;
        const whole = Math.floor(exact);
        this._frac = exact - whole;      // carried, never dropped
        if (whole > 0) for (const c of this.counters) c.advance(whole);
    }

    /** Raw tick advance, for a caller that already counts in PIT ticks. */
    advance(ticks) {
        for (const c of this.counters) c.advance(ticks);
    }

    /** Ticks until the nearest counter output edge. */
    nextWake() {
        let min = Infinity;
        for (const c of this.counters) {
            const t = c.ticksToEdge();
            if (t < min) min = t;
        }
        return min;
    }

    getState() { return { counters: this.counters.map((c) => c.getState()) }; }

    setState(s) {
        for (let i = 0; i < 3; i++) this.counters[i].setState(s.counters[i]);
    }
}

class Counter {
    constructor(channel, hooks) {
        this.channel = channel;
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.mode = 0;
        this.rw = 0;          // 1=lsb, 2=msb, 3=lsb-then-msb
        this.bcd = 0;
        this.reload = 0;
        this.ce = 0;           // counting element
        this.out = 0;
        this.armed = false;    // reload value has been written; waiting for load
        this.phase = 'hi';     // toggle state for modes 2/3
        this.rwPhase = 0;      // for two-byte rw=3: 0=lsb next, 1=msb next
        this.latched = null;   // latched count value (null = not latched)
        this.statusLatched = null;
        this.nullCount = true; // true until first reload loads into CE
        this.gate = 1;         // gate input (always 1 for channels 0/1 on PC)
    }

    writeControl(val) {
        this.rw = (val >> 4) & 3;
        this.mode = (val >> 1) & 7;
        this.bcd = val & 1;
        this.rwPhase = 0;
        this.armed = false;
        this.nullCount = true;

        if (this.mode === 0) {
            this._setOut(0);
        } else {
            this._setOut(1);
        }
    }

    writeData(val) {
        if (this.rw === 1) {
            this.reload = (this.reload & 0xff00) | val;
            this.armed = true;
        } else if (this.rw === 2) {
            this.reload = (this.reload & 0x00ff) | (val << 8);
            this.armed = true;
        } else if (this.rw === 3) {
            if (this.rwPhase === 0) {
                this.reload = (this.reload & 0xff00) | val;
                this.rwPhase = 1;
            } else {
                this.reload = (this.reload & 0x00ff) | (val << 8);
                this.rwPhase = 0;
                this.armed = true;
            }
        }

        if (this.armed) this._loadOnArm();
    }

    /**
     * The reload value as a COUNT. 0 means the maximum, which differs by base:
     * 65536 in binary, 10000 in BCD -- the 8254 counts four decades, so a full
     * cycle is ten thousand, not sixty-five thousand.
     */
    _fullCount() {
        if (this.reload === 0) return this.bcd ? 10000 : 0x10000;
        return this.reload;
    }

    /** BCD nibbles to an integer, for scheduling arithmetic. */
    _bcdToInt(v) {
        let n = 0, mul = 1;
        for (let d = 0; d < 4; d++) { n += ((v >> (d * 4)) & 0xf) * mul; mul *= 10; }
        return n;
    }

    /**
     * Decrement by one in the counter's own base. BCD is not "binary with a
     * different display": each nibble is a decade, so 0x20 - 1 is 0x19, not
     * 0x1f. A binary decrement is what the old header comment admitted to --
     * the BCD bit was stored, read back in the status byte, and then ignored.
     */
    _dec(v, by = 1) {
        if (!this.bcd) return v - by;
        let n = this._bcdToInt(v) - by;
        if (n < 0) n += 10000;
        let out = 0;
        for (let d = 0; d < 4; d++) out |= (Math.floor(n / 10 ** d) % 10) << (d * 4);
        return out;
    }

    /** True when the counting element has reached terminal count. */
    _atZero() { return this.bcd ? (this.ce & 0xffff) === 0 : this.ce <= 0; }

    /**
     * GATE input. The level alone is not the whole story: modes 1 and 5 are
     * EDGE triggered and ignore the level afterwards, while 0 and 4 are level
     * gated, and 2 and 3 are both -- a low level forces OUT high and a rising
     * edge reloads. Modelling only the level (the previous behaviour, a bare
     * `if (!this.gate) return` in advance) makes a one-shot that can never
     * fire, because the edge that should arm it never reaches the counter.
     *
     * @param {0|1} level
     */
    setGate(level) {
        const lv = level ? 1 : 0;
        const rising = lv === 1 && this.gate === 0;
        const falling = lv === 0 && this.gate === 1;
        this.gate = lv;

        if (rising && (this.mode === 1 || this.mode === 5)) {
            // Retrigger: reload NOW, even mid-count. That is what makes mode 1
            // "hardware RETRIGGERABLE" -- each edge restarts the full period.
            this.ce = this._fullCount();
            this.nullCount = false;
            if (this.mode === 1) this._setOut(0);
        } else if (rising && (this.mode === 2 || this.mode === 3)) {
            this.ce = this._fullCount();
            this.phase = 'hi';
        } else if (falling && (this.mode === 2 || this.mode === 3)) {
            // A low gate does not merely pause these: OUT is forced high.
            this._setOut(1);
        }
    }

    _loadOnArm() {
        const count = this._fullCount();
        this.ce = count;
        this.nullCount = false;
        this.phase = 'hi';

        if (this.mode === 0) {
            this._setOut(0);
        }
    }

    read() {
        if (this.statusLatched !== null) {
            const v = this.statusLatched;
            this.statusLatched = null;
            return v;
        }
        const src = this.latched !== null ? this.latched : this.ce;
        let val;
        if (this.rw === 1) {
            val = src & 0xff;
            if (this.latched !== null) this.latched = null;
        } else if (this.rw === 2) {
            val = (src >> 8) & 0xff;
            if (this.latched !== null) this.latched = null;
        } else if (this.rw === 3) {
            if (this.rwPhase === 0) {
                val = src & 0xff;
                this.rwPhase = 1;
            } else {
                val = (src >> 8) & 0xff;
                this.rwPhase = 0;
                if (this.latched !== null) this.latched = null;
            }
        } else {
            val = src & 0xff;
        }
        return val & 0xff;
    }

    latchCount() {
        if (this.latched === null) this.latched = this.ce & 0xffff;
    }

    latchStatus() {
        if (this.statusLatched === null) {
            this.statusLatched =
                (this.out ? 0x80 : 0) |
                (this.nullCount ? 0x40 : 0) |
                (this.rw << 4) |
                (this.mode << 1) |
                this.bcd;
        }
    }

    advance(ticks) {
        if (this.nullCount) return;
        // Only modes 0, 2, 3 and 4 are LEVEL-gated. Modes 1 and 5 are started
        // by a gate EDGE and then count regardless of the level -- returning
        // early on a low gate froze the one-shot the edge had just armed.
        if (!this.gate && this.mode !== 1 && this.mode !== 5) return;

        for (let t = 0; t < ticks; t++) {
            this._tick();
        }
    }

    _tick() {
        const m = this.mode;
        if (m === 0) {
            if (!this._atZero()) {
                this.ce = this._dec(this.ce);
                if (this._atZero()) this._setOut(1);
            }
        } else if (m === 1) {
            // MODE 1 -- hardware retriggerable one-shot. The gate EDGE started
            // it (see setGate) and drove OUT low; it stays low for the whole
            // count and returns high at terminal count. Writing a new count
            // mid-shot does NOT shorten the current pulse -- it takes effect on
            // the next trigger, which is why this reads `ce` and never `reload`.
            if (!this._atZero()) {
                this.ce = this._dec(this.ce);
                if (this._atZero()) this._setOut(1);
            }
        } else if (m === 2) {
            // Rate generator: OUT high for (N-1), low for 1, reload.
            this.ce = this._dec(this.ce);
            if (this.bcd ? this._bcdToInt(this.ce) <= 1 : this.ce <= 1) {
                this._setOut(0);
                this.ce = this._fullCount();
                this._setOut(1);
            }
        } else if (m === 3) {
            // Square wave: toggle every (N/2) ticks.
            this.ce = this._dec(this.ce, 2);
            if (this.bcd ? this._bcdToInt(this.ce) <= 1 : this.ce <= 0) {
                this.ce = this._fullCount();
                this.out ^= 1;
                if (this.hooks.onOutput) this.hooks.onOutput(this.channel, this.out);
            }
        } else if (m === 4) {
            // Software triggered strobe: the COUNT WRITE starts it.
            if (!this._atZero()) {
                this.ce = this._dec(this.ce);
                if (this._atZero()) {
                    this._setOut(0);
                    this._setOut(1);
                }
            }
        } else if (m === 5) {
            // MODE 5 -- hardware triggered strobe. Same trigger as mode 1, but
            // OUT stays HIGH through the count and pulses low for exactly one
            // clock at terminal count. The difference from mode 1 is the SHAPE
            // of the pulse; the difference from mode 4 is that a gate edge
            // starts it rather than a count write.
            if (!this._atZero()) {
                this.ce = this._dec(this.ce);
                if (this._atZero()) {
                    this._setOut(0);
                    this._setOut(1);
                }
            }
        }
    }

    ticksToEdge() {
        if (this.nullCount || !this.gate) return Infinity;
        if (this.mode === 0) return this.ce > 0 ? this.ce : Infinity;
        if (this.mode === 2) return this.ce > 1 ? this.ce - 1 : 1;
        if (this.mode === 3) {
            const half = Math.ceil(this._fullCount() / 2);
            return this.ce > 0 ? Math.ceil(this.ce / 2) : half;
        }
        // Modes 1, 4 and 5 all end at terminal count. Reporting Infinity for
        // them -- which is what happened before, for 4 because it was written
        // that way and for 1 and 5 because they did not exist -- lets the pump
        // step straight past the pulse and notice it afterwards, if at all.
        if (this.mode === 1 || this.mode === 4 || this.mode === 5) {
            if (this._atZero()) return Infinity;
            return this.bcd ? this._bcdToInt(this.ce) : this.ce;
        }
        return Infinity;
    }

    _setOut(level) {
        if (this.out === level) return;
        this.out = level;
        if (this.hooks.onOutput) this.hooks.onOutput(this.channel, level);
    }

    getState() {
        return {
            mode: this.mode, rw: this.rw, bcd: this.bcd,
            reload: this.reload, ce: this.ce, out: this.out,
            armed: this.armed, phase: this.phase,
            rwPhase: this.rwPhase, latched: this.latched,
            statusLatched: this.statusLatched,
            nullCount: this.nullCount, gate: this.gate,
        };
    }

    setState(s) {
        this.mode = s.mode; this.rw = s.rw; this.bcd = s.bcd;
        this.reload = s.reload; this.ce = s.ce; this.out = s.out;
        this.armed = s.armed; this.phase = s.phase;
        this.rwPhase = s.rwPhase; this.latched = s.latched;
        this.statusLatched = s.statusLatched;
        this.nullCount = s.nullCount; this.gate = s.gate;
    }
}

export default I8254;
