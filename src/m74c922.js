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
        const next = level ? 1 : 0;
        if (next === this.oeb) return;
        this.oeb = next;
        this._notify();
    }
}

const R_OUT = 50;
// Functional weak pull-up. The datasheet guarantees operation with switch
// resistance up to 50 kOhm but does not specify one fixed pull-up resistance.
const R_Y_PULLUP = 100_000;
const SCAN_STEP_NS = 125_000n; // 8 kHz external-clock abstraction (<10 kHz datasheet bound)

/**
 * Build the solver-facing 74C922 model.
 *
 * The real scan rate is selected by Cosc (or an external clock), and debounce
 * by Ckbm. Circuit device models cannot inspect another part's capacitance,
 * so this wrapper deliberately models neither RC duration. It uses the
 * datasheet's synchronous mode at a fixed 8 kHz, below its stated 10 kHz
 * external-clock ceiling; KBM/debounce remains defeated as documented by the
 * core. Four scheduled settle points expose the four open-drain columns to
 * the physical netlist. Using `_wakeNs` makes the result independent of
 * solver fixpoint count and of the
 * caller's advanceTo chunk size.
 */
export function createM74C922DeviceModel() {
    const terminals = ['y1','y2','y3','y4','osc','kbm','x4','x3','vss',
        'x2','x1','da','oeb','d','c','b','a','vcc'];
    const setDrive = (state, terminal, vTh, rTh) => {
        const old = state.drives[terminal];
        if (vTh === null) {
            if (old === null) return false;
            state.drives[terminal] = null;
            return true;
        }
        if (old && old.vTh === vTh && old.rTh === rTh) return false;
        state.drives[terminal] = {vTh, rTh};
        return true;
    };
    const publish = (state, vcc) => {
        let changed = setDrive(state, 'da', state.encoder.da ? vcc : 0, R_OUT);
        for (let bit = 0; bit < 4; bit++) {
            const terminal = ['a', 'b', 'c', 'd'][bit];
            const v = (state.encoder.code >> bit) & 1 ? vcc : 0;
            changed = (state.encoder.oeb ? setDrive(state, terminal, null, null) :
                setDrive(state, terminal, v, R_OUT)) || changed;
        }
        return changed;
    };
    const commitScan = state => {
        const next = new Set();
        for (let key = 0; key < 16; key++) if (state._scanMask & (1 << key)) next.add(key);
        if (state.encoder.registered !== null && !next.has(state.encoder.registered)) {
            state.encoder.release(state.encoder.registered);
        }
        for (const key of [...state.encoder.held]) if (!next.has(key)) state.encoder.release(key);
        for (const key of next) if (!state.encoder.held.has(key)) state.encoder.press(key);
        state._scanMask = 0;
    };
    return {
        terminals,
        init() {
            const drives = {
                a: {vTh: 0, rTh: R_OUT}, b: {vTh: 0, rTh: R_OUT},
                c: {vTh: 0, rTh: R_OUT}, d: {vTh: 0, rTh: R_OUT},
                da: {vTh: 0, rTh: R_OUT},
            };
            // X outputs are open drain: exactly one sinks while the others Z.
            for (let c = 1; c <= 4; c++) drives[`x${c}`] = c === 1 ? {vTh: 0, rTh: R_OUT} : null;
            for (let r = 1; r <= 4; r++) drives[`y${r}`] = {vTh: 5, rTh: R_Y_PULLUP};
            return {drives, encoder: new M74C922(), _column: 0, _scanMask: 0,
                _connectedY: [false, false, false, false], _wakeNs: 0n};
        },
        stamp(ctx, part, state) {
            // read() returns zero for a terminal with no net. Record topology
            // so an unwired Y is interpreted as its real internal pull-up,
            // not as a phantom closed key.
            for (let row = 0; row < 4; row++) {
                state._connectedY[row] = ctx.netFor(`y${row + 1}`) !== undefined;
            }
        },
        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5;
            let changed = false;
            const oeb = read('oeb') > vcc * 0.5 ? 1 : 0;
            if (oeb !== state.encoder.oeb) {
                state.encoder.setOeb(oeb);
                changed = true;
            }
            if (state._wakeNs !== null && tNs >= state._wakeNs) {
                const col = state._column;
                for (let row = 0; row < 4; row++) {
                    if (state._connectedY[row] && read(`y${row + 1}`) < vcc * 0.5) {
                        state._scanMask |= 1 << (row * 4 + col);
                    }
                }
                state._column = (col + 1) & 3;
                if (state._column === 0) commitScan(state);
                for (let c = 0; c < 4; c++) {
                    changed = (c === state._column ? setDrive(state, `x${c + 1}`, 0, R_OUT) :
                        setDrive(state, `x${c + 1}`, null, null)) || changed;
                }
                state._wakeNs = tNs + SCAN_STEP_NS;
            }
            return publish(state, vcc) || changed;
        },
    };
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
