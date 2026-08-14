/**
 * PS/2 keyboard + the breadboard capture chain — our own model of the
 * published PS/2 protocol (IBM's Code Set 2 scan codes, 11-bit frames:
 * start 0, eight data bits LSB-first, odd parity, stop 1; the DEVICE
 * drives the clock at 10-16 kHz, so a whole frame takes ~0.7-1.1 ms).
 *
 * Two pieces, split exactly where the breadboards split them:
 *
 *   PS2Keyboard — the device. keyDown/keyUp by key name emit make/break
 *   scan-code byte sequences (break = F0 prefix, extended keys = E0);
 *   bytes queue and are DELIVERED WITH KEYBOARD PACING, one frame per
 *   ~gap of machine cycles — the real inter-frame time is what gives an
 *   ISR room to run, and collapsing it to zero would manufacture
 *   overruns no real build sees.
 *
 *   PS2Capture — the shift-register front-end the 6502 builds hang off
 *   the bus or a VIA: the Vectron's 74HC595-pair + 74LS161 bit counter,
 *   the KiT's chained 74HC164s. It genuinely reconstructs the byte from
 *   the LSB-first bit stream and checks odd parity (the real chain
 *   shifts exactly these bits), raises DATA AVAILABLE after bit 11, and
 *   re-strobes per frame so an edge-triggered CA1 sees every byte.
 *
 * Host-to-device commands (LED setting, typematic config) are
 * deliberately unmodeled — the breadboard chains are receive-only by
 * construction, with the clock line never driven by the host. Typematic
 * repeat is the keyboard's own business and also unmodeled; callers hold
 * a key by simply not releasing it.
 *
 * @module
 */

/** Code Set 2 make codes — published standard, facts. */
export const SCAN_CODES = Object.freeze({
    a: 0x1c, b: 0x32, c: 0x21, d: 0x23, e: 0x24, f: 0x2b, g: 0x34,
    h: 0x33, i: 0x43, j: 0x3b, k: 0x42, l: 0x4b, m: 0x3a, n: 0x31,
    o: 0x44, p: 0x4d, q: 0x15, r: 0x2d, s: 0x1b, t: 0x2c, u: 0x3c,
    v: 0x2a, w: 0x1d, x: 0x22, y: 0x35, z: 0x1a,
    0: 0x45, 1: 0x16, 2: 0x1e, 3: 0x26, 4: 0x25, 5: 0x2e, 6: 0x36,
    7: 0x3d, 8: 0x3e, 9: 0x46,
    enter: 0x5a, space: 0x29, escape: 0x76, backspace: 0x66, tab: 0x0d,
    minus: 0x4e, equals: 0x55, comma: 0x41, period: 0x49, slash: 0x4a,
    semicolon: 0x4c, quote: 0x52, backtick: 0x0e, backslash: 0x5d,
    lbracket: 0x54, rbracket: 0x5b,
    lshift: 0x12, rshift: 0x59, lctrl: 0x14, lalt: 0x11, capslock: 0x58,
    f1: 0x05, f2: 0x06, f3: 0x04, f4: 0x0c, f5: 0x03, f6: 0x0b,
    f7: 0x83, f8: 0x0a, f9: 0x01, f10: 0x09, f11: 0x78, f12: 0x07,
});

/** Extended (E0-prefixed) make codes. */
export const SCAN_CODES_E0 = Object.freeze({
    up: 0x75, down: 0x72, left: 0x6b, right: 0x74,
    insert: 0x70, delete: 0x71, home: 0x6c, end: 0x69,
    pageup: 0x7d, pagedown: 0x7a,
    rctrl: 0x14, ralt: 0x11,
});

export class PS2Keyboard {
    constructor() {
        /** @type {number[]} scan-code bytes awaiting transmission */
        this.fifo = [];
    }

    _codeFor(key) {
        if (key in SCAN_CODES) return { code: SCAN_CODES[key], e0: false };
        if (key in SCAN_CODES_E0) return { code: SCAN_CODES_E0[key], e0: true };
        throw new Error(`ps2: unknown key name '${key}'`);
    }

    /** @param {string} key a SCAN_CODES/SCAN_CODES_E0 name */
    keyDown(key) {
        const { code, e0 } = this._codeFor(key);
        if (e0) this.fifo.push(0xe0);
        this.fifo.push(code);
    }

    /** @param {string} key */
    keyUp(key) {
        const { code, e0 } = this._codeFor(key);
        if (e0) this.fifo.push(0xe0);
        this.fifo.push(0xf0, code);
    }

    /** Convenience: make+break for each character of plain lowercase/digit text. */
    type(text) {
        for (const ch of text) {
            const key = ch === ' ' ? 'space' : ch === '\n' ? 'enter' : ch;
            this.keyDown(key);
            this.keyUp(key);
        }
    }
}

/**
 * The 11-bit shift-register capture. Attach to a machine with
 * machine.attachDevice() so advance() gets cycle time; pacing defaults
 * to ~1 ms of frames at 1 MHz (real PS/2 clock arithmetic).
 */
export class PS2Capture {
    /**
     * @param {PS2Keyboard} keyboard
     * @param {{ onByte?: (byte: number, parityOk: boolean) => void,
     *           onDa?: (level: 0|1) => void,
     *           gapCycles?: number }} [hooks]
     */
    constructor(keyboard, hooks = {}) {
        this.kbd = keyboard;
        this.hooks = hooks;
        this.gapCycles = hooks.gapCycles || 1000;
        this.idle = 0;
        this.byte = 0;
        this.parityOk = true;
        this.da = 0;
    }

    _setDa(level) {
        if (this.da === level) return;
        this.da = level;
        if (this.hooks.onDa) this.hooks.onDa(level);
    }

    /** Shift one frame through, exactly as the chain would see the wire. */
    _shiftFrame(byte) {
        // Device side: serialize LSB-first with odd parity.
        const bits = [0];                                  // start
        let ones = 0;
        for (let i = 0; i < 8; i++) { const b = (byte >> i) & 1; ones += b; bits.push(b); }
        bits.push(ones % 2 === 0 ? 1 : 0);                 // odd parity
        bits.push(1);                                      // stop
        // Chain side: reconstruct from the stream — no shortcut through
        // the original byte, so a framing/parity bug here would be caught.
        let sr = 0;
        for (const bit of bits) sr = ((sr << 1) | bit) & 0x7ff;
        const data = [];
        for (let i = 0; i < 8; i++) data.push((sr >> (9 - i)) & 1); // LSB sent first
        const value = data.reduce((v, b, i) => v | (b << i), 0);
        const parity = (sr >> 1) & 1;
        const dataOnes = data.reduce((s, b) => s + b, 0);
        return { value, parityOk: (dataOnes + parity) % 2 === 1 };
    }

    /** @param {number} cycles machine cycles elapsed */
    advance(cycles) {
        this.idle += cycles;
        if (this.idle < this.gapCycles || !this.kbd.fifo.length) return;
        this.idle = 0;
        this._setDa(0);                                    // re-strobe per frame
        const { value, parityOk } = this._shiftFrame(this.kbd.fifo.shift());
        this.byte = value;
        this.parityOk = parityOk;
        if (this.hooks.onByte) this.hooks.onByte(value, parityOk);
        this._setDa(1);
    }
}

/**
 * The KiT-shape wiring: captured byte onto a VIA port's eight inputs,
 * DATA AVAILABLE onto a control line (CA1 in the build). Wiring facts.
 *
 * @param {PS2Keyboard} keyboard
 * @param {import('./w65c22.js').W65C22} via
 * @param {{ port?: 'a'|'b', control?: 'ca1'|'ca2'|'cb1'|'cb2', gapCycles?: number }} [opts]
 */
export function ps2OnVia(keyboard, via, opts = {}) {
    const port = opts.port || 'a';
    const control = opts.control || 'ca1';
    const cap = new PS2Capture(keyboard, {
        gapCycles: opts.gapCycles,
        onByte: (byte) => {
            for (let i = 0; i < 8; i++) via.setInput(port, i, (byte >> i) & 1);
        },
        onDa: (level) => via.setControl(control, level),
    });
    for (let i = 0; i < 8; i++) via.setInput(port, i, 0);
    via.setControl(control, 0);
    return cap;
}

export default PS2Keyboard;
