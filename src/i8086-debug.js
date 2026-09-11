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
import { installInstructionDebugEvents } from './instruction-debug-events.js';
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

import { replayAccepted, replayRefused } from './debug-replay-contract.js';

export function createI8086DebugTarget(adapter, opts = {}) {
    const machine = adapter.machine;
    const cpu = machine.cpu;
    const cpuId = opts.cpuId || 'i8086';

    /**
     * THE SHARED EVENT MODULE, which this target was the last one not to use.
     * avr8js uses it here; m6502 and z80 use it downstream. Everything it
     * publishes -- instruction retires, memory and port accesses, a monotonic
     * event clock -- existed only as a hand-rolled equivalent elsewhere.
     *
     * `addressMask` is why this could not be done until now: the module masked
     * memory addresses to sixteen bits, so this core's fetches at 0xF8000 arrived
     * as 0x8000 -- right for exactly the first 64K, which is where a test
     * program's operands live and not where its code does.
     *
     * ITS CLOCK AND THIS TARGET'S SHARE A DOMAIN BASE AND NOT AN EPOCH COUNTER.
     * Both read machine.cycles and both stamp `i8086-cycles`, so an ordinary fact
     * and an ordinary debugTime() agree. After a rewind they diverge in the
     * SUFFIX -- this target counts `-rewind-N`, the module `-reset-N`, and
     * neither observes the other's bump. That is a seam, not a defect today:
     * nothing moves machine.cycles backwards except a checkpoint restore, which
     * opens this target's epoch. Closing it means one clock owning both, and that
     * changes debugTime()'s return type from Number to BigInt for every existing
     * caller -- a separate decision, deliberately not taken here.
     */
    const debugEvents = installInstructionDebugEvents({
        cpu, machine, cpuId, timeDomain: 'i8086-cycles', port: true,
        addressMask: 0xfffff,
        pcOf: c => c.pc & 0xfffff,
        clock: () => machine.cycles,
        captureRegisters: () => machine._architecturalRegisters(),
        captureInstruction: address => ({
            address,
            ...disasmI8086(a => machine._read(a & 0xfffff), address, {ip: cpu.ip})
        })
    });

    /** Last rendered frame and the key it was rendered for. See video(). */
    let cachedVideoKey = null;
    let cachedVideoFrame = null;
    let runState = 'halted';
    let pendingStep = null;
    const haltListeners = [];
    const breakpoints = new Map();
    /** Linear address -> symbol name, or null. See setSymbols(). */
    let labels = null;
    let nextBpId = 1;

    // ─── The replay surface ─────────────────────────────────────────────
    // Declared in debug-replay-contract.js. The APPLY half is a PORT of the
    // implementation a downstream consumer has been running against this target
    // for months, moved here so the two stop being maintained separately. (An
    // earlier version of this comment said "so the copy can be deleted". That
    // was true of the APPLY HALF and false of the FILE: the downstream copy
    // holds ~196 lines this tree has nothing for — checkpoint capture, a
    // video-frame cache, a DOS trap layer, disassembler integration — so it is
    // a graft, not a deletion.) The RECORD half is new: downstream records at
    // the driver, so a key delivered straight to the target was never logged.
    //
    // THE EPOCH IS A REWIND EPOCH AND IS NOW NAMED ONE. It was
    // `i8086-cycles-reset-N` until 2026-09-10, ported in under that name from
    // the downstream copy, and the name was wrong: this epoch does not bump on
    // a reset. i8086-machine.js:1130 resets the CPU and does `this.cycles += 4`
    // — it ADVANCES by the reset sequence's cost, exactly as the 6502's does.
    // The only backward move is `this.cycles = s.cycles` in loadState
    // (i8086-machine.js:1817); the constructor's `= 0` at :527 is the only
    // other assignment. So it bumps on a REWIND, which is what the z80 and 6502
    // targets have always called it, and this target has stopped being the odd
    // one out.
    //
    // A LOG RECORDED BEFORE THAT RENAME IS NOT REPLAYABLE, and there is no
    // migration. This is written here rather than only in a commit message
    // because the person who needs it is someone staring at a replay that
    // refuses for no visible reason. A replayer compares `domain` by EQUALITY
    // to decide whether two facts came from the same timeline; a log carrying
    // `i8086-cycles-reset-2` and a live run producing `i8086-cycles-rewind-2`
    // describe the same era and will not match. Re-record. The alternative was
    // keeping a name that says "reset" about something that is not a reset, in
    // a surface four targets now copy from, which gets more expensive with each
    // one.
    //
    // NOT EVERY `-reset-` IN THIS TREE IS WRONG. The 8051 adapter's
    // `8051-input-ns-reset-N` is CORRECT and must not be "converged" with this:
    // measured, its epoch bumps at exactly one place, inside its `reset()`
    // (emu8051-adapter.js), and that reset takes its clock to zero. Its epoch
    // really is a reset epoch. The name matches the mechanism on both targets
    // now, which is the point — not that all four should read alike.
    let eventTimeEpoch = 0;
    /**
     * The event clock's domain name. Written out at three sites once the
     * checkpoint needs it, so it is named here instead: a restore starts a new
     * epoch, and a reader comparing two facts must be able to tell that they
     * came from different timelines rather than from one that jumped.
     */
    const eventDomain = () =>
        (eventTimeEpoch ? `i8086-cycles-rewind-${eventTimeEpoch}` : 'i8086-cycles');
    /**
     * State this target cannot capture, because it does not live in the machine.
     * A live board input source is sampled directly and never logged, so a
     * checkpoint taken over one is missing inputs it cannot even enumerate.
     * Declining is the point: a snapshot that silently omits state restores a
     * machine that looks right and is not.
     */
    const hasUncapturedInputState = () => adapter?.unloggedBoardInputs?.() === true;
    let lastEventTicks = -1;
    /** Levels only — see publishInputLevel. Events must not consult this. */
    const observedInputs = new Map();
    let inputListeners = [];

    /**
     * The advancing stamp: reading it is how a rewind gets noticed.
     *
     * A rewind CLEARS the dedup map as well as bumping the epoch. A map that
     * survived would hold levels from an abandoned timeline, and the first
     * genuine change afterwards that happened to match one would be dropped
     * silently — a log shorter than the run, with nothing to show for it.
     */
    const ownClock = (ticks = machine.cycles) => {
        if (ticks < lastEventTicks) eventTimeEpoch++;
        lastEventTicks = ticks;
        return {
            ticks,
            domain: eventDomain(),
            hz: machine.clockHz
        };
    };

    /**
     * THE CLOCK IS INJECTABLE, AND THE EPOCH IS DERIVED RATHER THAN OWNED.
     *
     * `opts.debugTime` lets an integrator hand this target the clock the rest
     * of that integration already uses, instead of this target owning a second
     * one. This particular target does not need it — its one epoch already
     * serves events, checkpoints and replay facts alike, which is why its
     * downstream graft was safe — but it takes the same shape as its siblings
     * so that the three read alike and an integrator does not have to know
     * which of them happens to be the special case.
     *
     * With a clock injected, the domain string is a property of the
     * INTEGRATION rather than of this target. A test here asserting
     * `i8086-cycles-rewind-N` is describing the DEFAULT wiring.
     */
    const clock = typeof opts.debugTime === 'function' ? opts.debugTime : ownClock;

    let lastDomain = null;

    /**
     * Take the stamp, and CLEAR THE DEDUP MAP WHENEVER THE ERA CHANGES.
     *
     * The map must not survive a rewind: it would hold levels from an abandoned
     * timeline, and the first genuine change afterwards whose value happened to
     * match one would be dropped without trace.
     *
     * The signal is the DOMAIN STRING, not a tick regression. An injected clock
     * may know about a rewind this target cannot see — a downstream one is
     * bumped explicitly by `restoreCheckpoint` — so watching the domain
     * inherits every trigger the clock has rather than only the one this target
     * could detect for itself. It is also why the era gate lives HERE rather
     * than inside `ownClock`: an injected clock is not ours to put a side
     * effect in.
     *
     * WHAT REMAINS UNCOVERED, stated rather than hidden: a clock whose own
     * detection is deferred leaves a window where a rewind has happened and the
     * domain has not moved yet, and an input arriving inside it is stamped on
     * the old era. Narrower than detecting nothing.
     */
    const eventTime = (ticks) => {
        const time = ticks === undefined ? clock() : clock(ticks);
        if (lastDomain !== null && time.domain !== lastDomain) observedInputs.clear();
        lastDomain = time.domain;
        return time;
    };

    /**
     * SERIAL IS RECORDED AT THE ADAPTER, which is where the bypass was.
     *
     * Same change as the z80 and 6502 targets and for the same reason: a caller
     * holding the adapter reached the machine without passing anything that
     * could log it. The adapter is the one place every caller passes through.
     *
     * This target keeps its `machine.serialIn` fallback for the many callers
     * that construct it over a bare `{machine}` — there is no adapter to wrap
     * there, and no bypass either, because there is no second route in.
     *
     * `rawSendSerial` is the adapter's true original and is what REPLAY uses;
     * `previousSendSerial` is whatever was there at construction, so two
     * targets over one adapter CHAIN and each records a live byte once without
     * a replay in one leaking a fact into the other.
     */
    const previousSendSerial = typeof adapter?.sendSerial === 'function'
        ? adapter.sendSerial.bind(adapter) : null;
    const rawSendSerial = adapter?.sendSerial?.rootDebugSendSerial ?? previousSendSerial;
    if (previousSendSerial) {
        const wrapped = byte => {
            const value = byte & 0xff;
            const accepted = previousSendSerial(value) === true;
            if (accepted) publishInputEvent('i8086.serial', {byte: value});
            return accepted;
        };
        wrapped.rootDebugSendSerial = rawSendSerial;
        adapter.sendSerial = wrapped;
    }

    const emitInput = (producer, payload, time) => {
        const fact = {time, producer, payload: {...payload}};
        // A copy each: a recorder that stores the object and a listener that
        // mutates it would otherwise corrupt the log in place.
        for (const listener of inputListeners) {
            listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
        }
    };

    /**
     * A LEVEL: a GPIO bit that is already high and is set high again is one
     * state, not two facts.
     *
     * The stamp is taken BEFORE the dedup gate, never after. A suppressed input
     * that skipped the stamp would never notice the timeline moved.
     */
    const publishInputLevel = (producer, key, payload) => {
        const time = eventTime();
        const signature = JSON.stringify(payload);
        if (observedInputs.get(key) === signature) return;
        observedInputs.set(key, signature);
        emitInput(producer, payload, time);
    };

    /**
     * An EVENT: a scancode, a byte, an NMI. The same scancode twice is
     * autorepeat and the same byte twice is two characters; deduplicating
     * either would replay a transcript with something missing.
     */
    const publishInputEvent = (producer, payload) => {
        emitInput(producer, payload, eventTime());
    };
    const halt = (info) => { runState = 'halted'; for (const cb of haltListeners) cb(info); };

    /**
     * Recover the segment-relative position represented by a linear address.
     * The modular distance keeps a CS window that crosses 0xfffff in the same
     * segment. Disassembly and listing progression must share this choice.
     */
    const codePosition = addr => {
        const linear = addr & 0xfffff;
        const currentSegmentBase = (cpu.cs << 4) & 0xfffff;
        const currentIp = (linear - currentSegmentBase) & 0xfffff;
        const ip = currentIp <= 0xffff ? currentIp : linear & 0xffff;
        return {linear, segmentBase: (linear - ip) & 0xfffff, ip};
    };

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
                // RESTORED AFTER THE MODULE ADOPTION TOOK THEM WITH THE
                // PUBLICATION. Both mechanisms stayed in this file and both
                // declarations left with the code that used to publish, so every
                // capability-driven consumer fail-closed on a target that works.
                //
                // `runTo` is the 20-bit physical space: the run-to mechanism is
                // the code breakpoint above, and setBreakpoint accepts any
                // address the bus can carry.
                runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xfffff,
                    stopSides: ['before'], installation: 'sync'}],
                // WHAT IS ACTUALLY PUBLISHED, which is not what lite declared
                // before the adoption. It listed 'interrupt' too; the shared
                // module has no interrupt vocabulary -- zero occurrences -- so
                // this target no longer produces one. Declaring it here would
                // restore the claim without the fact, which is the same defect
                // in the opposite direction and the harder one to find.
                events: ['instruction', 'memory', 'port'],
                // Declared only when the machine can actually checkpoint AND
                // nothing outside it holds state. Advertising a recording a
                // caller cannot complete is the same defect as advertising a
                // breakpoint that never fires.
                recording: !hasUncapturedInputState() && machine.canCheckpoint?.()
                    ? ['checkpoint', 'restore'] : [],
                timeFreezes: true,
                consumes: [],
                // Declared only when the machine can actually take a key. A
                // board with no PPI and no PIC has nowhere to latch a scancode
                // and no wire to raise IRQ1 on, and a host that offered a
                // keyboard for it would be offering one that silently does
                // nothing -- the same reason `steps` does not list 'cycle'.
                keys: machine.canTakeKeys && machine.canTakeKeys() ? ['scancode'] : [],
                // The world a widget or a code block can CHANGE, not just
                // watch. Empty when the machine has no input hardware, on the
                // same terms as `keys`: an affordance appears exactly when the
                // machine can honour it.
                inputs: typeof machine.inputPoints === 'function' ? machine.inputPoints() : [],
                // What a widget can SHOW. Declared like `inputs` and for the
                // same reason: an LED panel on a board with no port chip
                // would be eight lamps that never light, which reads as a
                // broken program rather than an absent chip.
                outputs: typeof machine.outputPoints === 'function'
                    ? machine.outputPoints().map(({ chip, port, bits }) => ({ chip, port, bits }))
                    : [],
                // Whether this target can BE GIVEN symbols, not whether it
                // has any. A host asks this to decide whether the control
                // exists at all; whether it does anything is setSymbols()'s
                // answer, and that is a different question with a different
                // right time to ask it.
                symbols: true,
                // TWO AUDIO CONTRACTS, declared separately because they answer
                // different questions (E6.8.11a): 'tone' is what the hardware
                // is CONFIGURED to produce — exact, free, and what a teaching
                // UI shows beside a buzzer — and 'samples' is what it SOUNDS
                // like, which is the only one that can be mixed. A machine
                // whose chips have no renderAudio() must not advertise
                // 'samples', for the same reason `steps` does not list
                // 'cycle': a control that silently does nothing is worse than
                // an absent one.
                audio: machine.canRenderAudio && machine.canRenderAudio()
                    ? ['tone', 'samples']
                    : ['tone'],
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
            if (typeof machine.keyIn !== 'function') return false;
            const accepted = machine.keyIn(scancode);
            // Only a key the machine TOOK is a fact. A board with no keyboard
            // returns false, and logging that would replay a keystroke that
            // never reached anything.
            if (accepted === true) publishInputEvent('i8086.key', {scancode});
            return accepted;
        },

        /**
         * Drive one input bit -- a switch, a sensor, a button. Returns false
         * rather than pretending when there is nothing to drive.
         *
         * The counterpart to video() and audioTone(): those report what the
         * machine is DOING, and this changes what the machine SEES. A
         * workbench that can only observe is a television.
         */
        /**
         * The output ports, READ FRESH. `capabilities()` lists which ports
         * exist -- a shape that does not change -- and this reports what they
         * are doing right now, because a renderer asks every frame and a value
         * captured in a capability would be a photograph.
         */
        outputs() {
            return typeof machine.outputPoints === 'function' ? machine.outputPoints() : [];
        },

        setInput(chip, port, bit, level) {
            if (typeof machine.setInput !== 'function') return false;
            const accepted = machine.setInput(chip, port, bit, level);
            if (accepted === true) {
                publishInputLevel('i8086.gpio', `${chip}.${port}.${bit}`,
                    {chip, port, bit, level});
            }
            return accepted;
        },

        /**
         * A non-maskable interrupt, driven by the host rather than by the board.
         *
         * The downstream target has had this for as long as the replay surface
         * has; it is here so that copy can go. `machine.nmi()` sets a pending
         * flag (i8086-machine.js:1226) and returns nothing, so the target
         * reports true for "delivered" rather than passing undefined through.
         */
        nmi() {
            if (typeof machine?.nmi !== 'function') return false;
            machine.nmi();
            publishInputEvent('i8086.nmi', {});
            return true;
        },

        /**
         * A received serial byte, RECORDED on the way in.
         *
         * The target had no serial entry point, so a byte reaching the machine
         * through `adapter.sendSerial` passed nothing that could log it. THE
         * BYPASS IS STATED RATHER THAN CLAIMED CLOSED: a caller holding the
         * adapter can still call it directly and will not be recorded.
         */
        sendSerial(byte) {
            // With an adapter this delegates to the WRAPPED method, which is
            // what records; publishing here as well would log a byte twice for
            // a caller who came through the target rather than round it.
            //
            // Without one — several callers construct this target over a bare
            // {machine} — it goes straight to machine.serialIn and records
            // here, because there is no adapter to have wrapped and no second
            // route for a caller to take. i8086-adapter.js:74 is itself a
            // one-line delegation to the same method.
            if (typeof adapter?.sendSerial === 'function') {
                return adapter.sendSerial(byte & 0xff) === true;
            }
            if (typeof machine?.serialIn !== 'function') return false;
            const accepted = machine.serialIn(byte & 0xff) === true;
            if (accepted) publishInputEvent('i8086.serial', {byte: byte & 0xff});
            return accepted;
        },

        /**
         * The RECORD half. `onDebugInput` is the name with a consumer:
         * downstream's `subscribeDebugTargetInputs` returns null without it.
         *
         * @param {(fact: {time: object, producer: string, payload: object}) => void} listener
         * @returns {() => void} unsubscribe
         */
        /**
         * SESSION-SCOPED REASONS THIS TARGET CANNOT REPLAY, collected by
         * `replaySupport`. Empty when there are none.
         *
         * A LIVE BOARD IS THE CASE, and it is the one the contract module named in
         * the abstract months before anyone measured it: a board changes input nets
         * OUTSIDE the debug target, so a restored run silently diverges from the
         * recorded one. The record half here covers this target's own entry points
         * -- the adapter's `syncInputs` is a different class of input and nothing
         * logs it.
         *
         * Until now this target would record such a session, accept a replay, and
         * reproduce a run whose board inputs were never in the log, with nothing
         * saying so. A downstream consumer has declared it for months, as a
         * CHECKPOINT refusal; there is no checkpoint API here, and `replaySupport`
         * is the slot that does exist.
         *
         * NOT A CLAIM THAT RECORDING THEM IS NEXT. Logging every polled pin is what
         * the 8051's deduplication exists to survive, and it is a design question.
         * This converts a silent wrong answer into a stated refusal.
         *
         * @returns {string[]}
         */
        replayRefusalReasons() {
          return adapter?.unloggedBoardInputs?.()
            ? ['live board input sampling is not logged']
            : [];
        },

        /**
         * The EVENT half, mirroring onDebugInput below. Delegated rather than
         * reimplemented: a second publisher of the same facts is how two
         * vocabularies for one thing begin.
         */
        onDebugEvent(listener) {
            return debugEvents.onDebugEvent(listener);
        },

        onDebugInput(listener) {
            if (typeof listener !== 'function') {
                throw new TypeError('debug input listener must be a function');
            }
            inputListeners.push(listener);
            return () => { inputListeners = inputListeners.filter(l => l !== listener); };
        },

        /** The event clock, READ without advancing it. See eventTime(). */
        /**
         * A checkpoint of the MACHINE plus this target's own bookkeeping.
         *
         * The machine's envelope is not enough on its own: run state, a pending
         * step and the event-clock epoch live here, are not derivable from the
         * machine, and a restore without them single-steps into the wrong place.
         */
        captureCheckpoint() {
            if (hasUncapturedInputState()) {
                return {code: 'INCOMPLETE_CHECKPOINT_STATE',
                    refused: 'a live board input source is sampled outside the machine and cannot be captured'};
            }
            const checkpoint = machine.captureCheckpoint();
            if (checkpoint.refused) return checkpoint;
            // The debug event clock, not the machine's base time: a consumer
            // comparing this against a debug fact must get one clock, not two.
            checkpoint.time = {ticks: machine.cycles, domain: eventDomain(), hz: machine.clockHz};
            checkpoint.debugger = {runState, pendingStep: pendingStep ? {...pendingStep} : null,
                eventTimeEpoch, lastEventTicks};
            return checkpoint;
        },

        restoreCheckpoint(snapshot) {
            if (!snapshot || !snapshot.debugger) {
                return {code: 'INVALID_CHECKPOINT', refused: 'checkpoint has no 8086 debugger state'};
            }
            if (hasUncapturedInputState()) {
                return {code: 'INCOMPLETE_CHECKPOINT_STATE',
                    refused: 'cannot restore over a live board input source outside the machine'};
            }
            // VALIDATE BEFORE THE MACHINE MUTATES. machine.restoreCheckpoint is
            // itself atomic -- it refuses without applying -- so the only way to
            // half-apply is to let the machine succeed and then reject the
            // debugger half. Both halves are checked first.
            const state = snapshot.debugger.runState;
            if (state !== 'running' && state !== 'halted') {
                return {code: 'INVALID_CHECKPOINT', refused: 'invalid debugger run state'};
            }
            const stepState = snapshot.debugger.pendingStep;
            if (stepState !== null && (!stepState || typeof stepState !== 'object' ||
                !['insn', 'over', 'out'].includes(stepState.kind))) {
                return {code: 'INVALID_CHECKPOINT', refused: 'invalid pending instruction step'};
            }
            const machineRefusal = machine.restoreCheckpoint(snapshot);
            if (machineRefusal) return machineRefusal;
            runState = state;
            pendingStep = stepState ? {...stepState} : null;
            syncEventHooks();
            // A restore is a BRANCH in history, not permission to run the event
            // clock backwards. A fresh epoch renames the domain, so two facts
            // from different timelines cannot be read as one timeline that
            // jumped. eventTime's own rewind detection cannot see this case: a
            // restore landing ABOVE the last stamped tick looks like ordinary
            // forward motion.
            eventTimeEpoch++;
            lastEventTicks = machine.cycles;
            watchHit = null;
            eventHit = null;
            return true;
        },

        /** Retire exactly one instruction boundary, for verified replay. */
        replayInstruction() {
            if (hasUncapturedInputState() || !machine.canCheckpoint?.()) {
                return {accepted: false, code: 'unsupported-replay',
                    reason: '8086 machine state is not completely replayable'};
            }
            if (cpu.halted) {
                return {accepted: false, code: 'halted-without-instruction',
                    reason: 'the halted CPU cannot retire an instruction without a recorded wake input'};
            }
            const before = machine.cycles;
            machine.step();
            return {accepted: true, boundary: 'instruction', cycles: machine.cycles - before};
        },

        debugTime() {
            return {
                ticks: machine.cycles,
                domain: eventDomain(),
                hz: machine.clockHz
            };
        },

        /**
         * Pure preflight: can this exact fact be applied right now?
         *
         * Consumed by the runner before it decides to replay at all, which is
         * why it stays a separate member rather than folding into the apply
         * half. Ported unchanged in behaviour from the downstream copy.
         */
        canApplyReplayInput(input) {
            return this.replayInputRefusal(input) === null;
        },

        /**
         * WHY THE REFUSALS ARE SEPARATED, when the ported version returned one
         * code for all of them. Downstream answered a malformed payload, an
         * unsupported producer and a board with no keyboard with the same
         * `invalid-replay-input`, and the third is not the caller's fault at
         * all — it is a fact about the hardware. Measured before changing it:
         * no consumer reads the code (the runner reads `.accepted`, and the two
         * replay drivers discard the result), so refining it breaks nothing.
         *
         * @returns {{code: string, reason: string}|null} null when applicable
         */
        replayInputRefusal(input) {
            const p = input?.payload;
            // EVERY REACH OUTSIDE THIS CLOSURE IS CHECKED HERE, not at the call
            // site that happened to be written last. Callers construct this
            // target over a bare `{machine}` — code-address-progression.test.mjs
            // :32 builds `{machine: {cpu: {}}}` literally — so `machine.chips`,
            // `machine.canTakeKeys` and the rest are frequently absent, and the
            // contract's central rule is that a target refuses rather than
            // throwing for an input it merely cannot serve.
            const has = name => typeof machine?.[name] === 'function';
            const chips = machine?.chips && typeof machine.chips === 'object'
                ? machine.chips : null;
            if (!p || typeof p !== 'object') {
                return {code: 'invalid-replay-input', reason: 'a replay input needs a payload object'};
            }
            switch (input.producer) {
            case 'i8086.key':
                if (!(Number.isInteger(p.scancode) && p.scancode >= 0 && p.scancode <= 0xff)) {
                    return {code: 'invalid-replay-input', reason: 'i8086.key needs a scancode in 0..255'};
                }
                if (!has('canTakeKeys') || !has('keyIn')) {
                    return {code: 'no-input-path', reason: 'this target has no machine that can take a key'};
                }
                if (machine.canTakeKeys() !== true) {
                    return {code: 'no-input-path', reason: 'this board has no 8255 + PIC to take a key'};
                }
                return null;
            case 'i8086.gpio': {
                const chip = chips && typeof p.chip === 'string' ? chips[p.chip] : null;
                if (!(['a', 'b', 'c'].includes(p.port) && Number.isInteger(p.bit) &&
                      p.bit >= 0 && p.bit <= 7 && (p.level === 0 || p.level === 1))) {
                    return {code: 'invalid-replay-input',
                        reason: 'i8086.gpio needs port a|b|c, bit 0..7 and level 0|1'};
                }
                if (!chip || typeof chip.setInput !== 'function' || !has('setInput')) {
                    return {code: 'no-input-path',
                        reason: `no chip named ${p.chip} on this board takes an input bit`};
                }
                return null;
            }
            case 'i8086.serial':
                if (!(Number.isInteger(p.byte) && p.byte >= 0 && p.byte <= 0xff)) {
                    return {code: 'invalid-replay-input', reason: 'i8086.serial needs a byte in 0..255'};
                }
                // THE PREFLIGHT TESTS WHAT serialIn TESTS, both branches.
                // machine.serialIn (i8086-machine.js:1423) accepts a chip with
                // rxPush OR one with rxByte; the ported preflight tested only
                // rxPush, so the two could disagree about the same board.
                //
                // Measured, so the reason for the second branch is not
                // overstated: NO chip in this tree exposes an `rxByte` method
                // today — the 16550 and the 8251 both use rxPush, and that
                // branch of serialIn has no implementor. The point is not that
                // a board exists which needs it; it is that a preflight must
                // answer the question the operation asks, so that adding such a
                // chip does not silently start refusing a path it has.
                if (!chips || !has('serialIn') || !Object.values(chips).some(
                    c => typeof c?.rxPush === 'function' || typeof c?.rxByte === 'function')) {
                    return {code: 'no-input-path', reason: 'no chip on this board receives a byte'};
                }
                return null;
            case 'i8086.nmi':
                if (Object.keys(p).length !== 0) {
                    return {code: 'invalid-replay-input', reason: 'i8086.nmi carries no payload'};
                }
                return has('nmi') ? null
                    : {code: 'no-input-path', reason: 'this target has no machine to interrupt'};
            case 'i8086.rom':
                if (!(p.bytes instanceof Uint8Array)) {
                    return {code: 'invalid-replay-input', reason: 'i8086.rom needs bytes as a Uint8Array'};
                }
                if (!(p.at === undefined ||
                      (Number.isInteger(p.at) && p.at >= 0 && p.at < 0x100000))) {
                    return {code: 'invalid-replay-input', reason: 'i8086.rom `at` must be inside 1MB'};
                }
                return has('loadRom') && has('reset') ? null
                    : {code: 'no-input-path', reason: 'this target has no machine to load a ROM into'};
            default:
                return {code: 'unsupported-replay-input',
                    reason: `no replay path for producer ${input?.producer ?? '(none)'}`};
            }
        },

        /**
         * The APPLY half. Every failure is a return value, never a throw.
         *
         * Five producers, all five with a measured path in THIS build:
         *
         *   i8086.key     machine.keyIn        i8086-machine.js:1574
         *   i8086.gpio    machine.setInput     i8086-machine.js:1558
         *   i8086.serial  adapter.sendSerial   i8086-adapter.js:74
         *   i8086.nmi     machine.nmi          i8086-machine.js:1226
         *   i8086.rom     machine.loadRom      i8086-machine.js:1118
         *
         * NOTHING APPLIED HERE IS RE-RECORDED. Each path reaches the machine
         * directly rather than through this target's own recording entry
         * points; the one that needs a gate is the GPIO level, whose dedup map
         * is seeded so a second replay pass does not read as a change.
         */
        applyReplayInput(input) {
            const refusal = this.replayInputRefusal(input);
            if (refusal) return replayRefused(refusal.code, refusal.reason);
            const p = input.payload;
            switch (input.producer) {
            case 'i8086.key':
                return machine.keyIn(p.scancode) === true ? replayAccepted()
                    : replayRefused('no-input-path', 'the machine did not take the key');
            case 'i8086.gpio': {
                const applied = machine.setInput(p.chip, p.port, p.bit, p.level) === true;
                if (applied) {
                    // THE ERA GATE RUNS BEFORE THE SEED, and the order is
                    // load-bearing. Measured on the landed sibling targets:
                    // replaying an input immediately after a rewind
                    // RE-RECORDED it, because the seed went into the map and
                    // the publish path then cleared the map before the dedup
                    // gate read it — a second replay pass producing a log
                    // longer than the run, in the one moment replay actually
                    // happens, just after a restore.
                    eventTime();
                    observedInputs.set(`${p.chip}.${p.port}.${p.bit}`,
                        JSON.stringify({chip: p.chip, port: p.port, bit: p.bit, level: p.level}));
                }
                return applied ? replayAccepted()
                    : replayRefused('no-input-path', 'the machine did not take the input bit');
            }
            case 'i8086.serial': {
                // The adapter's UNWRAPPED method when there is one, so a
                // replayed byte does not come back out of the recorder — or out
                // of another target's recorder, if two share the adapter.
                const deliver = rawSendSerial ?? (b => machine.serialIn(b));
                return deliver(p.byte) === true ? replayAccepted()
                    : replayRefused('no-input-path', 'no chip took the received byte');
            }
            case 'i8086.nmi':
                machine.nmi();
                return replayAccepted();
            case 'i8086.rom':
                machine.loadRom(p.bytes, p.at);
                machine.reset();
                return replayAccepted();
            default:
                // Unreachable: replayInputRefusal has already refused it. Kept
                // so a new producer added to one switch and not the other is a
                // refusal rather than a silent `accepted: true` fall-through,
                // which is what the ported version did.
                return replayRefused('unsupported-replay-input',
                    `no replay path for producer ${input?.producer ?? '(none)'}`);
            }
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
            const {linear, segmentBase, ip} = codePosition(addr);
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
                    const offset = (lin - segmentBase) & 0xfffff;
                    if (offset <= 0xffff) inSeg.set(offset, name);
                }
            }
            return disasmI8086((x) => machine._read(x & 0xfffff), linear,
                inSeg && inSeg.size ? { ip, labels: inSeg } : { ip });
        },

        /** Advance through segmented fetch while retaining a linear address. */
        nextCodeAddress(addr, length) {
            if (!Number.isSafeInteger(addr) || addr < 0 || addr > 0xfffff ||
                !Number.isSafeInteger(length) || length < 0) {
                return { unsupported: 'code address progression requires safe integers in 20-bit physical space' };
            }
            const {segmentBase, ip} = codePosition(addr);
            return (segmentBase + ((ip + (length & 0xffff)) & 0xffff)) & 0xfffff;
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
                const len = spec.len ?? 1;
                if (!Number.isSafeInteger(spec.addr) || spec.addr < 0 ||
                    !Number.isSafeInteger(len) || len < 1 || spec.addr + len > 0x100000) {
                    return { unsupported:
                        'write watchpoint range must be safe integers within 20-bit physical space' };
                }
                const id = nextBpId++;
                // The range guard already proves addr <= 0xfffff, so the old
                // `& 0xfffff` would be an identity here. Store the exact value;
                // restoring that mask cannot change any accepted input.
                writeWatches.set(id, { addr: spec.addr, len });
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
            // seg:off is an explicitly different input: each register is
            // 16-bit hardware and the composed bus address wraps at 20 bits.
            // A direct address is already physical, so masking it would turn
            // invalid input into a breakpoint on a different instruction.
            let addr;
            if (spec.seg != null) {
                addr = (((spec.seg & 0xffff) << 4) + (spec.addr & 0xffff)) & 0xfffff;
            } else {
                if (!Number.isSafeInteger(spec.addr) || spec.addr < 0 || spec.addr > 0xfffff) {
                    return { unsupported:
                        'code breakpoint addr must be a safe integer within 20-bit physical space' };
                }
                addr = spec.addr;
            }
            const id = nextBpId++;
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
                // THE RETURN ADDRESS IS KNOWN NOW, and knowing it is what stops
                // the step ending inside the callee. Decode the call and add its
                // length: a near call returns to the byte after itself, and the
                // composed address wraps at 20 bits like every other bus address
                // here while IP wraps at 16.
                const decoded = disasmI8086(a => machine._read(a & 0xfffff), cpu.pc, { ip: cpu.ip });
                pendingStep = {
                    kind: 'over', sp0: cpu.sp, entered: false,
                    returnAddr: (((cpu.cs << 4) + ((cpu.ip + decoded.length) & 0xffff)) & 0xfffff)
                };
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
            // The same test as `tMs < tMs + budgetNs / 1e6` with the common
            // factors cancelled, in the integer the machine already keeps.
            // DO NOT ROUND: any positive budget must still retire one whole
            // instruction, exactly as the strict float comparison did, or a
            // caller asking for a small slice gets no progress and the machine
            // appears hung.
            const deadlineCycles = machine.cycles + budgetNs * machine.clockHz / 1e9;
            while (machine.cycles < deadlineCycles) {
                // The overwhelmingly common run has no code breakpoint, and
                // constructing a Map iterator per instruction for an empty Map
                // is a cost paid by every program that never sets one. The
                // watch and event traps already install themselves only when
                // something is watching; this is the same discipline for the
                // one check that did not.
                if (breakpoints.size) {
                    for (const [id, bp] of breakpoints) {
                        if (bp.addr === cpu.pc) { halt({ cause: 'breakpoint', bp: id }); return 'halted'; }
                    }
                }
                if (pendingStep) {
                    if (pendingStep.kind === 'insn' && pendingStep.remaining <= 0) { halt({ cause: 'step' }); return 'halted'; }
                    // SP rising back to or above where it started means the
                    // frame is gone. Sixteen-bit wraparound is why the test
                    // is a sign check on the difference, not a comparison.
                    // BOTH, and the stack alone is why this used to be wrong. A
                    // callee that pops its return address, works, and pushes it
                    // back balances the stack mid-body, and a stack-only test
                    // halts there -- inside the function the user asked to step
                    // OVER, reporting cause 'step' at a plausible address with
                    // nothing thrown.
                    if (pendingStep.kind === 'over' && pendingStep.entered
                        && cpu.pc === pendingStep.returnAddr
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
            // Rendering text mode alone costs about 8 ms on the measured Node
            // path, and a static DOS prompt was paying it on every call for a
            // picture that had not changed. Key the cache on the machine's
            // display revision -- the token that moves on exactly the writes
            // that can change what is on screen -- plus the inputs the render
            // depends on that the token does not cover.
            //
            // THE FRAME NUMBER IS PART OF THE POINT, not decoration: a consumer
            // that keys its own repaint on it freezes after the first paint if
            // it never moves.
            const videoKey = `${machine.displayRevision || 0}:${guess.mode}:`
                + `${seen.join(',')}:${vo.blinkPhase ?? ''}`;
            if (videoKey === cachedVideoKey && cachedVideoFrame) return cachedVideoFrame;
            const frame = renderMode(guess.mode, (a) => machine._read(a & 0xfffff), vo);
            cachedVideoKey = videoKey;
            cachedVideoFrame = { ...frame, frame: machine.displayRevision || 0,
                mode: guess.mode, why: guess.reason };
            return cachedVideoFrame;
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
