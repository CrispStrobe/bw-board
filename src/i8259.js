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
 * ACCURACY TIER: SINGLE PIC, NO TRIGGER-MODE DISTINCTION. This line claimed
 * fixed priority for the first hours of 2026-09-05 -- after the same commit
 * implemented rotation. A summary that outlived the code it summarised, in a
 * header I had just rewritten, hours after a peer warned me headers do that.
 *
 * It is worded to AVOID repeating the phrases below, because a capability
 * gate anchors on those and an anchor that matches twice survives deletion of
 * the line it exists to pin. My first correction here restated both of them
 * and took each from two matches to three, which is the same mistake with
 * more words. The ICW1-4 initialisation
 * sequence, OCW1 masking, OCW2 specific and non-specific EOI, OCW3 read-
 * register selection, the ISR/IRR bookkeeping, auto-EOI, and the init-phase
 * gating (a chip mid-ICW-sequence does not interrupt) are all exact. What is
 * NOT here, named rather than left to be discovered:
 *
 *   - ROTATION, POLL AND SPECIAL MASK MODE ADDED 2026-09-05. All eight OCW2
 *     commands act: both rotate-on-EOI forms, set-priority, and rotate-in-
 *     auto-EOI as an armed MODE rather than an action. Every priority decision
 *     goes through one `_priorityOrder()`, because `acknowledge()` and
 *     `_updateInt` previously walked 0..7 in two separate hardcoded loops that
 *     agreed only by coincidence -- rotation would have made them disagree,
 *     with the INT line and the vector it delivered naming different levels.
 *     A poll READ acknowledges, exactly as an INTA does.
 *   - The default is still IR0-highest, which is what an XT programs, so the
 *     rotating machinery costs nothing until a program asks for it.
 *   - ONE CONTROLLER. ICW3 is consumed but no cascaded slave is modelled —
 *     an XT's second PIC, and the buffered / special-fully-nested modes, are
 *     absent.
 *   - LEVEL-SENSED. A request is taken from its IRR bit; the edge-vs-level
 *     (LTIM) trigger distinction is not modelled.
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
        // ROTATION. The level that currently holds LOWEST priority; service
        // order runs from (lowestPriority + 1) upward, wrapping. 7 gives the
        // fixed default of IR0-highest, which is what an XT programs, so the
        // rotating machinery costs nothing until a program asks for it.
        this.lowestPriority = 7;
        // AUTO-ROTATE in auto-EOI mode (OCW2 cmd 4 sets, cmd 0 clears).
        this.rotateOnAutoEOI = false;
        // POLL MODE. Set by OCW3 bit 2 and consumed by the NEXT read, which
        // returns a poll word instead of IRR/ISR and acknowledges as an INTA
        // would. It is one-shot: the datasheet's P bit applies to the next
        // read only, and a sticky flag would turn every later read into an
        // unintended acknowledge.
        this.pollPending = false;
        // SPECIAL MASK MODE (OCW3 bits 6-5). While set, a masked level stops
        // blocking LOWER priorities -- the mechanism a handler uses to let
        // less urgent interrupts in while it is still in service.
        this.specialMask = false;
    }

    /**
     * The eight levels in CURRENT priority order, highest first. Every
     * priority decision goes through this, so rotation is one variable rather
     * than a second code path.
     *
     * `acknowledge()` used to walk 0..7 directly while `_updateInt` walked
     * 0..7 with an ISR-blocking check -- two orders that agreed only because
     * both were hardcoded. Rotation would have made them disagree.
     */
    _priorityOrder() {
        const out = [];
        for (let n = 1; n <= 8; n++) out.push((this.lowestPriority + n) & 7);
        return out;
    }

    /** The highest-priority level that is pending and not blocked, or -1. */
    _serviceable() {
        if (this._initPhase !== 0) return -1;
        const pending = this.irr & ~this.imr;
        for (const i of this._priorityOrder()) {
            if (!(pending & (1 << i))) continue;
            // Anything of higher-or-equal priority already in service blocks
            // this one. In SPECIAL MASK MODE a MASKED in-service level does
            // not block, which is the whole point of the mode.
            let blocked = false;
            for (const j of this._priorityOrder()) {
                if (j === i) break;
                if (!(this.isr & (1 << j))) continue;
                if (this.specialMask && (this.imr & (1 << j))) continue;
                blocked = true; break;
            }
            if (this.isr & (1 << i)) blocked = true;
            if (!blocked) return i;
        }
        return -1;
    }

    /** @param {number} reg A0 line: 0 or 1 */
    read(reg) {
        // A POLL READ IS AN ACKNOWLEDGE, and that is the whole point of the
        // mode: bit 7 says whether anything is pending, bits 2-0 name the
        // level, and the chip sets ISR exactly as an INTA cycle would. A
        // program polling this way never enables INTR at all.
        //
        // It answers on EITHER address. The poll word replaces whatever that
        // read would have returned, so an armed poll consumes the next read
        // wherever it lands rather than waiting for the "right" port.
        if (this.pollPending) {
            this.pollPending = false;
            const i = this._serviceable();
            if (i === -1) return 0x00;               // bit 7 clear: nothing pending
            this.irr &= ~(1 << i);
            if (this.autoEOI) {
                if (this.rotateOnAutoEOI) this.lowestPriority = i;
            } else {
                this.isr |= (1 << i);
            }
            this._updateInt();
            return 0x80 | i;
        }
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
            // OCW3: bit 3 set.
            // SPECIAL MASK MODE: bit 6 (ESMM) enables the write, bit 5 (SMM)
            // is the value. Writing SMM without ESMM changes nothing, which is
            // the datasheet's own guard against a stray OCW3 toggling it.
            if (val & 0x40) this.specialMask = !!(val & 0x20);
            if (val & 0x02) {
                this.readISR = !!(val & 0x01);
            }
            // POLL (bit 2). Arms the NEXT read to return a poll word and
            // acknowledge, which is how a program services interrupts with
            // INTR masked off entirely. One-shot on purpose: the P bit applies
            // to the next read, and a sticky flag would turn every subsequent
            // IRR/ISR read into an unintended acknowledge.
            if (val & 0x04) this.pollPending = true;
            // SPECIAL MASK MODE CHANGES WHAT IS SERVICEABLE, so INT has to be
            // re-evaluated here. The OCW3 branch used to return without it,
            // which was harmless while the only thing OCW3 did was select
            // which register a read returns -- and became a stale INT line the
            // moment OCW3 could change priority. Caught by the test asserting
            // intActive rather than asserting the flag.
            this._updateInt();
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

    /**
     * OCW2, all eight commands. Bits 7-5 are R, SL and EOI:
     *
     *   000  rotate in auto-EOI mode -- CLEAR
     *   001  non-specific EOI
     *   010  no operation
     *   011  specific EOI            (level in bits 2-0)
     *   100  rotate in auto-EOI mode -- SET
     *   101  rotate on non-specific EOI
     *   110  set priority            (named level becomes LOWEST)
     *   111  rotate on specific EOI  (level in bits 2-0)
     *
     * "Non-specific" means the chip clears the highest-priority bit currently
     * in service, which is not the lowest-numbered one once priority has
     * rotated -- so it walks _priorityOrder(), not 0..7.
     */
    _ocw2(val) {
        const cmd = (val >> 5) & 7;
        const level = val & 7;

        // The highest-priority level currently IN SERVICE, in the current
        // rotation. -1 when nothing is.
        const topInService = () => {
            for (const i of this._priorityOrder()) if (this.isr & (1 << i)) return i;
            return -1;
        };

        if (cmd === 0 || cmd === 4) {
            // Rotate-in-auto-EOI is a MODE, not an action: it arms rotation
            // for future auto-EOI dismissals and dismisses nothing now.
            this.rotateOnAutoEOI = cmd === 4;
            return;
        }
        if (cmd === 2) return;                       // explicit no-op
        if (cmd === 6) {                             // set priority
            this.lowestPriority = level;
            this._updateInt();
            return;
        }

        if (cmd === 1 || cmd === 5) {                // non-specific EOI
            const i = topInService();
            if (i !== -1) {
                this.isr &= ~(1 << i);
                if (cmd === 5) this.lowestPriority = i;
            }
        } else if (cmd === 3 || cmd === 7) {         // specific EOI
            this.isr &= ~(1 << level);
            // Rotate on SPECIFIC EOI rotates to the NAMED level whether or not
            // it was in service -- the command carries the level, so there is
            // nothing to look up and nothing to fail silently.
            if (cmd === 7) this.lowestPriority = level;
        }
        this._updateInt();
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
        const i = this._serviceable();
        if (i === -1) return this.vectorBase | 7;   // spurious
        // Block this in IRR only if it was edge-triggered (in level mode the
        // device keeps it asserted). For simplicity, clear it — the device
        // can reassert.
        this.irr &= ~(1 << i);
        if (this.autoEOI) {
            // AUTO-ROTATE: in auto-EOI mode with rotation armed, the level
            // just serviced drops to lowest priority as it is dismissed.
            if (this.rotateOnAutoEOI) this.lowestPriority = i;
        } else {
            this.isr |= (1 << i);
        }
        this._updateInt();
        return this.vectorBase | i;
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
        const hasPending = this._serviceable() !== -1;
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
            // Added with rotation/poll/special-mask 2026-09-05. A checkpoint
            // that omits these restores a chip whose PRIORITY ORDER is wrong
            // and whose registers all look right -- the machine runs and
            // services interrupts in a different order than it saved. Silent,
            // and exactly the corruption the checkpoint refusal exists to stop.
            lowestPriority: this.lowestPriority,
            rotateOnAutoEOI: this.rotateOnAutoEOI,
            pollPending: this.pollPending,
            specialMask: this.specialMask,
        };
    }

    setState(s) {
        this.irr = s.irr; this.isr = s.isr; this.imr = s.imr;
        this.vectorBase = s.vectorBase; this.icw4 = s.icw4;
        this.autoEOI = s.autoEOI; this.readISR = s.readISR;
        this._needICW3 = s.needICW3;
        this._needICW4 = s.needICW4; this._intActive = s.intActive;
        // `?? default` rather than a bare assignment: an OLD checkpoint,
        // written before these fields existed, must restore to the FIXED
        // priority it was saved under, not to `undefined` -- which would make
        // _priorityOrder produce NaN levels and the chip service nothing.
        this.lowestPriority = s.lowestPriority ?? 7;
        this.rotateOnAutoEOI = s.rotateOnAutoEOI ?? false;
        this.pollPending = s.pollPending ?? false;
        this.specialMask = s.specialMask ?? false;
        this._setInitPhase(s.initPhase);   // restores initWarning to match
    }
}

export default I8259;
