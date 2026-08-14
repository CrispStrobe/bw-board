/**
 * 74HC374 octal D flip-flop as a write-only output port — the pre-VIA
 * output rung of the breadboard ladders (a byte-wide latch of LEDs at a
 * partially-decoded address; the cool-web-shape 6502 hangs it in a
 * $7xxx window, the Searle-lineage Z80s put one on an OUT port).
 *
 * From the bus side it is exactly this small: a write clocks D0-D7 into
 * the latch and the Q pins follow (/OE strapped low in these builds); a
 * READ of the same address does not drive the data bus at all — the '374's
 * outputs face the LEDs, not the bus — so the model returns open-bus 0xff
 * and the machine's decode owns the address either way.
 *
 * @module
 */

export class Latch374 {
    /** @param {{ onChange?: (value: number, prev: number) => void }} [hooks] */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.value = 0; // '374 powers up indeterminate on silicon; 0 is the
        // documented simulator convention (same as the port chips).
    }

    read() { return 0xff; }

    /** @param {number} _reg ignored — one register, however wide the window */
    write(_reg, val) {
        const prev = this.value;
        this.value = val & 0xff;
        if (this.value !== prev && this.hooks.onChange) this.hooks.onChange(this.value, prev);
    }

    get irqAsserted() { return false; }
}

export default Latch374;
