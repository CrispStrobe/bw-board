/**
 * Boundary-A adapter for the composable Z80 machine — the missing link
 * between the z80-bench gallery example and a RUNNING machine. The
 * eater6502 target had this from day one; the Z80 tier had machines,
 * extractors and a debug target, but no adapter, so the factory could
 * not boot it and the shipped example was a dead end.
 *
 * The Z80's boundary-A surface differs from the 6502's on purpose:
 * a Searle-shape machine has NO GPIO pins — its observable edge is the
 * ACIA serial stream (both directions) plus, on Spectrum-shaped
 * configs, the ULA faces the debug target already exposes. So
 * attachBoard keeps the time-sync invariant (board.advanceTo before
 * any effect) but publishes no pins; serial goes through onSerial /
 * sendSerial like every other serial-bearing adapter.
 *
 * config comes from a preset (SEARLE default), from CPM64K, from a
 * Spectrum config ({ula: true} / {zx128: true}), or from the Z80 bus
 * extractor's output — the same three-source doctrine as the 6502.
 */
import { Z80Machine, SEARLE, CPM64K } from './z80-machine.js';
import { getDevice } from './devices.js';
import { PS2Keyboard, PS2Capture } from './ps2.js';

export function createZ80Adapter(opts = {}) {
    const config = opts.config ?? (opts.cpm ? CPM64K : SEARLE);
    let board = null;
    const stats = { serialCount: 0, advanceToCount: 0 };
    let serialListener = null;

    // Collect buffer chip names for syncInputs
    const bufferChips = (config.ports || []).filter(p => p.kind === 'buffer').map(p => p.name);

    const machine = new Z80Machine(config, {
        onSerial(byte, tMs) {
            if (board && board.advanceTo) {
                board.advanceTo(BigInt(Math.round(tMs * 1e6)));
            }
            stats.serialCount++;
            if (serialListener) serialListener(byte);
        },
        onPinChange(pin, level, tMs) {
            // Latch Q edges onto an attached board — time first, edge
            // second, the invariant every adapter keeps. The pin id is
            // chip-qualified ('latch1.Q3'); the board resolves it onto
            // the seated part's terminal, so OUT (n),A lights whatever
            // the bench wires to the '374's outputs.
            if (!board) return;
            if (board.advanceTo) board.advanceTo(BigInt(Math.round(tMs * 1e6)));
            board.setPin(pin, 'pushpull', !!level);
            stats.pinChangeCount = (stats.pinChangeCount || 0) + 1;
        },
        onBufferRead(chipName) {
            // 74HC244 IN port: sample the board's pins for each A-input.
            // Pin names are chip-qualified: 'buf1.1A0' through 'buf1.2A3'.
            if (!board || !board.readPin) return 0xff;
            let value = 0;
            for (let bit = 0; bit < 8; bit++) {
                // Group 1: bits 0-3 → 1a0-1a3, Group 2: bits 4-7 → 2a0-2a3
                const group = bit < 4 ? 1 : 2;
                const pin = bit < 4 ? bit : bit - 4;
                const level = board.readPin(`${chipName}.${group}a${pin}`);
                if (level) value |= (1 << bit);
            }
            return value;
        },
    });

    if (opts.rom) machine.load(opts.rom, opts.romAt ?? 0);

    /** Sync input pins: board → buffer chips. Buffer reads are live
     *  (onBufferRead samples on each IN), so syncInputs is a no-op for
     *  buffers. Kept for API parity with the 6502 adapter. */
    function syncInputs() {
        // Buffer chips read live via onBufferRead hook — no pre-sync needed.
    }

    /** Publish initial latch output levels to the board at attach time.
     *  Without this, push-callback adapters miss the initial state: the
     *  onPinChange hook only fires on CHANGES, so a latch whose reset
     *  value is $00 never calls setPin — the board's solver starts with
     *  no source on those nets. (The 8051 fix, emu8051-adapter 0263cd4.) */
    function seatLatchPins() {
        if (!board) return;
        const latchChips = (config.ports || []).filter(p => p.kind === 'latch');
        for (const lc of latchChips) {
            const chip = machine.chips[lc.name];
            if (!chip) continue;
            const value = chip.value ?? 0;
            for (let bit = 0; bit < 8; bit++) {
                board.setPin(`${lc.name}.Q${bit}`, 'pushpull', !!(value & (1 << bit)));
            }
        }
    }

    /**
     * Detect PS/2 parts on the board and wire them to the machine.
     * On Z80 builds the PS/2 capture chain feeds a 74HC244 buffer's
     * A-inputs — the onBufferRead hook samples them on each IN.
     * The machine's attachDevice gives PS2Capture cycle time so frame
     * pacing works.
     */
    function bridgePS2(b) {
        if (!b.parts || !b.nets) return;

        for (const part of b.parts) {
            if (part.kind !== 'ps2') continue;
            const state = b.getDeviceState(part.id);
            if (!state || !state._kbd) continue;

            // Find which buffer the PS/2 data lines are wired to
            let bufferName = null;
            for (const net of b.nets) {
                const ps2Term = net.terminals.find(t => t.part === part.id);
                if (!ps2Term || !/^d[0-7]$/.test(ps2Term.terminal)) continue;
                const bufTerm = net.terminals.find(t => {
                    if (t.part === part.id) return false;
                    const p = b.partMap ? b.partMap.get(t.part) : b.parts.find(pp => pp.id === t.part);
                    return p && p.kind === '74hc244';
                });
                if (bufTerm) bufferName = bufTerm.part;
            }

            // Create a PS2Capture that writes bytes into the buffer's
            // input state. The onBufferRead hook will sample these on
            // each IN instruction.
            const cap = new PS2Capture(state._kbd, {
                onByte: (byte) => {
                    // Store the byte where onBufferRead will find it
                    if (cap._lastByte !== undefined) cap._lastByte = byte;
                },
            });
            cap._lastByte = 0;

            // If we found the buffer, patch its read to include PS/2 data
            if (bufferName) {
                const chip = machine.chips[bufferName];
                if (chip && typeof chip.read === 'function') {
                    const origRead = chip.read.bind(chip);
                    chip.read = () => cap._lastByte ?? origRead();
                }
            }

            machine.attachDevice(`ps2_${part.id}`, cap);
        }
    }

    // ── Interactive CP/M console (opts.cpm = { com }) ────────────────
    // BBCBASIC.COM (zlib, rtrussell/BBCZ80) or any .COM boots at $0100
    // over the minimal BDOS shim the BbcZ80Runner proved — here wired
    // to the ADAPTER's serial surface, so the app's console face talks
    // to a live interpreter. The 'waiting' trick is the runner's own:
    // a dry blocking read RETs and re-enters the $0005 JP, so the
    // machine spins politely until sendSerial() feeds a key.
    const rxKeys = [];
    let cpmExited = false;
    if (opts.cpm) {
        const BDOS = 0xfe00;
        machine.load(opts.cpm.com, 0x0100);
        machine.mem[0x0000] = 0x76;                    // warm boot → HALT
        machine.mem[0x0005] = 0xc3;                    // JP BDOS
        machine.mem[0x0006] = BDOS & 0xff;
        machine.mem[0x0007] = BDOS >> 8;
        const cpu = machine.cpu;
        const mem = machine.mem;
        const emit = (b) => { stats.serialCount++; if (serialListener) serialListener(b & 0xff); };
        const setA = (v) => { cpu.a = v & 0xff; cpu.l = v & 0xff; };
        const ret = () => { cpu.pc = cpu._pop16(); };
        const wait = () => { ret(); cpu.pc = 0x0005; };
        machine.pcTraps.set(BDOS, () => {
            switch (cpu.c) {
                case 0: cpmExited = true; cpu.halted = 1; break;
                case 1:
                    if (!rxKeys.length) { wait(); return 40; }
                    setA(rxKeys.shift()); break;
                case 2: emit(cpu.e); break;
                case 6:
                    if (cpu.e === 0xff) setA(rxKeys.length ? rxKeys.shift() : 0);
                    else if (cpu.e === 0xfe) setA(rxKeys.length ? 0xff : 0);
                    else if (cpu.e === 0xfd) {
                        if (!rxKeys.length) { wait(); return 40; }
                        setA(rxKeys.shift());
                    } else emit(cpu.e);
                    break;
                case 9: {
                    let a = cpu.de;
                    for (let i = 0; i < 4096; i++) {
                        const ch = mem[a];
                        if (ch === 0x24) break;
                        emit(ch);
                        a = (a + 1) & 0xffff;
                    }
                    break;
                }
                case 10: {
                    const buf = cpu.de;
                    const max = mem[buf];
                    let count = 0;
                    let ok = true;
                    while (count < max) {
                        if (!rxKeys.length) { wait(); ok = false; break; }
                        const ch = rxKeys.shift();
                        if (ch === 13) break;
                        mem[(buf + 2 + count) & 0xffff] = ch;
                        emit(ch);
                        count++;
                    }
                    if (!ok) return 40;
                    mem[(buf + 1) & 0xffff] = count;
                    emit(13); emit(10);
                    break;
                }
                case 11: setA(rxKeys.length ? 0xff : 0); break;
                case 12: cpu.hl = 0x0022; setA(0x22); break;
                default: setA(0); break;
            }
            ret();
            return 17;
        });
    }

    return {
        machine,
        clockHz: config.clockHz,

        load(bytes, at) { machine.load(bytes, at); },

        attachBoard(b) {
            board = b;
            bridgePS2(b);
            machine.cpu.pc = opts.pc ?? (opts.cpm ? 0x0100 : 0);
            if (opts.cpm) machine.cpu.sp = 0xfdff;
            seatLatchPins();
            syncInputs();
        },

        syncInputs,

        /** CP/M mode: true once the program performed a warm boot. */
        exited() { return cpmExited; },

        /** The serial console face: listen for TX bytes. */
        onSerial(cb) { serialListener = cb; },

        /** RX side: feed a byte to the first ACIA (keyboard → machine). */
        sendSerial(byte) {
            if (opts.cpm) { rxKeys.push(byte & 0xff); return true; }
            for (const chip of Object.values(machine.chips)) {
                if (typeof chip.rxPush === 'function') { chip.rxPush(byte & 0xff); return true; }
            }
            return false;
        },

        advanceNs(deltaNs) {
            const targetMs = machine.tMs + deltaNs / 1e6;
            machine.advanceToMs(targetMs);
            if (board && board.advanceTo) {
                board.advanceTo(this.timeNs());
                stats.advanceToCount++;
            }
        },

        timeNs() {
            return BigInt(Math.round(machine.tMs * 1e6));
        },

        stats,
    };
}

export default createZ80Adapter;
