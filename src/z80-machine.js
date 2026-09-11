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
import { logicalTimeDomain } from './instruction-debug-events.js';
import { MC6850 } from './mc6850.js';
import { Z80CTC } from './z80-ctc.js';
import { MC6845 } from './mc6845.js';
import { ZXULA } from './zx-ula.js';
import { ZXTape } from './zx-tape.js';
import { AY38912 } from './ay-3-8912.js';
import { Latch374 } from './latch374.js';
import { Buffer244 } from './buffer244.js';
import {
    MACHINE_CHECKPOINT_SCHEMA, checkpointRefusal, checkpointSupport, cloneCheckpointValue,
    checkpointTopology, statePair, validateCheckpointEnvelope, validateCheckpointState
} from './machine-checkpoint.js';

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

/**
 * SAME TICK COUNT, EITHER SPELLING. `debugTime()` returns a BigInt and a machine
 * counts in Numbers, so a checkpoint whose `time` a debug bridge supplied
 * carries BigInt ticks while `state.cycles` is a Number — and `!==` between them
 * is false for identical digits. Landed 2026-09-10, this refused every
 * debug-target checkpoint restore on m6502 and z80 with
 * INVALID_CHECKPOINT_TIME while both values printed the same number.
 *
 * The consumer layer already had this compensation in five separate places
 * (run-to.js accepts `Number.isSafeInteger(t) || typeof t === 'bigint'`); the
 * machines did not, because until the read and the stamp agreed on type nobody
 * had ever handed them a BigInt.
 */
const sameTicks = (a, b) => {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
        // The a-side guard is INERT TODAY and is recorded as inert rather than
        // removed: `state.cycles` is always a Number, so reaching it needs a
        // BigInt on the b side, which no machine here produces. It exists
        // because BigInt(1.5) THROWS rather than returning false, so the day a
        // machine counts in BigInt its absence is a crash and not a refusal.
        if (!(typeof a === 'bigint' || Number.isSafeInteger(a))) return false;
        if (!(typeof b === 'bigint' || Number.isSafeInteger(b))) return false;
        return BigInt(a) === BigInt(b);
    }
    return a === b;
};

export class Z80Machine {
    /** Every scalar the core carries — the snapshot contract. */
    static CPU_STATE = [
        'a', 'f', 'b', 'c', 'd', 'e', 'h', 'l',
        'a_', 'f_', 'b_', 'c_', 'd_', 'e_', 'h_', 'l_',
        'ix', 'iy', 'sp', 'pc', 'i', 'r', 'wz',
        'iff1', 'iff2', 'im', 'q', 'eiLatch', 'halted', 'cycles',
    ];

    /** @param {typeof SEARLE} [config]
     *  @param {{ onSerial?: (byte:number, tMs:number)=>void,
     *            onPinChange?: (pin:string, level:0|1, tMs:number)=>void }} [hooks] */
    constructor(config = SEARLE, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.clockHz = config.clockHz;
        this.mem = new Uint8Array(65536);
        this.cycles = 0;
        /** @type {Record<string, MC6850>} */
        this.chips = {};
        // Built on first use, NOT here: config validation later in this
        // constructor can throw, and a schedule built now would describe a
        // board that is about to be rejected. See i8086-machine.js for the
        // full note; the hazard is silent, so it is recorded at both sites.
        this._advList = null;   // hot-loop caches; see _buildHotLists
        this._irqList = null;
        this._portMap = new Map();
        // Direction-aware port slots: a read-strobed chip (74HC244 IN) and
        // a write-strobed chip (74HC374 OUT) legally share one port — IN
        // and OUT decode to different silicon on real boards, and the
        // extractor's contention rules allow exactly that pair. A single
        // last-wins slot sent OUT (0),A into the buffer's no-op write and
        // the LEDs never lit. Level-selected chips claim both sides.
        const mapPort = (port, entry, sides = 'rw') => {
            const key = port & 0xff;
            const slot = this._portMap.get(key) || {};
            if (sides.includes('r')) slot.r = entry;
            if (sides.includes('w')) slot.w = entry;
            this._portMap.set(key, slot);
        };
        for (const p of config.ports || []) {
            if (p.kind === 'acia6850') {
                const chip = new MC6850({
                    onTx: (b) => { if (this.hooks.onSerial) this.hooks.onSerial(b, this.tMs); },
                });
                this.chips[p.name] = chip;
                mapPort(p.at, { chip, rs: 0 });
                mapPort(p.at + 1, { chip, rs: 1 });
            } else if (p.kind === 'crtc') {
                // MC6845: address/data port pair. On the real board the
                // CRTC only GENERATES addresses — the framebuffer is
                // shared system RAM — so the chip's vram becomes a live
                // subarray view of machine memory at p.vramAt: CPU
                // stores appear on screen with no copying, exactly like
                // the silicon. vramSize must be a power of two (the
                // chip masks addresses with length-1).
                const vramAt = p.vramAt ?? 0xf000;
                const vramSize = p.vramSize ?? 0x0800;
                const charset = p.charset instanceof Uint8Array ? p.charset : undefined;
                const chip = new MC6845({ clockHz: config.clockHz, vramSize, charH: p.charH, charset });
                chip.vram = this.mem.subarray(vramAt, vramAt + vramSize);
                this.chips[p.name] = chip;
                mapPort(p.at, { chip, rs: 0 });
                mapPort(p.at + 1, { chip, rs: 1 });
            } else if (p.kind === 'latch') {
                // 74HC374 as a write-only OUT port — the first program of
                // every Searle-lineage build: OUT (n),A lights eight LEDs.
                // Same chip class and the same Q-pin emission contract as
                // the 6502 machine's latch, so an attached board's
                // chip-qualified pins light whatever the bench wires to Q.
                const chip = new Latch374({
                    onChange: (value, prev) => this._latchChange(p.name, value, prev),
                });
                this.chips[p.name] = chip;
                mapPort(p.at, { chip, rs: 0 }, 'w');
            } else if (p.kind === 'buffer') {
                // 74HC244 as a read-only IN port — the input mirror of
                // the '374 latch. read() samples the board's pins via
                // the onRead hook; the adapter wires the hook to
                // board.readPin for each A-input.
                const chip = new Buffer244({
                    onRead: () => {
                        if (!this.hooks.onBufferRead) return 0xff;
                        return this.hooks.onBufferRead(p.name);
                    },
                });
                this.chips[p.name] = chip;
                mapPort(p.at, { chip, rs: 0 }, 'r');
            } else if (p.kind === 'ctc') {
                // Z8430: four consecutive ports, one per channel. The
                // scheduler timebase the Z80 emitter axis waits on.
                const chip = new Z80CTC({ clockHz: config.clockHz });
                this.chips[p.name] = chip;
                for (let ch = 0; ch < 4; ch++) {
                    mapPort(p.at + ch, { chip, rs: ch });
                }
            } else {
                throw new Error(`unknown port chip kind: ${p.kind}`);
            }
        }
        // A Spectrum-shaped machine: config.ula = true attaches the ULA,
        // which decodes ONLY A0 (every even port) and shares the
        // machine's memory for the live screen.
        //
        // config.zx128 = true builds the 128K memory model on top:
        // 8×16K RAM pages, two 16K ROMs, port $7FFD banking. The flat
        // 64K keeps holding the two FIXED windows — page 5 at $4000 and
        // page 2 at $8000 are subarray VIEWS into it, so the 48K screen
        // path, tape trap and debug reads stay truthful there — while
        // $C000 pages and the ROM window go through the bus closures.
        this._zx128 = !!config.zx128;
        if (this._zx128) {
            this.pages = Array.from({ length: 8 }, (_, i) =>
                i === 5 ? this.mem.subarray(0x4000, 0x8000)
                    : i === 2 ? this.mem.subarray(0x8000, 0xc000)
                        : new Uint8Array(16384));
            this.roms = [new Uint8Array(16384), new Uint8Array(16384)];
            this._bank = { page: 0, rom: 0, shadow: 0, locked: 0 };
        }
        this.ula = (config.ula || this._zx128)
            ? new ZXULA(this.mem, this._zx128 ? { frameTstates: 70908 } : {})
            : null;
        if (this.ula) this.chips.ula = this.ula;
        // Kempston joystick (config.kempston, default ON with the ULA):
        // the interface most archive games probe. Decoded the classic
        // way — A5 low on an ODD port (the ULA owns even ports) — and
        // read as 000FUDLR active-HIGH, idle $00.
        this._kempston = (config.kempston ?? !!config.ula) ? 0 : null;
        // AY-3-8912 PSG: always present on 128K machines. Port decode
        // per the 128K schematic: $FFFD (A15=1,A14=1,A1=0) = select/read,
        // $BFFD (A15=1,A14=0,A1=0) = data write.
        this.ay = this._zx128 ? new AY38912({ clockHz: config.clockHz }) : null;
        if (this.ay) this.chips.ay = this.ay;
        this.tape = null; // insertTape() attaches; the $0556 trap consumes
        // Generic PC traps — the $0556 tape trap's mechanism, opened up:
        // addr → handler(machine) returning the cycles consumed (>0 =
        // handled, instruction skipped; falsy = fall through and execute
        // normally). The CP/M BDOS console shim is the first tenant.
        this.pcTraps = new Map();
        this._romRanges = (config.regions || []).filter((r) => r.kind === 'rom');
        const read48 = (a) => this.mem[a & 0xffff];
        const write48 = (a, v) => {
            a &= 0xffff;
            for (const r of this._romRanges) if (a >= r.start && a <= r.end) return;
            this.mem[a] = v & 0xff;
        };
        const read128 = (a) => {
            a &= 0xffff;
            if (a < 0x4000) return this.roms[this._bank.rom][a];
            if (a < 0xc000) return this.mem[a];
            return this.pages[this._bank.page][a - 0xc000];
        };
        const write128 = (a, v) => {
            a &= 0xffff;
            if (a < 0x4000) return; // ROM
            if (a < 0xc000) { this.mem[a] = v & 0xff; return; }
            this.pages[this._bank.page][a - 0xc000] = v & 0xff;
        };
        this.readBus = this._zx128 ? read128 : read48;
        this.writeBus = this._zx128 ? write128 : write48;

        // Contention: opt-in via config.contention. Wraps bus callbacks
        // to add ULA wait-state penalties on contended-range accesses.
        // Per-instruction approximation (see spec-updates/ula-contention.md).
        this._contention = !!(config.contention && this.ula);
        const isContended = this._zx128
            ? (a) => { // 128K: pages 1,3,5,7 are contended
                a &= 0xffff;
                if (a >= 0x4000 && a < 0x8000) return true; // page 5 (always mapped)
                if (a >= 0xc000) return (this._bank.page & 1) === 1;
                return false;
              }
            : (a) => (a & 0xffff) >= 0x4000 && (a & 0xffff) < 0x8000;

        const applyContention = (a) => {
            if (!this._contention || !isContended(a)) return;
            const penalty = this.ula.contend(this.cycles % this.ula._frameTstates);
            if (penalty > 0) this.cycles += penalty;
        };

        const readContended = (a) => { applyContention(a); return this.readBus(a); };
        const writeContended = (a, v) => { applyContention(a); return this.writeBus(a, v); };

        const readFn = this._contention ? readContended : this.readBus;
        const writeFn = this._contention ? writeContended : this.writeBus;

        this.cpu = new Z80({
            read: readFn,
            write: writeFn,
            in: (port) => {
                // Port contention: even ports (ULA-decoded) are contended
                if (this._contention && (port & 1) === 0) applyContention(0x4000);
                if (this.ula && (port & 1) === 0) return this.ula.in(port);
                if (this._kempston !== null && (port & 0x21) === 0x01) return this._kempston;
                // AY read: $FFFD (A15=1, A14=1, A1=0)
                if (this.ay && (port & 0xc002) === 0xc000) return this.ay.read();
                const slot = this._portMap.get(port & 0xff);
                const e = slot && (slot.r || slot.w);
                return e ? e.chip.read(e.rs) : 0xff;
            },
            out: (port, v) => {
                if (this._contention && (port & 1) === 0) applyContention(0x4000);
                if (this.ula && (port & 1) === 0) { this.ula.out(port, v, this.cycles); return; }
                // 128K banking: $7FFD partial decode (A15 and A1 low),
                // write-only, dead once the lock bit has been set.
                if (this._zx128 && (port & 0x8002) === 0) { this._setBank(v); return; }
                // AY select: $FFFD (A15=1, A14=1, A1=0)
                if (this.ay && (port & 0xc002) === 0xc000) { this.ay.select(v); return; }
                // AY data: $BFFD (A15=1, A14=0, A1=0)
                if (this.ay && (port & 0xc002) === 0x8000) { this.ay.write(v); return; }
                const slot = this._portMap.get(port & 0xff);
                const e = slot && (slot.w || slot.r);
                if (e) e.chip.write(e.rs, v);
            },
        });
    }

    get tMs() { return this.cycles * 1000 / this.clockHz; }

    /** Latch outputs as pin edges — Q, not P: a '374 output is always
     *  driven, no DDR exists. Identical contract to the 6502 machine. */
    _latchChange(chipName, value, prev) {
        if (!this.hooks.onPinChange) return;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if ((value & mask) === (prev & mask)) continue;
            this.hooks.onPinChange(`${chipName}.Q${bit}`, value & mask ? 1 : 0, this.tMs);
        }
    }

    /** Load an image into memory (ROM regions included — loading is not a bus write). */
    load(bytes, at = 0) { this.mem.set(bytes.subarray ? bytes.subarray(0, 65536 - at) : bytes, at); }

    /** Insert a .TAP; the $0556 trap serves blocks in order. */
    insertTape(tapBuf) { this.tape = new ZXTape(tapBuf); }

    /** OUT $7FFD: bits 0-2 page at $C000, bit 3 shadow screen (page 7),
     *  bit 4 ROM select, bit 5 lock-until-reset. */
    _setBank(v) {
        if (this._bank.locked) return;
        this._bank.page = v & 0x07;
        this._bank.rom = (v >> 4) & 1;
        const shadow = (v >> 3) & 1;
        if (shadow !== this._bank.shadow) {
            this._bank.shadow = shadow;
            this.ula.screen = shadow ? this.pages[7] : this.mem.subarray(0x4000, 0x8000);
        }
        this._bank.locked = (v >> 5) & 1;
    }

    /** Load a 16K ROM image into slot 0 (128 editor) or 1 (48 BASIC). */
    loadRom128(slot, bytes) {
        if (!this._zx128) throw new Error('loadRom128 needs a zx128 machine');
        this.roms[slot & 1].set(bytes.subarray(0, 16384));
    }

    /**
     * Face-input contract, joystick side: the same button mask the
     * 6502 machines take (bit0 down, bit1 up, bit2 right, bit3 left,
     * bit4 fire) mapped onto Kempston bit order (000FUDLR). False
     * when the machine has no Kempston interface.
     */
    /**
     * Can this machine take a button mask at all?
     *
     * Asked BEFORE a host offers buttons, so the offer matches the board — the
     * shape `I8086Machine.canTakeKeys()` already has, and for the same reason.
     * Without it a caller can only find out by calling `setButtons` and reading
     * the answer, which is too late for anything that wants to act on the
     * capability rather than on the outcome: a face that advertises a control
     * the board cannot take, or a recorder that logs a press nothing received.
     *
     * A board has a Kempston port when the config asks for one or when it has a
     * ULA (z80-machine.js constructor); without it the read at 0x1f is unmapped
     * and there is nowhere for a mask to go.
     *
     * @returns {boolean}
     */
    canTakeButtons() { return this._kempston !== null; }

    setButtons(mask) {
        if (!this.canTakeButtons()) return false;
        this._kempston =
            ((mask >> 2) & 1)          // right
            | (((mask >> 3) & 1) << 1) // left
            | ((mask & 1) << 2)        // down
            | (((mask >> 1) & 1) << 3) // up
            | (mask & 0x10);           // fire
        return true;
    }

    checkpointSupport() {
        const reasons = [];
        if (this.pcTraps.size) reasons.push('host PC traps may own state outside the machine');
        if (this._unloggedBoardInputs) reasons.push('live board buffer-input sampling is not logged');
        return checkpointSupport(this.chips, this.devices, reasons);
    }

    checkpointTopology() {
        return checkpointTopology('z80', this.config, this.chips, this.devices, {
            tape: !!this.tape, zx128: this._zx128
        });
    }

    captureCheckpoint() {
        const support = this.checkpointSupport();
        if (!support.supported) return checkpointRefusal(support);
        return cloneCheckpointValue({
            schema: MACHINE_CHECKPOINT_SCHEMA,
            topology: this.checkpointTopology(),
            time: {ticks: this.cycles, domain: 'z80-cycles', hz: this.clockHz},
            state: this.saveState()
        });
    }

    restoreCheckpoint(checkpoint) {
        const support = this.checkpointSupport();
        if (!support.supported) return checkpointRefusal(support);
        const refusal = validateCheckpointEnvelope(checkpoint, this.checkpointTopology());
        if (refusal) return refusal;
        const state = checkpoint.state;
        // The version / memory-image / CPU-field / component-set clauses are the
        // SHARED ones and live in machine-checkpoint.js, so all three machines
        // refuse the same malformed state for the same named reason. The tape,
        // the ULA and the 128K banking below are genuinely this machine's.
        //
        // No `shape` is passed: a z80's chip state legitimately changes shape
        // between captures (the tape's block list, the ULA's edge arrays), so a
        // shape check against a fresh sample would refuse valid checkpoints.
        // That is a property of this machine, not an omission -- see the
        // per-chip clauses below, which check the same ground precisely.
        const badState = validateCheckpointState(state, {
            version: 1,
            memBytes: this.mem.length,
            cpuKeys: Z80Machine.CPU_STATE,
            chips: this.chips,
            devices: this.devices
        });
        if (badState) return badState;
        const ulaState = this.ula && state.chips?.ula;
        if ((!!state.zx128 !== this._zx128) ||
            (!!state.tape !== !!this.tape) ||
            (state.tape && (!Number.isSafeInteger(state.tape.pos) || !Array.isArray(state.tape.blocks) ||
                state.tape.blocks.some(block => !Number.isSafeInteger(block.flag) ||
                    !(block.data instanceof Uint8Array)))) ||
            (this.ula && (!(ulaState?.rows instanceof Uint8Array) || ulaState.rows.length !== 8 ||
                !Array.isArray(ulaState.speakerEdges) || !Array.isArray(ulaState.earEdges) ||
                !Number.isSafeInteger(ulaState.earIdx) || ulaState.earIdx < 0 ||
                ulaState.earIdx > ulaState.earEdges.length)) ||
            (this._zx128 && (!Array.isArray(state.zx128.roms) || state.zx128.roms.length !== 2 ||
                state.zx128.roms.some(rom => !(rom instanceof Uint8Array) || rom.length !== 16384) ||
                !Array.isArray(state.zx128.pages) || state.zx128.pages.length !== 6 ||
                state.zx128.pages.some(page => !(page instanceof Uint8Array) || page.length !== 16384) ||
                !state.zx128.bank || !['page', 'rom', 'shadow', 'locked'].every(key =>
                    Number.isSafeInteger(state.zx128.bank[key]))))) {
            return {refused: 'checkpoint machine state is incomplete', code: 'INVALID_CHECKPOINT'};
        }
        // THE DOMAIN THIS ACCEPTS MUST BE THE ONE z80-debug.js STAMPS.
        //
        // It read `z80-tstates` while the target stamps `z80-cycles`, so a
        // target could not restore a checkpoint it had just captured. The base
        // moved deliberately — an event clock on a different base from the
        // replay clock is two timelines a replayer reads as one, argued in
        // z80-debug.js:37-42 — and this reader was left behind. It is the site
        // a name census misses, because it matches a FRAGMENT inside a regex
        // rather than appearing as `domain: '...'`.
        //
        // BOTH EPOCH SUFFIXES ARE ACCEPTED, and that is not generosity: two
        // counters live on this one base by design. The target suffixes
        // `-rewind-N` on the facts it stamps, including checkpoints, and the
        // shared event module suffixes `-reset-N` on its events. A guard
        // accepting only the bare base refuses every post-rewind checkpoint.
        if (!checkpoint.time || !sameTicks(checkpoint.time.ticks, state.cycles) ||
            checkpoint.time.hz !== this.clockHz ||
            // This one was already RIGHT, and that is exactly why it is being
            // changed: it was right by having been fixed once, in one of four
            // places, and nothing made the other three follow. Derived now.
            `${logicalTimeDomain(checkpoint.time.domain)}` !== 'z80-cycles') {
            return {refused: 'checkpoint simulation time is inconsistent', code: 'INVALID_CHECKPOINT_TIME'};
        }
        this.loadState(cloneCheckpointValue(state));
        return undefined;
    }

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
            // BOTH CONVENTIONS, as I8086Machine does. Chips in this tree
            // implement one or the other -- getState/setState is the newer
            // pair (I8255, I8254, I8259, NS16C550, W65C51, the display cards)
            // and saveState/loadState the older (W65C22, MC6850, I8251).
            // Accepting only one silently DROPS every chip using the other,
            // because the loop below has no `else`: a chip it does not
            // recognise is skipped without comment. That is how the 6551's
            // serial state was absent from every 6502 snapshot.
            const pair = statePair(c);
            if (pair) chips[name] = c[pair[0]]();
        }
        const devices = {};
        for (const [name, device] of Object.entries(this.devices || {})) {
            const pair = statePair(device);
            devices[name] = device[pair[0]]();
        }
        return {
            v: 1,
            cpu,
            cycles: this.cycles,
            mem: this.mem.slice(),
            tapePos: this.tape ? this.tape.pos : null,
            tape: this.tape ? {
                pos: this.tape.pos,
                blocks: this.tape.blocks.map(block => ({flag: block.flag, data: block.data.slice()}))
            } : null,
            kempston: this._kempston,
            chips,
            devices,
            // 128K: the six real pages (5 and 2 live in mem) + banking.
            // ROMs are load-time configuration, like the 48K ROM.
            zx128: this._zx128 ? {
                pages: [0, 1, 3, 4, 6, 7].map((i) => this.pages[i].slice()),
                roms: this.roms.map(rom => rom.slice()),
                bank: { ...this._bank },
            } : null,
        };
    }

    /** Restore a saveState() snapshot onto an identically-built machine
     *  (same config, same ROM load, same insertTape call). */
    loadState(s) {
        if (s.v !== 1) throw new Error(`unknown machine state version ${s.v}`);
        for (const k of Z80Machine.CPU_STATE) this.cpu[k] = s.cpu[k] ?? 0;
        this.cycles = s.cycles;
        this.mem.set(s.mem);
        this._kempston = s.kempston ?? this._kempston;
        if (s.tape) {
            if (!this.tape) throw new Error('snapshot has a tape position but no tape is inserted');
            this.tape.pos = s.tape.pos;
            this.tape.blocks = s.tape.blocks.map(block => ({flag: block.flag, data: block.data.slice()}));
        }
        for (const [name, cs] of Object.entries(s.chips ?? {})) {
            const c = this.chips[name];
            if (!c) continue;
            const pair = statePair(c);
            c[pair[1]](cs);
        }
        for (const [name, ds] of Object.entries(s.devices ?? {})) {
            const device = this.devices?.[name];
            const pair = statePair(device);
            device[pair[1]](ds);
        }
        if (s.zx128 && this._zx128) {
            [0, 1, 3, 4, 6, 7].forEach((page, i) => this.pages[page].set(s.zx128.pages[i]));
            this.roms.forEach((rom, i) => rom.set(s.zx128.roms[i]));
            this._bank.locked = 0;                        // let _setBank apply
            this._setBank(
                s.zx128.bank.page
                | (s.zx128.bank.shadow << 3)
                | (s.zx128.bank.rom << 4)
                | (s.zx128.bank.locked << 5));
        }
    }

    /**
     * Attach a non-bus device that needs machine time (a PS/2 capture
     * chain, a sensor with its own pacing). It gets advance(cycles) in
     * step with the chips but owns no addresses — its outputs reach the
     * CPU through chip inputs or port reads, like the bench.
     */
    attachDevice(name, dev) {
        this.devices = this.devices || {};
        this.devices[name] = dev;
        this._advList = null;   // schedule is stale
        return dev;
    }

    /** How far a halted CPU may jump in one step: the nearest chip that
     *  can actually assert INT. Mirrors m6502-machine's WAI fast-forward,
     *  veto included. Capped so a pathological horizon cannot swallow a
     *  slice unexamined. */
    _wakeHorizon() {
        let h = Infinity;
        for (const k of Object.keys(this.chips)) {
            const chip = this.chips[k];
            if (!chip || !chip.advance) continue;
            if (typeof chip.nextWake !== 'function') return 4;
            h = Math.min(h, chip.nextWake());
        }
        if (!Number.isFinite(h)) h = Math.round(this.clockHz / 1000);
        return Math.max(4, Math.min(h, 0x10000));
    }

    /**
     * Flat lists of the chips these hot loops actually touch, built on first
     * use. Both loops run once per instruction, and Object.keys() allocated a
     * fresh name array each time -- on the 8086 tier the identical pattern was
     * measured at 89% of machine.step(). Invalidated in attachDevice.
     */
    _buildHotLists() {
        this._advList = [];
        for (const k of Object.keys(this.chips)) {
            const c = this.chips[k];
            if (typeof c.advance === 'function') this._advList.push(c);
        }
        if (this.devices) {
            for (const k of Object.keys(this.devices)) {
                const d = this.devices[k];
                if (typeof d.advance === 'function') this._advList.push(d);
            }
        }
        this._irqList = Object.values(this.chips);
    }

    _advanceChips(n) {
        if (this._advList === null) this._buildHotLists();
        const list = this._advList;
        for (let i = 0; i < list.length; i++) list[i].advance(n);
    }

    _anyIrq() {
        if (this._advList === null) this._buildHotLists();
        const list = this._irqList;
        for (let i = 0; i < list.length; i++) if (list[i].irqAsserted) return true;
        return false;
    }

    /** One instruction; IM 1 delivery when a chip asserts and IFF1 is set. */
    step() {
        if (this.cpu.halted && !(this._anyIrq() && this.cpu.iff1)) {
            // HALT burns NOPs until an interrupt — but burning them FOUR
            // CYCLES PER CALL made a halted CPU cost more than a running
            // one (a ZX game HALTing for the 50 Hz frame crawled ~17,500
            // iterations per frame). Jump to the nearest wake horizon
            // instead; a chip that advances but cannot name its horizon
            // vetoes the jump — a skipped event is a correctness bug, a
            // crawl is only slow. With IFF1 clear nothing can wake this
            // CPU anyway (there is no NMI source in these machines), so
            // the jump is just time passing.
            const n = this._wakeHorizon();
            this.cycles += n;
            this._advanceChips(n);
            return n;
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
        const trap = this.pcTraps.get(this.cpu.pc);
        if (trap) {
            const n = trap(this);
            if (n > 0) {
                this.cycles += n;
                this._advanceChips(n);
                return n;
            }
        }
        // LD-BYTES fast-load trap: with a tape inserted, entering the
        // ROM's loader at $0556 loads the next block instantly and RETs.
        // On a 128K machine the address only means LD-BYTES when the
        // 48 BASIC ROM (slot 1) is mapped — the 128 editor ROM has
        // different code at $0556 and must not be trapped.
        if (this.tape && this.cpu.pc === 0x0556 && this.ula
            && (!this._zx128 || this._bank.rom === 1)) {
            this.tape.trap(this.cpu, this.mem, this.writeBus);
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
