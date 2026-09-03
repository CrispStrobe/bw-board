/**
 * Boundary-D debug target for I8086Machine — the 8086 breadboard becomes
 * breakable, steppable, inspectable. Mirrors z80-debug.js: this module owns
 * the stepping loop with a breakpoint check around each machine.step().
 *
 * THREE THINGS DIFFER FROM EVERY OTHER TARGET HERE, and all three come from
 * the same place — the 8086 has no program counter.
 *
 *   - CODE BREAKPOINTS COMPARE ON THE LINEAR ADDRESS. CS:IP is a pair, and
 *     two different seg:off pairs name the same instruction: 0000:0400 and
 *     0040:0000 are one address. A breakpoint held as an offset can be
 *     jumped straight past by code that reached the same byte through a
 *     different segment, so the comparison is on (cs << 4) + ip, and the
 *     UI converts whatever the user typed. `regs().pc` is that value.
 *   - THE ADDRESS MASK IS TWENTY BITS. Every `& 0xffff` inherited from the
 *     Z80 target is a bug here; a watchpoint on a physical address above
 *     64K would silently never fire.
 *   - STEP-OVER'S CALL CLASS HAS TO SKIP PREFIXES. `rep movsb` is not a
 *     call, but `2e ff 17` (a CS-overridden indirect CALL) is, and the
 *     opcode that decides is not the first byte.
 *
 * The I/O port space is deliberately NOT readable through readMem(). A port
 * read is destructive on real hardware — reading a UART's RBR pops the FIFO,
 * reading a status register clears it — so a debugger that dumped the port
 * space would change the machine it claims to be observing. It refuses with
 * a reason instead.
 *
 * @module
 */
import { disasmI8086 } from './i8086-disasm.js';
import { renderMode, likelyMode } from './i8086-cga.js';

/**
 * @param {{ machine: import('./i8086-machine.js').I8086Machine }} adapter
 * @param {{ videoModeLog?: () => number[], videoOpts?: object }} [opts]
 *   `videoModeLog` is the INT 10h/AH=00h history -- the DOS layer's
 *   `videoModeLog()` is exactly this shape. Without it the target assumes
 *   the power-on text mode, which is right for every machine that has not
 *   set one, and wrong only for a graphics program whose mode sets nobody
 *   recorded. `videoOpts` passes the mode-control latches (palette,
 *   background, DAC) through to the renderer.
 */
export function createI8086DebugTarget(adapter, opts = {}) {
    const machine = adapter.machine;
    const cpu = machine.cpu;

    let runState = 'halted';
    let pendingStep = null;
    const haltListeners = [];
    const breakpoints = new Map();
    let nextBpId = 1;
    const halt = (info) => { runState = 'halted'; for (const cb of haltListeners) cb(info); };

    // Write watchpoints trap TRUE writes by wrapping the core's write
    // callback (installed only while a watch exists) — z80/emu8051 parity.
    // The trap sits ABOVE the machine's ROM filter, so a store aimed at ROM
    // still fires: the program wrote, even if memory refused.
    const writeWatches = new Map();     // id → { addr, len }
    let watchHit = null;
    let origWrite = null;
    const syncWriteTrap = () => {
        if (writeWatches.size && !origWrite) {
            origWrite = cpu.write;
            cpu.write = (a, v) => {
                const aa = a & 0xfffff;
                for (const [id, w] of writeWatches) {
                    if (aa >= w.addr && aa < w.addr + w.len) watchHit = { bp: id, addr: aa, value: v & 0xff };
                }
                return origWrite(a, v);
            };
        } else if (!writeWatches.size && origWrite) {
            cpu.write = origWrite;
            origWrite = null;
        }
    };

    /**
     * Is the next instruction one that step-over should run to completion?
     * CALL near/far, CALL indirect (FF /2, FF /3), INT and INT3 — anything
     * that pushes a return address. Prefixes are skipped first, because the
     * deciding byte is not always the first one, and a segment override in
     * front of an indirect call is ordinary code.
     */
    const isCallClass = () => {
        let a = cpu.pc, op = 0;
        for (let i = 0; i < 8; i++) {                 // prefixes, then the opcode
            op = machine._read((a + i) & 0xfffff);
            if (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e
                || op === 0xf0 || op === 0xf1 || op === 0xf2 || op === 0xf3) continue;
            if (op === 0xe8 || op === 0x9a || op === 0xcc || op === 0xcd) return true;
            if (op === 0xff) {
                const modrm = machine._read((a + i + 1) & 0xfffff);
                const reg = (modrm >> 3) & 7;
                return reg === 2 || reg === 3;        // CALL near/far indirect
            }
            return false;
        }
        return false;
    };

    return {
        capabilities() {
            return {
                steps: ['insn', 'over', 'out'],
                breakpoints: ['code', 'write'],
                timeFreezes: true,
                consumes: [],
            };
        },

        state() { return runState; },

        regs() {
            return {
                // The flat address the pair names, so a caller that only
                // knows "pc" gets a true one rather than a half of it.
                pc: cpu.pc,
                ax: cpu.ax, bx: cpu.bx, cx: cpu.cx, dx: cpu.dx,
                sp: cpu.sp, bp: cpu.bp, si: cpu.si, di: cpu.di,
                ip: cpu.ip, cs: cpu.cs, ds: cpu.ds, es: cpu.es, ss: cpu.ss,
                flags: cpu.flags,
                halted: cpu.halted,
                cycles: machine.cycles,
            };
        },

        /**
         * Live disassembly at a LINEAR address. The offset half matters —
         * relative targets are computed in the segment — so when the address
         * falls inside the current CS window it is disassembled as CS:off,
         * which is the case that matters for the pane following execution.
         * Outside it, the low sixteen bits are the best guess available and
         * only jump targets can be wrong.
         */
        disasm(addr) {
            const a = addr & 0xfffff;
            const csBase = (cpu.cs << 4) & 0xfffff;
            const ip = (a >= csBase && a <= csBase + 0xffff) ? (a - csBase) & 0xffff : a & 0xffff;
            return disasmI8086((x) => machine._read(x & 0xfffff), a, { ip });
        },

        onHalt(cb) {
            haltListeners.push(cb);
            // The session treats the return value as an unsubscribe and
            // CALLS it on destroy — push()'s return (the new length) would
            // make every bench teardown throw.
            return () => {
                const i = haltListeners.indexOf(cb);
                if (i >= 0) haltListeners.splice(i, 1);
            };
        },

        setBreakpoint(spec) {
            if (spec.kind === 'write') {
                if (spec.addr == null) return { unsupported: 'addr required' };
                const id = nextBpId++;
                writeWatches.set(id, { addr: spec.addr & 0xfffff, len: spec.len ?? 1 });
                syncWriteTrap();
                return id;
            }
            if (spec.kind !== 'code') return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
            if (spec.addr == null) return { unsupported: 'addr required' };
            const id = nextBpId++;
            // seg:off is accepted and resolved here, once, so the compare
            // stays linear. A caller that already has a physical address
            // passes only addr.
            const addr = spec.seg != null
                ? (((spec.seg & 0xffff) << 4) + (spec.addr & 0xffff)) & 0xfffff
                : spec.addr & 0xfffff;
            breakpoints.set(id, { kind: 'code', addr });
            return id;
        },

        clearBreakpoint(id) {
            breakpoints.delete(id);
            if (writeWatches.delete(id)) syncWriteTrap();
        },

        run() { runState = 'running'; pendingStep = null; },

        /** The session's pause verb: stop executing NOW and say why. */
        halt() { halt({ cause: 'pause' }); },

        step(kind, count = 1) {
            if (kind === 'insn') {
                runState = 'running';
                pendingStep = { kind: 'insn', remaining: count };
                return undefined;
            }
            if (kind === 'over') {
                // Depth-wait only when the next opcode is call-class; a PUSH
                // must not turn step-over into run-until-someday.
                if (!isCallClass()) {
                    runState = 'running';
                    pendingStep = { kind: 'insn', remaining: 1 };
                    return undefined;
                }
                runState = 'running';
                pendingStep = { kind: 'over', sp0: cpu.sp, entered: false };
                return undefined;
            }
            if (kind === 'out') {
                runState = 'running';
                pendingStep = { kind: 'out', sp0: cpu.sp };
                return undefined;
            }
            if (kind === 'cycle') {
                return { unsupported:
                    'this 8086 core has no cycle step. I8086Machine.step() executes a whole '
                    + 'instruction and returns its cycle count — there is no sub-instruction '
                    + 'state to stop in, so a cycle step here would be an instruction step with '
                    + 'a different label. Step one instruction; regs().cycles reports the cost.' };
            }
            return { unsupported: `step kind '${kind}' not supported` };
        },

        /** Spend up to budgetNs of simulated time. Returns 'halted' or 'budget'. */
        runFor(budgetNs) {
            if (runState !== 'running') return 'halted';
            const deadline = machine.tMs + budgetNs / 1e6;
            while (machine.tMs < deadline) {
                for (const [id, bp] of breakpoints) {
                    if (bp.addr === cpu.pc) { halt({ cause: 'breakpoint', bp: id }); return 'halted'; }
                }
                if (pendingStep) {
                    if (pendingStep.kind === 'insn' && pendingStep.remaining <= 0) { halt({ cause: 'step' }); return 'halted'; }
                    // SP rising back to or above where it started means the
                    // frame is gone. Sixteen-bit wraparound is why the test
                    // is a sign check on the difference, not a comparison.
                    if (pendingStep.kind === 'over' && pendingStep.entered
                        && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) { halt({ cause: 'step' }); return 'halted'; }
                    if (pendingStep.kind === 'out'
                        && cpu.sp !== pendingStep.sp0 && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) {
                        halt({ cause: 'step' }); return 'halted';
                    }
                }
                machine.step();
                if (watchHit) {
                    const hit = watchHit;
                    watchHit = null;
                    halt({ cause: 'watchpoint', ...hit });
                    return 'halted';
                }
                if (pendingStep?.kind === 'insn') pendingStep.remaining--;
                if (pendingStep?.kind === 'over') pendingStep.entered = true;
            }
            return runState === 'halted' ? 'halted' : 'budget';
        },

        timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); },

        /**
         * A frame the debugger can show. A video CHIP answers first if the
         * machine has one; otherwise the frame is rendered straight out of
         * memory, which is the whole reason i8086-cga.js is a pure function.
         *
         * THE TARGET IS THE RIGHT PLACE TO JOIN THEM. The renderer does not
         * import the service layer and the service layer does not import the
         * renderer -- that independence is deliberate and lets either be used
         * alone. Something has to hold both, and a debug target consuming a
         * machine plus a mode log is exactly that something.
         *
         * With no mode log the assumption is text mode 3, which renders
         * correctly for every machine that never set one. An unsupported mode
         * says so rather than throwing, because a debugger pane that crashes
         * the session because a program selected mode 12h is worse than a
         * pane that says why it is empty.
         */
        video() {
            for (const chip of Object.values(machine.chips || {})) {
                if (typeof chip.videoFrame === 'function') return chip.videoFrame();
            }
            const seen = typeof opts.videoModeLog === 'function' ? opts.videoModeLog() : [];
            const guess = likelyMode(seen);
            if (!guess.supported) return { unsupported: `mode ${guess.mode.toString(16)}h: ${guess.reason}` };
            const frame = renderMode(guess.mode, (a) => machine._read(a & 0xfffff), opts.videoOpts || {});
            return { ...frame, mode: guess.mode, why: guess.reason };
        },

        audio() { return null; },

        readMem(space, addr, len) {
            if (space === 'io') {
                return { unsupported:
                    'the port space is not readable from a debugger: an IN is destructive on '
                    + 'real hardware — it pops a UART FIFO, it clears a status register — so '
                    + 'dumping it would change the machine being observed. Read the chip state '
                    + 'instead.' };
            }
            if (space !== 'mem') return { unsupported: `no space '${space}' on 8086` };
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) out[i] = machine._read((addr + i) & 0xfffff);
            return out;
        },

        writeMem(space, addr, data) {
            if (space !== 'mem') return { refused: `no space '${space}' on 8086` };
            // A debugger patches what the CPU sees, ROM included — that is
            // the point of a poke, and it is why this writes the array
            // rather than going through the machine's ROM filter.
            for (let i = 0; i < data.length; i++) {
                machine.mem[(addr + i) & 0xfffff] = data[i] & 0xff;
            }
            return undefined;
        },
    };
}

export default createI8086DebugTarget;
