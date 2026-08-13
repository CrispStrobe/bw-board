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
            if (p.kind !== 'acia6850') throw new Error(`unknown port chip kind: ${p.kind}`);
            const chip = new MC6850({
                onTx: (b) => { if (this.hooks.onSerial) this.hooks.onSerial(b, this.tMs); },
            });
            this.chips[p.name] = chip;
            this._portMap.set(p.at & 0xff, { chip, rs: 0 });
            this._portMap.set((p.at + 1) & 0xff, { chip, rs: 1 });
        }
        this._romRanges = (config.regions || []).filter((r) => r.kind === 'rom');
        this.cpu = new Z80({
            read: (a) => this.mem[a & 0xffff],
            write: (a, v) => {
                a &= 0xffff;
                for (const r of this._romRanges) if (a >= r.start && a <= r.end) return;
                this.mem[a] = v & 0xff;
            },
            in: (port) => {
                const e = this._portMap.get(port & 0xff);
                return e ? e.chip.read(e.rs) : 0xff;
            },
            out: (port, v) => {
                const e = this._portMap.get(port & 0xff);
                if (e) e.chip.write(e.rs, v);
            },
        });
    }

    get tMs() { return this.cycles * 1000 / this.clockHz; }

    /** Load an image into memory (ROM regions included — loading is not a bus write). */
    load(bytes, at = 0) { this.mem.set(bytes.subarray ? bytes.subarray(0, 65536 - at) : bytes, at); }

    _anyIrq() {
        for (const k of Object.keys(this.chips)) if (this.chips[k].irqAsserted) return true;
        return false;
    }

    /** One instruction; IM 1 delivery when a chip asserts and IFF1 is set. */
    step() {
        if (this.cpu.halted && !(this._anyIrq() && this.cpu.iff1)) {
            this.cycles += 4;               // HALT burns NOPs until an interrupt
            return 4;
        }
        if (this._anyIrq() && this.cpu.iff1 && !this.cpu.eiLatch) {
            // IM 1 acknowledge: RST $38, IFF1/IFF2 cleared, 13 cycles.
            this.cpu.halted = false;
            this.cpu.iff1 = 0; this.cpu.iff2 = 0;
            this.cpu._push16(this.cpu.pc);
            this.cpu.pc = 0x0038;
            this.cpu.wz = 0x0038;
            this.cycles += 13;
            return 13;
        }
        const n = this.cpu.step();
        this.cycles += n;
        return n;
    }

    advanceToMs(tMs) {
        const target = Math.ceil(tMs * this.clockHz / 1000);
        while (this.cycles < target) this.step();
    }
}

export default Z80Machine;
