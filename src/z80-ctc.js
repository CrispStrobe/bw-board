/**
 * Z8430 CTC — the Z80 family's counter/timer, four channels.
 *
 * Clean-room from the Zilog Z8430/Z84C30 CTC datasheet (the control
 * word, §"CTC Operating Modes" and the programming section):
 *
 * - Each channel has one 8-bit control register, an 8-bit time
 *   constant (TC), and an 8-bit down-counter readable at any time.
 * - Control word (bit 0 = 1 distinguishes it from a vector write):
 *     bit7 interrupt enable      bit3 timer trigger (wait for CLK/TRG)
 *     bit6 mode: 1=counter,0=timer  bit2 TC follows this word
 *     bit5 prescaler: 1=256,0=16 bit1 software reset
 *     bit4 CLK/TRG edge          bit0 = 1 (control)
 * - A write with bit 0 = 0 to CHANNEL 0 sets the interrupt vector
 *   base; on acknowledge the CTC supplies base | (channel << 1)
 *   (IM2 daisy chain; channel 0 has highest priority).
 * - Timer mode: the down-counter is clocked by the SYSTEM clock
 *   through the prescaler; reaching zero reloads TC and pulses
 *   ZC/TO + raises the interrupt (if enabled). TC = 0 means 256.
 * - Counter mode counts external CLK/TRG edges. No external sources
 *   are modelled yet, so a counter-mode channel simply does not
 *   advance — a NAMED limitation (state.notes), not silent wrongness.
 *
 * The scheduler timebase pattern this enables (the Z80 flavor's
 * bw_now, mirroring the 6502's VIA-T1 polling): program a timer
 * channel with prescaler 256; poll the down-counter; a read LARGER
 * than the previous read means the counter reloaded — count reloads,
 * each worth TC*prescale/clockHz seconds. ISR-free.
 */

export class Z80CTC {
    /** @param {{ clockHz?: number }} [opts] system clock feeding the prescaler */
    constructor({ clockHz = 4_000_000 } = {}) {
        this.clockHz = clockHz;
        this.vector = 0;
        this.notes = [];
        this.ch = Array.from({ length: 4 }, () => ({
            control: 0,
            tc: 0,             // programmed time constant (0 = 256)
            count: 0,          // live down-counter
            running: false,
            expectTc: false,   // next write is the time constant
            irq: false,        // zero-count reached with IE set
            _acc: 0,           // sub-prescale cycle accumulator
        }));
    }

    /** @param {number} n channel 0-3 @param {number} val byte */
    write(n, val) {
        const c = this.ch[n & 3];
        val &= 0xff;
        if (c.expectTc) {
            c.expectTc = false;
            c.tc = val;
            // Timer mode without the trigger bit starts on TC load.
            if ((c.control & 0x40) === 0 && (c.control & 0x08) === 0) {
                // TC 0 means 256: starting at 0, the &0xff decrement
                // walk makes the full-length period emerge naturally.
                c.count = val;
                c._acc = 0;
                c.running = true;
            } else if (c.control & 0x40) {
                if (!this.notes.includes('counter-mode')) {
                    this.notes.push('counter-mode'); // named: no external CLK/TRG modelled
                }
            }
            return;
        }
        if ((val & 0x01) === 0) {
            // Vector write — channel 0 only per the datasheet; other
            // channels ignore it (their bit 0 = 0 writes are no-ops).
            if ((n & 3) === 0) this.vector = val & 0xf8;
            return;
        }
        c.control = val;
        if (val & 0x02) { // software reset: stop, clear pending state
            c.running = false;
            c.irq = false;
        }
        if (val & 0x04) c.expectTc = true;
    }

    /** Reading a channel returns the live down-count (datasheet). */
    read(n) {
        const c = this.ch[n & 3];
        return c.count & 0xff;
    }

    /** IM2 vector for the highest-priority interrupting channel. */
    ackVector() {
        for (let n = 0; n < 4; n++) {
            if (this.ch[n].irq) { this.ch[n].irq = false; return this.vector | (n << 1); }
        }
        return this.vector;
    }

    get irqAsserted() { return this.ch.some((c) => c.irq && (c.control & 0x80)); }

    /** @param {number} cycles system-clock cycles elapsed */
    advance(cycles) {
        for (const c of this.ch) {
            if (!c.running || (c.control & 0x40)) continue; // stopped or counter mode
            const prescale = (c.control & 0x20) ? 256 : 16;
            c._acc += cycles;
            while (c._acc >= prescale) {
                c._acc -= prescale;
                c.count = (c.count - 1) & 0xff;
                if (c.count === 0) {
                    c.count = c.tc; // reload (0 rolls as 256 via the & 0xff walk)
                    if (c.control & 0x80) c.irq = true;
                }
            }
        }
    }
}

export default Z80CTC;
