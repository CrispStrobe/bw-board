/**
 * BasicMachineRunner — run a BASIC program on the emulated 6502 machine.
 *
 * The BASIC tab's real run path: not a JS reimplementation of BASIC, the
 * actual Microsoft BASIC V1.1 ROM (basic-m6502-bw, MIT) executing on
 * M6502Machine, with the user's program auto-typed in through the ACIA
 * the way a person at a terminal would enter it.
 *
 * Design constraints that shaped the API:
 *
 * - PROMPT-PACED, not delay-paced. The smoke scripts advance fixed
 *   milliseconds and hope; a runner that ships waits for the prompt
 *   text itself (MEMORY SIZE? / TERMINAL WIDTH? / OK) and only then
 *   answers. Fixed delays are kept only as inter-character pacing so
 *   the ACIA rx queue is consumed instead of overrun.
 *
 * - PUMPABLE. The machine is synchronous; a browser UI cannot block on
 *   a long RUN. start() arms the state machine, pump(sliceMs) advances
 *   one simulated-time slice and reports progress, so the app can pump
 *   from requestAnimationFrame and stay responsive. runToCompletion()
 *   is the convenience loop for tests and CI.
 *
 * - BUDGETED. 10 PRINT "X" 20 GOTO 10 never ends; the budget (simulated
 *   ms) converts that into done:false, reason:'budget' with the partial
 *   output — which is exactly what the user wants to see from such a
 *   program.
 *
 * - INPUT is scripted. MS BASIC's INPUT prints "? " and blocks on the
 *   ACIA. The runner feeds the next entry from opts.inputs when the
 *   output tail is a "? " prompt and the stream has stalled; a stall
 *   with no entries left ends the run with reason:'input-exhausted'
 *   (partial output preserved) rather than hanging the budget away.
 *
 * The ROM is not vendored here. Pass its bytes in — the app bundles
 * basic-m6502-bw's basic.rom (MIT); tests use the sibling checkout and
 * skip loudly when it is absent.
 */
import { M6502Machine, EATER6502 } from './m6502-machine.js';

/** Phases, in order: boot → ready → running → done. */

export const MS_PROFILE = {
    // Boot-time question/answer pairs, awaited in order.
    bootPrompts: [
        { expect: 'MEMORY SIZE?', send: '\r' },
        // This build prints bare "WIDTH?" (measured), not the
        // "TERMINAL WIDTH?" the old smoke-script comment claimed.
        { expect: 'WIDTH?', send: '\r' },
    ],
    // The immediate-mode prompt that means "BASIC is listening".
    ready: 'OK',
    runCommand: 'RUN\r',
    // MS BASIC 1.1 wants CR line endings and upper-case keywords work
    // everywhere; leave the program text as given otherwise.
    newline: '\r',
    // Keystroke pacing in simulated ms. This ROM's polling loop keeps
    // up at 4/30 (measured); a BeebEater-class BBC BASIC ROM on the
    // same machine DROPS characters after Enter unless typed at human
    // speed — its profile needs charMs 30 / crMs 300 (campaign log
    // 2026-08-14). Pacing is a profile property for exactly that
    // reason.
    charMs: 4,
    crMs: 30,
};

export class BasicMachineRunner {
    /**
     * @param {object} opts
     * @param {Uint8Array|Buffer} opts.rom       BASIC ROM image
     * @param {number} [opts.romBase]            load address (default 0x8000)
     * @param {object} [opts.config]             machine config (default EATER6502)
     * @param {object} [opts.profile]            prompt profile (default MS BASIC 1.1)
     */
    constructor({ rom, romBase = 0x8000, config = EATER6502, profile = MS_PROFILE }) {
        if (!rom || !rom.length) throw new Error('BasicMachineRunner: rom bytes required');
        this.profile = profile;
        this.raw = '';
        this.machine = new M6502Machine(config, {
            onSerial: (byte) => { this.raw += String.fromCharCode(byte & 0x7f); },
        });
        this.machine.loadRom(rom, romBase);
        this.machine.reset();
        this.phase = 'boot';
        this._bootIdx = 0;
        this._sendQueue = [];      // chars awaiting paced entry into the ACIA
        this._lines = [];          // program lines awaiting typing
        this._inputs = [];         // scripted INPUT answers
        this._runMark = 0;         // raw offset just after the RUN echo
        this._stallMs = 0;         // simulated ms since raw last grew
        this._lastRawLen = 0;
        this._budgetMs = 0;
        this._result = null;
    }

    /**
     * Arm a run. Call pump() until it reports done.
     * @param {string} program   BASIC source, any line-ending convention
     * @param {object} [opts]
     * @param {number} [opts.maxMs]    simulated-ms budget (default 30000)
     * @param {string[]} [opts.inputs] scripted answers for INPUT, in order
     */
    start(program, { maxMs = 30000, inputs = [] } = {}) {
        if (this._result) throw new Error('runner is single-shot: make a new one per run');
        this._lines = String(program).split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
        this._inputs = [...inputs];
        this._budgetMs = maxMs;
        return this;
    }

    /** Everything the machine printed, verbatim. */
    get rawOutput() { return this.raw; }

    /**
     * The program's own output: what followed the RUN echo, with the
     * closing immediate-mode prompt trimmed. Empty until 'running'.
     */
    get programOutput() {
        if (this._runMark === 0) return '';
        let s = this.raw.slice(this._runMark);
        s = s.replace(/\r?\n?OK\r?\n?\s*$/, '');
        return s.replace(/^[\r\n]+/, '');
    }

    /**
     * Advance one slice of simulated time and react to prompts.
     * @param {number} [sliceMs] simulated ms per call (default 50)
     * @returns {{phase: string, done: boolean, output: string,
     *            reason?: string}} reason is set once done:
     *            'ok' | 'budget' | 'input-exhausted' | 'no-ready-prompt'
     */
    pump(sliceMs = 50) {
        if (this._result) return this._result;
        const m = this.machine;

        // Paced character entry keeps the ACIA queue shallow (BASIC
        // polls every few hundred cycles; a whole line at once risks
        // the documented rx overrun) and honors the profile's typing
        // speed — CRs get the long gap because line processing (and on
        // some ROMs, a type-ahead flush) happens right after Enter.
        if (this._sendQueue.length) {
            const { charMs, crMs } = this.profile;
            let spent = 0;
            while (this._sendQueue.length && spent < sliceMs) {
                const ch = this._sendQueue.shift();
                m.chips.acia1.rxPush(ch.charCodeAt(0));
                const gap = ch === '\r' ? crMs : charMs;
                m.advanceToMs(m.tMs + gap);
                spent += gap;
            }
        } else {
            m.advanceToMs(m.tMs + sliceMs);
        }

        // Stall tracking (used for INPUT detection and budget messaging).
        if (this.raw.length !== this._lastRawLen) {
            this._lastRawLen = this.raw.length;
            this._stallMs = 0;
        } else {
            this._stallMs += sliceMs;
        }

        switch (this.phase) {
            case 'boot': {
                const p = this.profile.bootPrompts[this._bootIdx];
                if (!p) { this.phase = 'ready'; break; }
                if (this.raw.includes(p.expect)) {
                    this._send(p.send);
                    this._bootIdx += 1;
                    if (this._bootIdx >= this.profile.bootPrompts.length) this.phase = 'ready';
                } else if (m.tMs > 5000) {
                    return this._finish('no-ready-prompt');
                }
                break;
            }
            case 'ready': {
                // Wait for the immediate-mode prompt after the banner.
                // This ROM does NOT echo typed characters (measured), so
                // the moment we enqueue is the moment program output
                // begins: everything past this point in raw is the run.
                if (this._promptAt(this.raw.length) && !this._sendQueue.length) {
                    this._runMark = this.raw.length;
                    for (const line of this._lines) this._send(line + this.profile.newline);
                    this._send(this.profile.runCommand);
                    this.phase = 'running';
                    this._stallMs = 0;
                } else if (m.tMs > 8000) {
                    return this._finish('no-ready-prompt');
                }
                break;
            }
            case 'running': {
                // Nothing is decided while the program is still being
                // typed in — line entry is silent without echo.
                if (this._sendQueue.length) break;
                // Finished: the stream grew past the enqueue mark and the
                // tail is an immediate-mode prompt again (program ended
                // or errored — both are results, both are 'ok').
                if (this.raw.length > this._runMark
                    && this._promptAt(this.raw.length) && this._stallMs >= 100) {
                    return this._finish('ok');
                }
                // INPUT: "? " tail + stalled stream = BASIC is waiting.
                if (this._stallMs >= 200 && /\?\s?$/.test(this.raw)) {
                    if (this._inputs.length) {
                        this._send(this._inputs.shift() + this.profile.newline);
                        this._stallMs = 0;
                    } else {
                        return this._finish('input-exhausted');
                    }
                }
                break;
            }
            default: break;
        }

        if (m.tMs >= this._budgetMs) return this._finish('budget');
        return { phase: this.phase, done: false, output: this.programOutput };
    }

    /** Loop pump() to a terminal state. For tests, CI, and node tools. */
    runToCompletion(sliceMs = 50) {
        let r;
        do { r = this.pump(sliceMs); } while (!r.done);
        return r;
    }

    _send(s) { for (const ch of s) this._sendQueue.push(ch); }

    /** Is there an immediate-mode prompt just before offset `end`? */
    _promptAt(end) {
        const tail = this.raw.slice(Math.max(0, end - 16), end);
        const re = new RegExp(`${this.profile.ready}\\r?\\n?\\s*$`);
        return re.test(tail);
    }

    _finish(reason) {
        // A run that never reached RUN has no program output; show the
        // raw transcript instead so boot failures are diagnosable.
        const output = this._runMark ? this.programOutput : this.raw;
        this.phase = 'done';
        this._result = { phase: 'done', done: true, reason, output };
        return this._result;
    }
}

export default BasicMachineRunner;
