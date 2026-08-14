/**
 * 74C922 16-key keypad encoder — our own model from the National MM74C922
 * datasheet. The chip that turns an EATER6502-class build into a KIM-1:
 * it scans a 4×4 matrix, debounces, and presents the key number as a
 * 4-bit code (DCBA) with a DATA AVAILABLE strobe — wired in the breadboard
 * builds to VIA PA0-PA3 with DA on CA1 for the keypress interrupt.
 *
 * Datasheet behavior modeled:
 *   - Key code = row*4 + col in the X1-X4/Y1-Y4 scan order (D..A = code
 *     bits 3..0). What character that MEANS is the keycap layout's
 *     business, i.e. the ROM's lookup table, not the chip's.
 *   - DA rises when a debounced key is registered and FALLS on release.
 *   - Two-key rollover, datasheet style: while a key is held, additional
 *     presses are IGNORED (not queued); releasing the registered key with
 *     another still down registers that one and pulses DA for it.
 *   - Outputs are three-state via /OE; disabled outputs read as 0xf here
 *     (pulled-up bus) — the DA line is NOT gated by /OE, per datasheet.
 *
 * Deliberately unmodeled, stated: the oscillator/debounce capacitor pins
 * (debounce is instantaneous at instruction-stepped fidelity — a press IS
 * a debounced press) and the scan clock itself.
 *
 * @module
 */

export class M74C922 {
    /** @param {{ onChange?: (code: number, da: 0|1) => void }} [hooks]
     *  onChange fires on every registered-key or DA transition. */
    constructor(hooks = {}) {
        this.hooks = hooks;
        /** @type {Set<number>} keys currently physically held (0-15) */
        this.held = new Set();
        /** @type {number|null} the key the encoder has registered */
        this.registered = null;
        this.oeb = 0; // /OE low = outputs enabled (the usual strapping)
    }

    get da() { return this.registered === null ? 0 : 1; }

    /** 4-bit code on the output pins (0xf when three-stated). */
    get code() {
        if (this.oeb) return 0xf;
        return this.registered === null ? 0 : this.registered & 0xf;
    }

    _notify() { if (this.hooks.onChange) this.hooks.onChange(this.code, this.da); }

    /** @param {number} key 0-15 (row*4+col) */
    press(key) {
        key &= 0xf;
        this.held.add(key);
        if (this.registered === null) {
            this.registered = key;
            this._notify();
        }
        // else: rollover — ignored while another key is registered
    }

    /** @param {number} key 0-15 */
    release(key) {
        key &= 0xf;
        this.held.delete(key);
        if (this.registered !== key) return;
        if (this.held.size) {
            // DA must FALL between registrations or an edge-triggered CA1
            // never sees the second key. The real chip's scan does this in
            // passing; we do it explicitly.
            this.registered = null;
            this._notify();
            this.registered = this.held.values().next().value;
            this._notify();
        } else {
            this.registered = null;
            this._notify();
        }
    }

    /** @param {0|1} level three-state control, active low */
    setOeb(level) {
        this.oeb = level ? 1 : 0;
        this._notify();
    }
}

/**
 * The canonical breadboard wiring: code bits onto four VIA port-A inputs,
 * DA onto a VIA control line (CA1 in the builds; rising edge = keypress).
 * Returns the encoder wired up. Wiring facts, not any build's code.
 *
 * @param {import('./w65c22.js').W65C22} via
 * @param {{ bits?: [number,number,number,number], port?: 'a'|'b',
 *           control?: 'ca1'|'ca2'|'cb1'|'cb2' }} [opts]
 */
export function keypadOnVia(via, opts = {}) {
    const bits = opts.bits || [0, 1, 2, 3];
    const port = opts.port || 'a';
    const control = opts.control || 'ca1';
    const enc = new M74C922({
        onChange: (code, da) => {
            for (let i = 0; i < 4; i++) via.setInput(port, bits[i], (code >> i) & 1);
            via.setControl(control, da);
        },
    });
    // Establish the idle levels so the first edge is a real edge.
    for (let i = 0; i < 4; i++) via.setInput(port, bits[i], 0);
    via.setControl(control, 0);
    return enc;
}

export default M74C922;
