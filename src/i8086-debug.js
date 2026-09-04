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
 * A CGA mode-control byte (3D8h) read back as a BIOS mode number, or null if
 * the card was never programmed.
 *
 * BIT 3 IS THE DISCRIMINATOR, and it is a real one rather than a flag we
 * invented: it is VIDEO ENABLE, and a card nobody has written holds zero,
 * which means video off -- a state no working program leaves it in. So "bit 3
 * set" means "somebody programmed this card", which is exactly the question
 * that decides whether the card or the INT 10h log is the better authority.
 *
 * It matters because our INT 10h/AH=00h does NOT program the card: a DOS
 * program's mode reaches the log and nothing else, while a game's mode reaches
 * the card and nothing else. The two populations are disjoint, so the answer
 * is "whichever one spoke", not a priority rule.
 *
 * Mode 13h is deliberately unreachable here -- it is VGA, it has no 3D8h
 * encoding, and a card asked to express it would have to lie.
 */
/**
 * A VGA card's register banks read as a BIOS mode number.
 *
 * There is no single "mode register" on a VGA -- a mode is a CONFIGURATION,
 * so this asks the three questions that separate the one mode the renderer
 * supports from the ones it must refuse:
 *
 *   gc[6] bit 0    alpha disable: graphics rather than text
 *   seq[4] bit 3   chain-4: one byte per pixel across four planes, which is
 *                  what makes 13h a linear framebuffer instead of a planar one
 *   attr[10h] bit 6  8-bit colour: the packed-pixel attribute path
 *
 * Chain-4 AND 8-bit colour together IS mode 13h. Graphics without them is
 * one of 0Dh-12h -- four bit planes behind the sequencer's latches, a
 * different machine, and the renderer's header says so. Those are REFUSED BY
 * NAME rather than drawn: a wrong picture is worse than an honest empty pane,
 * because a wrong picture looks like a bug in the program.
 *
 * `misc` is the programmed test, as 3D8h bit 3 is for CGA: the misc output
 * register is written by every mode set and a card nobody has touched holds
 * zero.
 */
function modeFromVga(v) {
    if (!v || !v.misc) return null;                       // never programmed
    const graphics = (v.gc[0x06] & 0x01) !== 0;
    if (!graphics) return { mode: 0x03, supported: true, reason: 'VGA registers: alphanumeric' };
    const chain4 = (v.seq[0x04] & 0x08) !== 0;
    const eightBit = (v.attr[0x10] & 0x40) !== 0;
    if (chain4 && eightBit) {
        return { mode: 0x13, supported: true, reason: 'VGA registers: chain-4 + 8-bit colour' };
    }
    // Graphics, not chain-4, not 8-bit colour: the planar family. 0Dh is the
    // one this renderer draws, and it draws it only when the card actually
    // hands over four planes -- a VGA in a planar mode has them too, but this
    // path is written against the EGA card's state and says so rather than
    // guessing at a superset.
    if (v.planes && v.planes.length === 4) {
        return { mode: 0x0d, supported: true, reason: 'registers: planar graphics, four planes' };
    }
    return {
        mode: 0x0d, supported: false,
        reason: 'VGA registers say graphics but not chain-4 with 8-bit colour, so this is one of '
            + '0Dh-12h: four bit planes behind the sequencer, and this card exposes no planes',
    };
}

/**
 * Hercules is 720x348 monochrome at B0000h, which the renderer does not do.
 * Its text mode is MDA's 80x25 at B0000h -- also not modelled, because the
 * renderer's text path reads B8000h. Both are refused by name; pretending
 * otherwise would render the wrong address.
 */
function modeFromHercules(h) {
    if (!h || !h.mode) return null;
    if (h.graphics) {
        // 0x100, not 0x06. Hercules graphics has no INT 10h mode number --
        // it is selected by writing 3BFh and 3B8h directly. The earlier draft
        // returned 06h, which is CGA 640x200: same resolution class, but
        // B8000h instead of B0000h and a two-bank parity interleave instead of
        // four banks on `y mod 4`. It would have drawn the wrong address with
        // the wrong arithmetic and produced a picture.
        return { mode: 0x100, supported: true, reason: '3B8h: Hercules graphics, 720x348 mono' };
    }
    return {
        mode: 0x07, supported: false,
        reason: 'Hercules text is MDA 80x25 at B0000h; the renderer reads B8000h',
    };
}

function modeFromCga(mode) {
    if (!(mode & 0x08)) return null;                 // video disabled: never programmed
    if (mode & 0x02) {                               // graphics
        if (mode & 0x10) return 0x06;                // 640x200, one bit per pixel
        return (mode & 0x04) ? 0x05 : 0x04;          // 320x200, the mono-signal palette
    }
    const wide = (mode & 0x01) !== 0, mono = (mode & 0x04) !== 0;
    return wide ? (mono ? 0x02 : 0x03) : (mono ? 0x00 : 0x01);
}

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
/**
 * Turn an `assemble()` result into the LINEAR-address label map the
 * disassembler and the breakpoint layer both speak.
 *
 * This is a separate function rather than something the target does, because
 * the target cannot do it alone: a symbol table records offsets within
 * SEGMENTS, and a segment does not know where it was loaded. The load
 * paragraph is the caller's fact — it comes from the loader, not the
 * assembler — so the arithmetic lives in one testable place instead of being
 * half-done in two.
 *
 * TWO KINDS ARE EXCLUDED, and the first is the same distinction the
 * disassembler had to make on the same day:
 *
 *   - `equ` is a CONSTANT, not an address. `BUFSIZE equ 1234h` names a
 *     number, and admitting it would put `BUFSIZE` in front of whatever
 *     happens to live at 1234h. That is the `mov ax, 1234h` bug wearing a
 *     different hat: a map built from constants invents cross-references,
 *     and a reader cannot tell an invented one from a real one.
 *   - `segment` names a paragraph, which is not an address in a
 *     byte-addressed map at all.
 *
 * `code` and `data` are both kept — a data label in front of
 * `mov ax, [counter]` is as useful as a code label in front of a `jmp`, and
 * the disassembler already labels the direct memory forms.
 *
 * WHERE TWO NAMES LAND ON ONE ADDRESS the first in sorted order wins, so the
 * map is deterministic across runs rather than dependent on insertion order.
 * That collision is legitimate — a procedure label and the first datum of the
 * next segment can coincide — so it is resolved, not treated as an error.
 *
 * @param {{ symbols?: Map<string, object> }} result — an `assemble()` return
 * @param {{ loadSeg?: number }} [opts] — the paragraph the image was loaded at
 *   (a .COM's PSP segment, an .EXE's load segment). Default 0.
 * @returns {Map<number, string>} linear address → the symbol's own spelling
 */
export function labelsFromAssembly(result, opts = {}) {
    const loadSeg = (opts.loadSeg ?? 0) & 0xffff;
    const out = new Map();
    const rows = [...(result?.symbols ?? new Map()).values()]
        .filter((sym) => sym && (sym.kind === 'code' || sym.kind === 'data'))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    for (const sym of rows) {
        const para = (loadSeg + (sym.seg?.para ?? 0)) & 0xffff;
        const addr = ((para << 4) + ((sym.value ?? 0) & 0xffff)) & 0xfffff;
        if (!out.has(addr)) out.set(addr, String(sym.name));
    }
    return out;
}

export function createI8086DebugTarget(adapter, opts = {}) {
    const machine = adapter.machine;
    const cpu = machine.cpu;

    let runState = 'halted';
    let pendingStep = null;
    const haltListeners = [];
    const breakpoints = new Map();
    /** Linear address -> symbol name, or null. See setSymbols(). */
    let labels = null;
    let nextBpId = 1;
    const halt = (info) => { runState = 'halted'; for (const cb of haltListeners) cb(info); };

    // Write watchpoints trap TRUE writes by wrapping the core's write
    // callback (installed only while a watch exists) — z80/emu8051 parity.
    // The trap sits ABOVE the machine's ROM filter, so a store aimed at ROM
    // still fires: the program wrote, even if memory refused.
    const writeWatches = new Map();     // id → { addr, len }
    let watchHit = null;
    let origWrite = null;
    /** Port and interrupt breakpoints, and the pending hit either can leave. */
    const portWatches = new Map();
    const intWatches = new Map();
    let eventHit = null;

    /**
     * Attach or detach the machine's observation hooks, exactly as
     * syncWriteTrap does for cpu.write: present only while something is
     * watching, so an unwatched machine pays one null check per IN/OUT and
     * nothing per instruction.
     *
     * A PORT READ IS DESTRUCTIVE, which is why readMem() refuses the I/O
     * space outright (see the module header). These hooks observe the access
     * the PROGRAM makes and never perform one — the machine hands us the
     * value it already returned to the program, and on an `in` it does so
     * AFTER the read, so what a watcher sees is what the device actually
     * gave up rather than what it was about to.
     */
    const syncEventHooks = () => {
        machine.hooks.onPortAccess = portWatches.size
            ? (ev) => {
                for (const [id, w] of portWatches) {
                    if (w.port !== (ev.port & 0xffff)) continue;
                    if (w.dir && w.dir !== ev.dir) continue;
                    eventHit = { cause: 'port', bp: id, ...ev };
                }
            }
            : null;
        machine.hooks.onInterrupt = intWatches.size
            ? (ev) => {
                for (const [id, w] of intWatches) {
                    if (w.vector != null && w.vector !== ev.vector) continue;
                    if (w.source && w.source !== ev.source) continue;
                    eventHit = { cause: 'interrupt', bp: id, ...ev };
                }
            }
            : null;
    };

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
                // 'port' and 'int' are declared only because the machine can
                // actually observe them. They rest on machine.hooks, which the
                // machine layer owns; a target wired to a machine without them
                // would be advertising a control that silently never fires,
                // which is the same reason `steps` does not list 'cycle'.
                breakpoints: machine.hooks
                    ? ['code', 'write', 'port', 'int']
                    : ['code', 'write'],
                timeFreezes: true,
                consumes: [],
                // Declared only when the machine can actually take a key. A
                // board with no PPI and no PIC has nowhere to latch a scancode
                // and no wire to raise IRQ1 on, and a host that offered a
                // keyboard for it would be offering one that silently does
                // nothing -- the same reason `steps` does not list 'cycle'.
                keys: machine.canTakeKeys && machine.canTakeKeys() ? ['scancode'] : [],
                // Whether this target can BE GIVEN symbols, not whether it
                // has any. A host asks this to decide whether the control
                // exists at all; whether it does anything is setSymbols()'s
                // answer, and that is a different question with a different
                // right time to ask it.
                symbols: true,
            };
        },

        /**
         * A key, as a set-1 scancode. This is the HARDWARE path -- port A of
         * the 8255 plus IRQ1 -- so it works on a bare-metal board and on one
         * running our BIOS, which is why the widget uses it rather than the
         * BIOS's INT 16h buffer. A machine that cannot take keys returns
         * false rather than pretending, so a caller can tell the difference
         * between "delivered" and "there was nobody to deliver it to".
         *
         * Break codes are the caller's business: a real keyboard sends make
         * on press and make|0x80 on release, and a host that sends only makes
         * leaves every modifier stuck down.
         */
        keyIn(scancode) {
            return typeof machine.keyIn === 'function' ? machine.keyIn(scancode) : false;
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
        /**
         * Hand the target a linear-address label map, or null to forget one.
         * Build it with labelsFromAssembly(); a caller whose symbols come
         * from somewhere else — a map file, a monitor ROM's known entry
         * points — passes its own, which is why this takes a Map rather than
         * an assembler result.
         *
         * Returns how many labels are now in force, because "I set symbols
         * and the pane looks the same" is otherwise indistinguishable from
         * "the map was empty" — and an empty map is exactly what a caller
         * gets from a file whose names are all EQUs.
         */
        setSymbols(map) {
            labels = map instanceof Map && map.size ? map : null;
            return labels ? labels.size : 0;
        },

        /** The name at a linear address, or null. */
        symbolAt(addr) { return labels?.get(addr & 0xfffff) ?? null; },

        disasm(addr) {
            const a = addr & 0xfffff;
            const csBase = (cpu.cs << 4) & 0xfffff;
            const ip = (a >= csBase && a <= csBase + 0xffff) ? (a - csBase) & 0xffff : a & 0xffff;
            // THE MAP IS LINEAR AND THE DISASSEMBLER'S IS NOT, and this is the
            // join that is easy to get silently wrong. The disassembler labels
            // a 16-BIT operand — a jump target, or the address inside
            // [seg:addr] — which is an offset in the segment the instruction
            // was read from. Passing the linear map straight through would
            // label nothing on any machine whose code does not sit at segment
            // zero, which is every real one, and it would fail by showing
            // plain hex rather than by raising anything.
            let inSeg = null;
            if (labels) {
                inSeg = new Map();
                for (const [lin, name] of labels) {
                    if (lin >= csBase && lin <= csBase + 0xffff) inSeg.set((lin - csBase) & 0xffff, name);
                }
            }
            return disasmI8086((x) => machine._read(x & 0xfffff), a,
                inSeg && inSeg.size ? { ip, labels: inSeg } : { ip });
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
            if (spec.kind === 'port') {
                if (!machine.hooks) return { unsupported: 'this machine has no observation hooks' };
                if (spec.port == null) return { unsupported: 'port required' };
                if (spec.dir != null && spec.dir !== 'in' && spec.dir !== 'out') {
                    return { unsupported: `dir must be 'in', 'out', or absent for either` };
                }
                const id = nextBpId++;
                portWatches.set(id, { port: spec.port & 0xffff, dir: spec.dir ?? null });
                syncEventHooks();
                return id;
            }
            if (spec.kind === 'int') {
                if (!machine.hooks) return { unsupported: 'this machine has no observation hooks' };
                // An ABSENT vector means every vector, which is the useful
                // default for "what is this program asking the BIOS for" and
                // is why it is not an error. An absent source likewise means
                // any: 'int' (a program's INT n), 'irq' (a PIC line), 'nmi',
                // or 'exception' (a divide fault, BOUND, the single-step
                // trap). Keeping them separable matters because "break on
                // INT 21h" and "break on the timer tick" are different
                // questions that a vector number alone stops being able to
                // tell apart the moment anything remaps a vector.
                const SOURCES = ['int', 'irq', 'nmi', 'exception'];
                if (spec.source != null && !SOURCES.includes(spec.source)) {
                    return { unsupported: `source must be one of ${SOURCES.join(', ')}, or absent for any` };
                }
                const id = nextBpId++;
                intWatches.set(id, {
                    vector: spec.vector == null ? null : spec.vector & 0xff,
                    source: spec.source ?? null,
                });
                syncEventHooks();
                return id;
            }
            if (spec.kind !== 'code') return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
            // BY NAME, which is the point of having symbols at all. Resolved
            // HERE and once, so what is STORED is still a linear address and
            // the compare in runFor() does not grow a second shape.
            //
            // A name that is not in the map is a REFUSAL, never a silent
            // no-op. "Break at delay_loop" quietly doing nothing is the worst
            // answer available: the program runs to completion and the
            // evidence says it never reached the label, which is a different
            // and much more interesting claim than the truth.
            if (spec.symbol != null) {
                if (!labels) return { unsupported: 'no symbols are loaded — call setSymbols() first' };
                const want = String(spec.symbol).toLowerCase();
                let found = null;
                for (const [lin, name] of labels) {
                    if (String(name).toLowerCase() === want) { found = lin; break; }
                }
                if (found === null) return { unsupported: `no symbol named ${JSON.stringify(spec.symbol)}` };
                const id = nextBpId++;
                breakpoints.set(id, { kind: 'code', addr: found, symbol: spec.symbol });
                return id;
            }
            if (spec.addr == null) return { unsupported: 'addr or symbol required' };
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
            if (portWatches.delete(id) || intWatches.delete(id)) { syncEventHooks(); return; }
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
                // Checked BEFORE the write watch, and the order is arbitrary
                // only in appearance: a port write that trips both is one
                // event, and reporting the port — the thing the user asked
                // about by name — is the more specific answer.
                if (eventHit) {
                    const hit = eventHit;
                    eventHit = null;
                    halt(hit);
                    return 'halted';
                }
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
            // A programmed CGA card outranks the INT 10h log, because the
            // games that matter here write its registers and never call the
            // BIOS at all.
            // Ask whichever display card the machine has. A machine has ONE
            // display -- a CGA and a VGA in the same config would both claim
            // 3DAh -- so the first card that answers is the card.
            let card = null, from = null;
            for (const c of Object.values(machine.chips || {})) {
                if (typeof c.getVideoState !== 'function') continue;
                const st = c.getVideoState();
                const answer = st.seq ? modeFromVga(st)
                    : st.config !== undefined ? modeFromHercules(st)
                        : (st.mode !== undefined && modeFromCga(st.mode) !== null
                            ? { mode: modeFromCga(st.mode), supported: true,
                                reason: `3D8h = ${st.mode.toString(16)}h` }
                            : null);
                if (answer) { card = st; from = answer; break; }
                if (!card) card = st;                 // keep its latches for opts
            }
            const seen = typeof opts.videoModeLog === 'function' ? opts.videoModeLog() : [];
            const guess = from || likelyMode(seen);
            if (!guess.supported) return { unsupported: `mode ${guess.mode.toString(16)}h: ${guess.reason}` };
            // 3D9h carries the colour select: low nibble is the border and, in
            // the 320x200 modes, the background; bit 4 is intensity and bit 5
            // picks between the two four-colour palettes. Translating it here
            // is the point of the seam -- the card holds raw latches and the
            // renderer takes named options, and only this file knows both.
            const vo = { ...(opts.videoOpts || {}) };
            // A PROGRAMMED DAC goes straight through -- the card holds six-bit
            // values indexed 3*colour+component, exactly what the renderer
            // expects, because both store what the hardware stores.
            //
            // "Programmed" is load-bearing. A card's DAC powers up ALL ZEROES,
            // and passing that renders every pixel black: a mode-13h program
            // that never touched the palette would come out as a blank screen
            // that looks exactly like a bug in the emulator. On real hardware
            // the BIOS loads the default table at mode set; we have no BIOS
            // ROM, so the renderer's generated default stands in until a
            // program says otherwise. Same discriminator as everywhere else in
            // this file: has anyone actually written it.
            // EGA planes and its attribute palette, same stance as the DAC
            // below: handed over only when the card actually has them, so a
            // machine without an EGA is unaffected.
            if (card && card.planes && card.planes.length === 4) {
                vo.planes = card.planes;
                if (card.attr) vo.attr = card.attr;
            }
            if (card && card.dac && vo.dac === undefined && card.dac.some((b) => b !== 0)) {
                vo.dac = card.dac;
            }
            if (card && card.color !== undefined) {
                if (vo.background === undefined) vo.background = card.color & 0x0f;
                if (vo.intensity === undefined) vo.intensity = (card.color & 0x10) !== 0;
                if (vo.cgaPalette === undefined) vo.cgaPalette = (card.color & 0x20) !== 0;
            }
            const frame = renderMode(guess.mode, (a) => machine._read(a & 0xfffff), vo);
            return { ...frame, mode: guess.mode, why: guess.reason };
        },

        /**
         * The tone the machine is producing, as {hz, on} -- the SAME shape
         * z80-debug.js answers with for the ZX beeper. Matching it exactly is
         * the point: a UI that can already show one CPU family's audio needs
         * no new concept for a second. Null on a machine with no speaker.
         */
        audio() {
            if (typeof machine.audioTone === 'function') return machine.audioTone();
            return null;
        },

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
