/**
 * BbcZ80Runner — run a BASIC program under R.T. Russell's BBC BASIC
 * (Z80) on our vector-complete Z80 core, over the minimal CP/M BDOS
 * console shim (the classic emu-CP/M trick the bbcz80-smoke proved:
 * page zero JP 0005 → trap PC at the BDOS entry, service the call in
 * JS, RET).
 *
 * The point: BBCBASIC.COM is ZLIB-LICENSED and prebuilt in rtrussell/
 * BBCZ80 — unlike the Acorn BBC BASIC 4 ROM (which boots on the 6502
 * machine only as a local-artifact smoke and can never ship), this one
 * the app may bundle. So the BASIC editor's BBC profile gets the same
 * real-machine run path MS BASIC got from BasicMachineRunner.
 *
 * Same API contract as BasicMachineRunner — start() / pump() / result
 * {phase, done, reason, output} — so the app wires one shape and picks
 * the runner by profile. Differences forced by the interpreter:
 *
 * - pump() advances INSTRUCTIONS, not simulated milliseconds (the
 *   shim's world has no clock; budget and slice are instruction
 *   counts).
 * - Program lines are fed PROMPT BY PROMPT: BBC BASIC flushes
 *   type-ahead after Enter (measured in the smoke), so queuing the
 *   whole program at once silently loses lines. The runner waits for
 *   each '>' before sending the next line.
 * - The interpreter POLLS the console (BDOS 6, E=0xFF) rather than
 *   blocking at the prompt (measured: a waiting-signal design burned
 *   its whole budget at '>'), so line feeding is driven by a prompt
 *   flag maintained in the emit path — "last output was '>' at line
 *   start" — while blocking reads (readline fn 10, i.e. INPUT) still
 *   deliver a positive waiting signal for scripted answers.
 */
import { Z80 } from './z80.js';

const BDOS = 0xfe00;

export class BbcZ80Runner {
    /**
     * @param {object} opts
     * @param {Uint8Array|Buffer} opts.com  BBCBASIC.COM image (zlib, rtrussell/BBCZ80)
     */
    constructor({ com }) {
        if (!com || !com.length) throw new Error('BbcZ80Runner: BBCBASIC.COM bytes required');
        this.mem = new Uint8Array(65536);
        this.mem.set(com, 0x0100);
        this.mem[0x0000] = 0x76; // warm-boot trap (checked by PC, not executed)
        this.mem[0x0005] = 0xc3; this.mem[0x0006] = BDOS & 0xff; this.mem[0x0007] = BDOS >> 8;
        this.mem[BDOS] = 0xc9;
        this.cpu = new Z80({
            read: (a) => this.mem[a & 0xffff],
            write: (a, v) => { this.mem[a & 0xffff] = v & 0xff; },
        });
        this.cpu.pc = 0x0100;
        this.cpu.sp = 0xfdff;
        this.raw = '';
        this._keys = [];
        this._lines = [];
        this._inputs = [];
        this._runMark = 0;
        this._budget = 0;
        this._spent = 0;
        this._result = null;
        this._prevCh = 10;
        this._tailPrompt = false;
        this.phase = 'boot';
    }

    /**
     * @param {string} program  BASIC source (numbered lines, any line endings)
     * @param {object} [opts]
     * @param {number} [opts.maxSteps]  instruction budget (default 200M ≈ seconds of 4MHz Z80)
     * @param {string[]} [opts.inputs]  scripted INPUT answers, in order
     */
    start(program, { maxSteps = 200_000_000, inputs = [] } = {}) {
        if (this._result) throw new Error('runner is single-shot: make a new one per run');
        this._lines = String(program).split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
        this._inputs = [...inputs];
        this._budget = maxSteps;
        return this;
    }

    get rawOutput() { return this.raw; }

    /** Output after the RUN echo, with the trailing prompt trimmed. */
    get programOutput() {
        if (this._runMark === 0) return '';
        return this.raw.slice(this._runMark).replace(/\r?\n?>\s*$/, '').replace(/^[\r\n]+/, '');
    }

    /**
     * Advance up to `steps` instructions.
     * @returns {{phase: string, done: boolean, output: string, reason?: string}}
     *          reason: 'ok' | 'budget' | 'input-exhausted' | 'exit' | 'no-ready-prompt'
     */
    pump(steps = 500_000) {
        if (this._result) return this._result;
        const cpu = this.cpu;
        let n = 0;
        while (n < steps && this._spent < this._budget) {
            // The prompt flag is raised by the emit path; feeding is
            // decided here because the interpreter polls rather than
            // blocks — there is no wait event to hang feeding on.
            if (this._tailPrompt && !this._keys.length) {
                const fed = this._atPrompt();
                if (fed === 'done') return this._finish('ok');
            }
            if (cpu.pc === BDOS) {
                const r = this._bdos();
                if (r === 'exit') return this._finish('exit');
                if (r === 'waiting') {
                    // A BLOCKING read ran dry: readline (fn 10) — INPUT.
                    if (this.phase === 'running') {
                        if (this._inputs.length) { this._type(`${this._inputs.shift()}\r`); continue; }
                        return this._finish('input-exhausted');
                    }
                    // Blocking read outside a run without a prompt shown
                    // is a deadlock — nothing fed would be a command.
                    return this._finish('no-ready-prompt');
                }
                // Polling variant of the same wait: many consecutive dry
                // non-blocking reads with zero output in between.
                if (this.phase === 'running' && (this._dryPolls || 0) > 1000) {
                    if (this._inputs.length) { this._type(`${this._inputs.shift()}\r`); this._dryPolls = 0; continue; }
                    return this._finish('input-exhausted');
                }
                n++; this._spent++;
                continue;
            }
            if (cpu.pc === 0x0000) return this._finish('exit');
            cpu.step();
            n++; this._spent++;
        }
        if (this._spent >= this._budget) return this._finish('budget');
        return { phase: this.phase, done: false, output: this.programOutput };
    }

    runToCompletion(steps = 2_000_000) {
        let r;
        do { r = this.pump(steps); } while (!r.done);
        return r;
    }

    /** The interpreter is sitting at a fresh '>' with nothing queued. */
    _atPrompt() {
        this._tailPrompt = false;
        if (this.phase === 'boot') this.phase = 'typing';
        if (this.phase === 'typing') {
            if (this._lines.length) {
                this._type(`${this._lines.shift()}\r`);
            } else {
                this._runMark = -1; // armed: set when the RUN echo completes
                this._type('RUN\r');
                this.phase = 'running';
            }
            return 'fed';
        }
        // running: back at the prompt = the program ended (or errored —
        // both are results, both are 'ok').
        return 'done';
    }

    _type(s) { for (const ch of s) this._keys.push(ch.charCodeAt(0)); }

    _emit(ch) {
        this._dryPolls = 0;
        this.raw += String.fromCharCode(ch);
        // Prompt = '>' immediately after a line break (a mid-line '>'
        // printed by the program does not raise the flag).
        this._tailPrompt = (ch === 0x3e && (this._prevCh === 10 || this._prevCh === 13));
        this._prevCh = ch;
        // The RUN echo just completed: program output starts here.
        if (this._runMark === -1 && /RUN\r?\n$/.test(this.raw)) this._runMark = this.raw.length;
    }

    /** One BDOS call. Returns 'exit' | 'waiting' | null. */
    _bdos() {
        const cpu = this.cpu; const mem = this.mem; const keys = this._keys;
        const ret = () => { cpu.pc = cpu._pop16(); };
        const setA = (v) => { cpu.a = v & 0xff; cpu.l = v & 0xff; };
        switch (cpu.c) {
            case 0: return 'exit';
            case 1:
                if (!keys.length) { ret(); cpu.pc = 0x0005; return 'waiting'; }
                setA(keys.shift());
                break;
            case 2: this._emit(cpu.e); break;
            case 6:
                if (cpu.e === 0xff) {
                    // Non-blocking read. INPUT polls this in a tight loop
                    // (measured — it never blocks), so consecutive dry
                    // polls with no output are the "waiting for input"
                    // signal the pump loop acts on.
                    if (keys.length) { setA(keys.shift()); this._dryPolls = 0; }
                    else { setA(0); this._dryPolls = (this._dryPolls || 0) + 1; }
                } else if (cpu.e === 0xfe) setA(keys.length ? 0xff : 0);
                else if (cpu.e === 0xfd) {
                    if (!keys.length) { ret(); cpu.pc = 0x0005; return 'waiting'; }
                    setA(keys.shift());
                } else this._emit(cpu.e);
                break;
            case 9: {
                let a = cpu.de;
                for (let i = 0; i < 4096; i++) {
                    const ch = mem[a];
                    if (ch === 0x24) break;
                    this._emit(ch);
                    a = (a + 1) & 0xffff;
                }
                break;
            }
            case 10: {
                const buf = cpu.de;
                const max = mem[buf];
                let count = 0;
                while (count < max) {
                    if (!keys.length) { ret(); cpu.pc = 0x0005; return 'waiting'; }
                    const ch = keys.shift();
                    if (ch === 13) break;
                    mem[(buf + 2 + count) & 0xffff] = ch;
                    this._emit(ch);
                    count++;
                }
                mem[(buf + 1) & 0xffff] = count;
                this._emit(13); this._emit(10);
                break;
            }
            case 11: setA(keys.length ? 0xff : 0); break;
            case 12: cpu.hl = 0x0022; setA(0x22); break;
            default: setA(0); break; // disk and misc stubs
        }
        ret();
        return null;
    }

    _finish(reason) {
        const output = (this._runMark > 0) ? this.programOutput : this.raw;
        this.phase = 'done';
        this._result = { phase: 'done', done: true, reason, output };
        return this._result;
    }
}

export default BbcZ80Runner;
