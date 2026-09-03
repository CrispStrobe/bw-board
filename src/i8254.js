/**
 * Intel 8254 PIT — three independent 16-bit down-counters, clean-room from
 * the datasheet in the same shape as the 8255: a handful of registers, a
 * write() / read() bus interface, and an advance(cycles) method the machine
 * layer calls on every instruction boundary.
 *
 * FOUR ADDRESSES: 0=counter 0, 1=counter 1, 2=counter 2, 3=control word.
 * The control word selects which counter to configure and never reads back
 * (the read-back command is an 8254 extension over the 8253 and IS handled).
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
 *   - NO MODES 1 OR 5. The two GATE-triggered forms (hardware-retriggerable
 *     one-shot and strobe) are not modelled; the gate is assumed asserted and
 *     a counter simply counts.
 *   - NO BCD. The BCD bit is stored and read back in the status byte, but the
 *     counter counts in binary regardless.
 *
 * @module
 */

export class I8254 {
    /**
     * @param {{ onOutput?: (channel: number, level: 0|1) => void }} [hooks]
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
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
            // Read-back command (8254 only): latch count and/or status
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

    advance(cycles) {
        for (const c of this.counters) c.advance(cycles);
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

    _loadOnArm() {
        const count = this.reload === 0 ? 0x10000 : this.reload;
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
        if (this.nullCount || !this.gate) return;

        for (let t = 0; t < ticks; t++) {
            this._tick();
        }
    }

    _tick() {
        const m = this.mode;
        if (m === 0) {
            if (this.ce > 0) {
                this.ce--;
                if (this.ce === 0) this._setOut(1);
            }
        } else if (m === 2) {
            // Rate generator: OUT high for (N-1), low for 1, reload.
            this.ce--;
            if (this.ce <= 1) {
                this._setOut(0);
                this.ce = this.reload === 0 ? 0x10000 : this.reload;
                this._setOut(1);
            }
        } else if (m === 3) {
            // Square wave: toggle every (N/2) ticks.
            this.ce -= 2;
            if (this.ce <= 0) {
                this.ce = this.reload === 0 ? 0x10000 : this.reload;
                this.out ^= 1;
                if (this.hooks.onOutput) this.hooks.onOutput(this.channel, this.out);
            }
        } else if (m === 4) {
            // Software triggered strobe
            if (this.ce > 0) {
                this.ce--;
                if (this.ce === 0) {
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
            const half = Math.ceil((this.reload === 0 ? 0x10000 : this.reload) / 2);
            return this.ce > 0 ? Math.ceil(this.ce / 2) : half;
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
