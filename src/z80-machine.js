/**
 * The composable Z80 machine — the 6502 machine's pattern with the Z80's
 * twist: chips live in PORT space (IORQ), memory regions in MEMORY space
 * (MREQ), because that is how the real breadboard decodes. A config is
 * { clockHz, regions, ports }; the SEARLE preset is the canonical
 * minimal build the whole scene descends from (Grant Searle's 7-chip
 * design, RC2014's ancestor): ROM low, RAM high, an MC6850 ACIA at
 * ports $80/$81. The design facts are architecture (freely modeled);
 * his ROM software is NOT ours to ship — the machine boots whatever
 * image the caller provides.
 *
 * Interrupts: IM 1 (the scene's idiom) — any chip asserting IRQ makes
 * the CPU take RST $38 when IFF1 is set; IM 0/2 and NMI can come later
 * with a config knob. The core itself stays interrupt-agnostic; delivery
 * lives here.
 *
 * @module
 */
import { Z80 } from './z80.js';
import { MC6850 } from './mc6850.js';
import { Z80CTC } from './z80-ctc.js';
import { ZXULA } from './zx-ula.js';
import { ZXTape } from './zx-tape.js';

export const SEARLE = Object.freeze({
    clockHz: 7_372_800,
    regions: [
        { kind: 'rom', start: 0x0000, end: 0x1fff },
        { kind: 'ram', start: 0x2000, end: 0xffff },
    ],
    ports: [
        { kind: 'acia6850', name: 'acia1', at: 0x80 },   // $80 ctrl/status, $81 data
    ],
});

/** CP/M 64K preset — all RAM (CP/M needs to write page zero at $0000),
 *  MC6850 ACIA at $80/$81 for console, same clock as the SEARLE board.
 *  Disk I/O uses ports $10–$15 handled by the host (not modeled here). */
export const CPM64K = Object.freeze({
    clockHz: 7_372_800,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0xffff },
    ],
    ports: [
        { kind: 'acia6850', name: 'acia1', at: 0x80 },
    ],
});

export class Z80Machine {
    /** Every scalar the core carries — the snapshot contract. */
    static CPU_STATE = [
        'a', 'f', 'b', 'c', 'd', 'e', 'h', 'l',
        'a_', 'f_', 'b_', 'c_', 'd_', 'e_', 'h_', 'l_',
        'ix', 'iy', 'sp', 'pc', 'i', 'r', 'wz',
        'iff1', 'iff2', 'im', 'q', 'eiLatch', 'halted', 'cycles',
    ];

    /** @param {typeof SEARLE} [config]
     *  @param {{ onSerial?: (byte:number, tMs:number)=>void }} [hooks] */
    constructor(config = SEARLE, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.clockHz = config.clockHz;
        this.mem = new Uint8Array(65536);
        this.cycles = 0;
        /** @type {Record<string, MC6850>} */
        this.chips = {};
        this._portMap = new Map();
        for (const p of config.ports || []) {
            if (p.kind === 'acia6850') {
                const chip = new MC6850({
                    onTx: (b) => { if (this.hooks.onSerial) this.hooks.onSerial(b, this.tMs); },
                });
                this.chips[p.name] = chip;
                this._portMap.set(p.at & 0xff, { chip, rs: 0 });
                this._portMap.set((p.at + 1) & 0xff, { chip, rs: 1 });
            } else if (p.kind === 'ctc') {
                // Z8430: four consecutive ports, one per channel. The
                // scheduler timebase the Z80 emitter axis waits on.
                const chip = new Z80CTC({ clockHz: config.clockHz });
                this.chips[p.name] = chip;
                for (let ch = 0; ch < 4; ch++) {
                    this._portMap.set((p.at + ch) & 0xff, { chip, rs: ch });
                }
            } else {
                throw new Error(`unknown port chip kind: ${p.kind}`);
            }
        }
        // A Spectrum-shaped machine: config.ula = true attaches the ULA,
        // which decodes ONLY A0 (every even port) and shares the
        // machine's memory for the live screen.
        this.ula = config.ula ? new ZXULA(this.mem) : null;
        if (this.ula) this.chips.ula = this.ula;
        this.tape = null; // insertTape() attaches; the $0556 trap consumes
        this._romRanges = (config.regions || []).filter((r) => r.kind === 'rom');
        this.cpu = new Z80({
            read: (a) => this.mem[a & 0xffff],
            write: (a, v) => {
                a &= 0xffff;
                for (const r of this._romRanges) if (a >= r.start && a <= r.end) return;
                this.mem[a] = v & 0xff;
            },
            in: (port) => {
                if (this.ula && (port & 1) === 0) return this.ula.in(port);
                const e = this._portMap.get(port & 0xff);
                return e ? e.chip.read(e.rs) : 0xff;
            },
            out: (port, v) => {
                if (this.ula && (port & 1) === 0) { this.ula.out(port, v, this.cycles); return; }
                const e = this._portMap.get(port & 0xff);
                if (e) e.chip.write(e.rs, v);
            },
        });
    }

    get tMs() { return this.cycles * 1000 / this.clockHz; }

    /** Load an image into memory (ROM regions included — loading is not a bus write). */
    load(bytes, at = 0) { this.mem.set(bytes.subarray ? bytes.subarray(0, 65536 - at) : bytes, at); }

    /** Insert a .TAP; the $0556 trap serves blocks in order. */
    insertTape(tapBuf) { this.tape = new ZXTape(tapBuf); }

    /**
     * Snapshot the whole machine — CPU, memory, ULA, tape position —
     * as a plain JSON-able object (mem is a Uint8Array; the caller
     * chooses the encoding). The point: a 7-emulated-minute boot
     * (Abersoft compiling tron from tape) becomes a one-time cost,
     * restored in milliseconds. Chips with their own saveState()
     * are included; chips without are skipped, so restore only a
     * machine whose transient chip state doesn't matter — or teach
     * the chip to snapshot.
     */
    saveState() {
        const cpu = {};
        for (const k of Z80Machine.CPU_STATE) cpu[k] = this.cpu[k] ?? 0;
        const chips = {};
        for (const [name, c] of Object.entries(this.chips)) {
            if (typeof c.saveState === 'function') chips[name] = c.saveState();
        }
        return {
            v: 1,
            cpu,
            cycles: this.cycles,
            mem: this.mem.slice(),
            tapePos: this.tape ? this.tape.pos : null,
            chips,
        };
    }

    /** Restore a saveState() snapshot onto an identically-built machine
     *  (same config, same ROM load, same insertTape call). */
    loadState(s) {
        if (s.v !== 1) throw new Error(`unknown machine state version ${s.v}`);
        for (const k of Z80Machine.CPU_STATE) this.cpu[k] = s.cpu[k] ?? 0;
        this.cycles = s.cycles;
        this.mem.set(s.mem);
        if (s.tapePos != null) {
            if (!this.tape) throw new Error('snapshot has a tape position but no tape is inserted');
            this.tape.pos = s.tapePos;
        }
        for (const [name, cs] of Object.entries(s.chips ?? {})) {
            const c = this.chips[name];
            if (c && typeof c.loadState === 'function') c.loadState(cs);
        }
    }

    _advanceChips(n) {
        for (const k of Object.keys(this.chips)) {
            const c = this.chips[k];
            if (typeof c.advance === 'function') c.advance(n);
        }
    }

    _anyIrq() {
        for (const k of Object.keys(this.chips)) if (this.chips[k].irqAsserted) return true;
        return false;
    }

    /** One instruction; IM 1 delivery when a chip asserts and IFF1 is set. */
    step() {
        if (this.cpu.halted && !(this._anyIrq() && this.cpu.iff1)) {
            this.cycles += 4;               // HALT burns NOPs until an interrupt
            this._advanceChips(4);
            return 4;
        }
        if (this._anyIrq() && this.cpu.iff1 && !this.cpu.eiLatch) {
            this.cpu.halted = false;
            this.cpu.iff1 = 0; this.cpu.iff2 = 0;
            this.cpu._push16(this.cpu.pc);
            if (this.cpu.im === 2) {
                // IM 2: the interrupting chip supplies the vector byte
                // (Z8430 daisy chain — ackVector also clears the
                // channel); the handler address comes from the table at
                // I:vector. 19 cycles per the Z80 manual.
                let vec = 0xff;
                for (const k of Object.keys(this.chips)) {
                    const c = this.chips[k];
                    if (c.irqAsserted && typeof c.ackVector === 'function') { vec = c.ackVector(); break; }
                }
                const at = ((this.cpu.i & 0xff) << 8) | (vec & 0xfe);
                this.cpu.pc = this.mem[at] | (this.mem[at + 1] << 8);
                this.cpu.wz = this.cpu.pc;
                this.cycles += 19;
                this._advanceChips(19);
                return 19;
            }
            // IM 1 acknowledge: RST $38, 13 cycles.
            this.cpu.pc = 0x0038;
            this.cpu.wz = 0x0038;
            this.cycles += 13;
            this._advanceChips(13);
            return 13;
        }
        // LD-BYTES fast-load trap: with a tape inserted, entering the
        // ROM's loader at $0556 loads the next block instantly and RETs.
        if (this.tape && this.cpu.pc === 0x0556 && this.ula) {
            this.tape.trap(this.cpu, this.mem);
            this.cpu.pc = this.cpu._pop16();
            this.cycles += 100; // a token cost; the real routine took minutes
            this._advanceChips(100);
            return 100;
        }
        const n = this.cpu.step();
        this.cycles += n;
        this._advanceChips(n);
        return n;
    }

    advanceToMs(tMs) {
        const target = Math.ceil(tMs * this.clockHz / 1000);
        while (this.cycles < target) this.step();
    }
}

export default Z80Machine;
