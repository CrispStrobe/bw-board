/**
 * emu8051-stc debug target — boundary D (DEBUG-CONTROL-MODEL.md §7).
 *
 * The sibling of emu8051-adapter.js: that one bridges the emulator to the BOARD
 * (boundary A, pins and time), this one bridges it to a DEBUGGER (run control,
 * breakpoints, memory, Level 1 position). They share a WASM instance and are
 * otherwise independent — a project can simulate without debugging, and the
 * conformance kit does exactly that.
 *
 * The WASM already implements all of it in C (`debug.c`, `wasm_api.c`). This
 * wrapper exists for three reasons, and the third is the important one:
 *
 *   1. shape — the C API is flat ints; the contract is objects and refusals.
 *   2. symbols — `(task, state)` is an index in the WASM and a NAME everywhere
 *      else, so somebody has to hold the mapping. That is the front end's
 *      symbol table, which arrives as JSON from stc_symtab.py.
 *   3. HONESTY — the C says yes to two things it does not really do, and a
 *      front end that believes it would mislead the user. Both are corrected
 *      here rather than passed through. See "Two corrections" below.
 *
 * ## Two corrections, one of which the emulator has since adopted
 *
 * **`step('line')` is refused.** `dbg_step` used to return success for every
 * kind while its STEP_LINE branch was commented "Would need a line table. For
 * now, treat as step-insn." A line table is exactly what the WASM has no way
 * to receive, so a front end asking to step one C line would get one
 * INSTRUCTION and no indication of the difference — the failure
 * DEBUG-CONTROL-MODEL §1 exists to prevent ("a target refuses by returning a
 * reason, never by silently doing something else"). This wrapper has always
 * refused it. As of emu8051-stc cf3c7c0 **the emulator refuses it too**:
 * `emu_dbg_supports_step(STEP_LINE)` is 0 and `emu_dbg_step(1, n)` returns -1.
 * The correction is still made here, because the pin can move backwards.
 *
 * **Watchpoints are feature-detected**, and the wording that used to be here
 * was wrong in a way worth recording: it said "older builds (the pinned one in
 * brickwright-lite) do not [export `emu_dbg_set_bp_write`]". Instantiated, the
 * binary lite pinned exported it all along — the claim came from this comment
 * rather than from the binary, and a lesson hint was written around it. Write
 * watchpoints require a `space` because iram and sfr overlap at 0x80+. Read
 * watchpoints remain unsupported in every build: a read changes no state, so a
 * polling detector cannot see one.
 *
 * ## What a write watchpoint here actually is
 *
 * A CHANGE detector sampled at instruction boundaries, not a store detector.
 * A store of the value already there is invisible; an SFR the peripherals move
 * fires with no instruction responsible (and the reported `pc` is where
 * execution happened to be, not the writer); two changes inside one
 * instruction report only the last. That is why a watchpoint halt carries
 * `prev` alongside `value` — the transition is the evidence.
 *
 * ## The cycle step
 *
 * Offered only when the build asserts it (`emu_dbg_supports_step`), and this
 * is the one target that can. `tick()` in the emulator advances ONE oscillator
 * clock and returns false while the instruction in flight finishes, so there
 * is a real place to stop between instructions. The other targets in this
 * repo — 6502, Z80, avr8js, rp2040js — execute a whole instruction per call
 * and have no such place, so they refuse `cycle` by name rather than deliver
 * an instruction step wearing a different label.
 *
 * ## Memory reads: fast path and slow path
 *
 * `readMem` feature-detects `HEAPU8` and `_emu_dbg_read_mem`. When available
 * (upstream builds after the HEAPU8 export), a 256-byte read is one WASM call.
 * When absent (the pinned build in brickwright-lite), it falls back to
 * value-returning accessors (`emu_get_code/_iram/_sfr/_xdata`), one call per
 * byte — the same code that was here before, still correct, just slower.
 *
 * The halt reason used to be unreachable in every build — it arrives at the
 * on-halt callback as a `struct dbg_halt_reason *`, a layout JS must not
 * assume — so `bp_id` was recovered by matching the halted PC against known
 * breakpoints. That works for code and yield breakpoints and cannot work for a
 * watchpoint, whose subject is an address rather than a PC. As of emu8051-stc
 * cf3c7c0 the reason is readable as scalars (`_emu_dbg_halt_bp`,
 * `_emu_dbg_halt_is_watch`, `_emu_dbg_halt_watch_addr/_value/_prev`), so the
 * breakpoint is NAMED rather than guessed. The PC-matching path is still here
 * for older pins.
 *
 * ## The budget-halt wart, absorbed
 *
 * `emu_dbg_run_until_ns` **halts the target when it runs out of budget** — and
 * `dbg_halt` fires the on-halt callback with HALT_USER. Run it once per
 * animation frame, as any real host must, and a UI subscribed to onHalt sees a
 * "halt" sixty times a second while the program is merrily running.
 *
 * `runFor()` therefore suppresses that callback and reports the outcome as a
 * return value instead: `'halted'` (a real stop the user should see) or
 * `'budget'` (this slice is over, call again). Nothing above this line ever
 * learns that the emulator technically stopped.
 *
 * @module
 */

/** Step kinds, in the order dbg_step_kind declares them. Appended, never renumbered. */
const STEP_KIND = { insn: 0, line: 1, block: 2, over: 3, out: 4, cycle: 5 };

/** Address spaces, in the order dbg_space declares them. */
const SPACE = { code: 0, iram: 1, sfr: 2, xram: 3, bit: 4 };

/** The same table read the other way, for turning a reported space back into a name. */
const SPACE_NAME = Object.keys(SPACE);

/** DBG_MAX_BP in debug.h. Exceeding it returns -1, which we turn into a reason. */
const MAX_BREAKPOINTS = 32;

/**
 * @typedef {object} SymbolTable stc_symtab.py's output (format 004)
 * @property {number} [fosc]
 * @property {string} [device]
 * @property {{bw_ms: {addr: number}, tasks: Array<object>}} scheduler
 */

/**
 * Wrap a loaded emu8051-stc WASM module as a DebugTarget.
 *
 * @param {object} wasm the Emscripten module instance
 * @param {object} [opts]
 * @param {SymbolTable} [opts.symbols] load it now instead of calling setSymbols
 * @returns {object} the DebugTarget
 */
export function createEmu8051DebugTarget(wasm, opts = {}) {
    const need = [
        '_emu_dbg_state', '_emu_dbg_run', '_emu_dbg_halt', '_emu_dbg_step',
        '_emu_dbg_reset', '_emu_dbg_run_until_ns', '_emu_dbg_read_mem',
        '_emu_dbg_write_mem', '_emu_dbg_pc'
    ];
    const missing = need.filter((k) => typeof wasm[k] !== 'function');
    if (missing.length) {
        throw new Error(
            `this emu8051 build has no debug surface (missing ${missing.join(', ')}). ` +
            'It predates boundary D; re-vendor from a build that exports emu_dbg_*.'
        );
    }

    /** Task name -> the index the WASM knows it by. Empty until symbols arrive. */
    const taskIndex = new Map();
    /** "<task>/<state>" -> code address, for yield breakpoints. */
    const yieldAddr = new Map();
    /** Handle -> the Breakpoint it was set from, so we can describe a hit. */
    const breakpoints = new Map();

    let symbols = null;
    let listeners = [];
    /**
     * Set while runFor is inside emu_dbg_run_until_ns. Every halt that arrives
     * in that window is swallowed: the budget expiring is one of them and is
     * not a user-visible event, and the real ones are re-announced by runFor
     * from the return value, which is the only thing that distinguishes them
     * without the struct.
     */
    let inBudgetedRun = false;
    /**
     * Why we last asked the target to stop, so a halt can be described without
     * reading `cause` out of the unreachable struct. Null means nobody asked —
     * which, if the target stopped anyway, means a breakpoint.
     */
    let pendingCause = null;
    /** True between step() and the halt that ends it. */
    let stepping = false;
    let haltCbPtr = null;
    let detached = false;

    // ─── the halt callback ───────────────────────────────────────────────

    /**
     * Which breakpoint stopped us. `bp_id` lives in the struct we cannot read,
     * so match on the halted PC instead: a yield breakpoint is set AT its
     * address and a code breakpoint is the address. Ambiguity is reported as
     * "don't know" rather than resolved by picking one.
     */
    function breakpointAt(pc) {
        const hits = [...breakpoints.entries()].filter(([, bp]) => bp.pc === pc);
        return hits.length === 1 ? hits[0] : null;
    }

    /** Does this build report its halt reason as scalars? (emu8051-stc cf3c7c0+) */
    const hasHaltReason = typeof wasm._emu_dbg_halt_is_watch === 'function'
        && typeof wasm._emu_dbg_halt_bp === 'function';

    /**
     * Does this build implement a real cycle step? Asked of the emulator, not
     * inferred: `emu_dbg_supports_step` reports what dbg_step ACTUALLY does,
     * which is not the same as what it accepts (it accepts `line` and delivers
     * an instruction). On builds without the export the answer is no.
     */
    const hasCycleStep = typeof wasm._emu_dbg_supports_step === 'function'
        && wasm._emu_dbg_supports_step(STEP_KIND.cycle) === 1;

    function haltReason(cause) {
        const pc = wasm._emu_dbg_pc();

        // The old path, kept for builds that predate the halt-reason exports:
        // `bp_id` lived in a struct JS cannot read, so the breakpoint was
        // recovered by matching the halted PC. That works for code and yield
        // breakpoints — both are set AT an address — and CANNOT work for a
        // watchpoint, whose "pc" we recorded as the watched ADDRESS because
        // there was nothing better to key on. Two breakpoints at one address
        // were reported as "don't know which" rather than resolved by picking.
        if (!hasHaltReason) {
            const hit = cause === 'breakpoint' ? breakpointAt(pc) : null;
            return {
                cause, pc,
                bp: hit ? hit[0] : undefined,
                bpKind: hit ? hit[1].kind : undefined,
                tasks: positionOf(), tNs: nowNs(), skewNs: 0n
            };
        }

        // The emulator now names the breakpoint itself, so nothing is guessed.
        const bpId = wasm._emu_dbg_halt_bp();
        const bp = bpId >= 0 ? breakpoints.get(bpId) : undefined;
        const why = {
            cause, pc,
            bp: bp ? bpId : undefined,
            bpKind: bp ? bp.kind : undefined,
            tasks: positionOf(),
            tNs: nowNs(),
            // Zero, always, and not because nothing was measured: an emulator
            // halts time itself, so no wall clock ran on without it. The field
            // exists so a live chip can say otherwise (§7 decision 4).
            skewNs: 0n
        };

        // A write watchpoint is the one halt whose subject is an ADDRESS, not
        // a PC. Reporting only "halted at 0x0142" answers a question nobody
        // asked. `prev` travels with `value` because the transition is the
        // evidence — a new value with no before is half a measurement.
        if (cause === 'breakpoint' && wasm._emu_dbg_halt_is_watch() === 1) {
            why.cause = 'watchpoint';
            why.space = SPACE_NAME[wasm._emu_dbg_halt_watch_space()] ?? 'iram';
            why.addr = wasm._emu_dbg_halt_watch_addr();
            why.value = wasm._emu_dbg_halt_watch_value();
            why.prev = wasm._emu_dbg_halt_watch_prev();
        }
        return why;
    }

    function announce(cause) {
        const why = haltReason(cause);
        for (const cb of listeners) cb(why);
        return why;
    }

    function onHaltFromWasm() {
        if (inBudgetedRun) return;      // runFor speaks for this window
        const cause = pendingCause || 'breakpoint';
        pendingCause = null;
        announce(cause);
    }

    if (wasm.addFunction && wasm._emu_dbg_set_on_halt) {
        // `void (*)(struct dbg_halt_reason *, void *)` — two pointers, no
        // return. Both are ignored: see the header on why the struct is
        // unreadable from JS.
        haltCbPtr = wasm.addFunction(onHaltFromWasm, 'vii');
        wasm._emu_dbg_set_on_halt(haltCbPtr);
    }

    function nowNs() {
        return (BigInt(wasm._emu_get_time_ns_hi() >>> 0) << 32n)
             | BigInt(wasm._emu_get_time_ns_lo() >>> 0);
    }

    /**
     * One byte out of one address space, using only value-returning calls.
     * Mirrors dbg_read_mem's switch exactly, including the bit-space derivation
     * (0x00–0x7F are the bits of IRAM 0x20–0x2F; 0x80 and up are the bits of the
     * SFRs at addresses divisible by 8).
     */
    function readByte(space, a) {
        switch (space) {
        case 'code': return wasm._emu_get_code(a);
        case 'iram': return wasm._emu_get_iram(a);
        case 'sfr':  return (a >= 0x80 && a <= 0xFF) ? wasm._emu_get_sfr(a) : 0;
        case 'xram': return wasm._emu_get_xdata(a);
        case 'bit': {
            const byte = a < 0x80
                ? wasm._emu_get_iram(0x20 + (a >> 3))
                : wasm._emu_get_sfr(a & 0xF8);
            return (byte >> (a & 7)) & 1;
        }
        default: return 0;
        }
    }

    // ─── Level 1 position ────────────────────────────────────────────────

    /**
     * Where every task is, per DEBUG-CONTROL-MODEL §2. Three RAM reads and no
     * instrumentation — which is why this works on silicon too.
     */
    function positionOf() {
        if (!symbols) return undefined;
        const out = [];
        for (const [name, idx] of taskIndex) {
            const state = wasm._emu_dbg_task_state(idx);
            const entry = { task: name, state };
            // 0xFFFF is "ran to the end", and a task that has finished is not
            // waiting for anything — reporting `until` there would invite a
            // front end to render a deadline that means nothing.
            if (state !== 0xFFFF) {
                const until = wasm._emu_dbg_task_until(idx);
                if (until) entry.until = until;
            }
            out.push(entry);
        }
        return out;
    }

    function loadSymbols(table) {
        symbols = table;
        taskIndex.clear();
        yieldAddr.clear();
        const sched = table && table.scheduler;
        if (!sched) return { tasks: 0, yields: 0 };

        if (sched.bw_ms && wasm._emu_dbg_set_bw_ms_addr) {
            wasm._emu_dbg_set_bw_ms_addr(sched.bw_ms.addr);
        }
        const tasks = sched.tasks || [];
        let yields = 0;
        tasks.forEach((task, i) => {
            if (i >= 8) return;           // wasm_tasks[8] in wasm_api.c
            taskIndex.set(task.name, i);
            wasm._emu_dbg_set_task(
                i,
                task.state ? task.state.addr : 0,
                task.until ? task.until.addr : 0
            );
            for (const y of task.yields || []) {
                if (typeof y.addr === 'number') {
                    yieldAddr.set(`${task.name}/${y.state}`, y.addr);
                    yields++;
                }
            }
        });
        if (tasks.length > 8) {
            // Say it rather than quietly debugging the first eight.
            return { tasks: 8, yields, dropped: tasks.length - 8 };
        }
        return { tasks: taskIndex.size, yields };
    }

    if (opts.symbols) loadSymbols(opts.symbols);

    // ─── the target ──────────────────────────────────────────────────────

    const target = {
        capabilities() {
            // Feature-detect watchpoints: available if _emu_dbg_set_bp_write exists
            const hasWatchpoints = typeof wasm._emu_dbg_set_bp_write === 'function';

            return {
                // `line` is absent on purpose — see "Two corrections" above.
                // `cycle` is present only when the build ASSERTS it, and the
                // export's absence is the answer for older pins. Asking the
                // emulator beats guessing from a version number, and beats
                // assuming: a cycle step is only honest on a core with
                // sub-instruction state, which is why no other target here
                // offers one.
                steps: hasCycleStep
                    ? ['insn', 'cycle', 'block', 'over', 'out']
                    : ['insn', 'block', 'over', 'out'],
                breakpoints: hasWatchpoints
                    ? ['code', 'yield', 'write']
                    : ['code', 'yield'],
                spaces: ['code', 'iram', 'sfr', 'xram', 'bit'],
                writable: ['code', 'iram', 'sfr', 'xram', 'bit'],
                sfrs: 'all',
                haltPolicy: 'freeze-timers',
                timeFreezes: true,
                // An emulator takes nothing from the program: no timer, no
                // UART, no pin. The on-chip monitor is the one that has to
                // confess here (§7 decision 5).
                consumes: []
            };
        },

        state() {
            if (detached) return 'detached';
            return wasm._emu_dbg_state() === 1 ? 'running' : 'halted';
        },

        run() {
            stepping = false;
            pendingCause = null;
            wasm._emu_dbg_run();
        },

        halt() {
            pendingCause = 'user';
            wasm._emu_dbg_halt();
        },

        step(kind, count = 1) {
            if (kind === 'line') {
                return { unsupported:
                    'stepping one C line needs a line table, which this emulator has no ' +
                    'way to receive. Step one instruction, or one block.' };
            }
            if (kind === 'cycle' && !hasCycleStep) {
                return { unsupported:
                    'this emulator build has no cycle step. Re-vendor from a build that ' +
                    'exports emu_dbg_supports_step, or step one instruction.' };
            }
            const k = STEP_KIND[kind];
            if (k === undefined) return { unsupported: `no such step kind: ${kind}` };
            stepping = true;
            pendingCause = 'step';
            // -1 means the emulator itself declined the kind. Passing that back
            // matters: the alternative is reporting "stepping" for a step that
            // never started, and then waiting for a halt that never comes.
            if (wasm._emu_dbg_step(k, count) < 0) {
                stepping = false;
                pendingCause = null;
                return { unsupported: `this emulator build does not implement step kind: ${kind}` };
            }
            return undefined;
        },

        reset() {
            stepping = false;
            pendingCause = null;
            wasm._emu_dbg_reset();
            // Breakpoints deliberately survive: `dbg_reset` resets the CPU and
            // the peripherals and does not touch `t->bps`, so the emulator will
            // still stop at them. Clearing our record here would leave the two
            // sides disagreeing and every later hit reported as "some
            // breakpoint, don't know which" — which is how this was written
            // first, and what the test now pins down. Restarting a program is
            // also not a reason to lose the breakpoints you set in it.
        },

        setBreakpoint(bp) {
            if (!bp || typeof bp !== 'object') return { unsupported: 'not a breakpoint' };
            if (breakpoints.size >= MAX_BREAKPOINTS) {
                return { unsupported:
                    `this emulator holds ${MAX_BREAKPOINTS} breakpoints and they are all in use` };
            }
            let handle;
            let pc;                       // where a hit will leave the PC
            if (bp.kind === 'code') {
                pc = bp.addr & 0xFFFF;
                handle = wasm._emu_dbg_set_bp_code(pc);
            } else if (bp.kind === 'yield') {
                const idx = taskIndex.get(bp.task);
                if (idx === undefined) {
                    return { unsupported: symbols
                        ? `no task named ${bp.task} in the symbol table`
                        : 'a yield breakpoint needs a symbol table; call setSymbols first' };
                }
                const addr = yieldAddr.get(`${bp.task}/${bp.state}`);
                if (addr === undefined) {
                    return { unsupported:
                        `the symbol table has no address for ${bp.task} state ${bp.state}` };
                }
                pc = addr;
                handle = wasm._emu_dbg_set_bp_yield(addr, idx, bp.state);
            } else if (bp.kind === 'write') {
                if (typeof wasm._emu_dbg_set_bp_write !== 'function') {
                    return { unsupported:
                        'this build exposes no watchpoints. Poll the variable between blocks ' +
                        'instead — and label that as sampling, because it is.' };
                }
                // Watchpoint: requires a space (iram and sfr overlap at 0x80+)
                const space = bp.space ?? 'iram';
                const spaceId = SPACE[space];
                if (spaceId === undefined) {
                    return { unsupported: `no such address space: ${space}` };
                }
                handle = wasm._emu_dbg_set_bp_write(spaceId, bp.addr);
                pc = bp.addr; // for matching on halt
            } else if (bp.kind === 'read') {
                return { unsupported:
                    'read watchpoints are not available. Write watchpoints are ' +
                    (typeof wasm._emu_dbg_set_bp_write === 'function' ? 'available' : 'also not available') +
                    '.' };
            } else {
                return { unsupported: `no such breakpoint kind: ${bp.kind}` };
            }
            if (handle < 0) return { unsupported: 'the emulator refused the breakpoint' };
            breakpoints.set(handle, { ...bp, pc });
            return handle;
        },

        clearBreakpoint(handle) {
            wasm._emu_dbg_clear_bp(handle);
            breakpoints.delete(handle);
        },

        readMem(space, addr, len) {
            if (SPACE[space] === undefined) {
                return { unsupported: `no such address space: ${space}` };
            }

            // Fast path: if the build exports HEAPU8 and _emu_dbg_read_mem,
            // read the whole block in one WASM call. Feature-detect: the
            // vendored build in brickwright-lite may be older and lack these.
            if (wasm.HEAPU8 && wasm._emu_dbg_read_mem && space !== 'bit') {
                const ptr = wasm._emu_dbg_read_mem(SPACE[space], addr, len);
                if (ptr) {
                    return new Uint8Array(wasm.HEAPU8.buffer, ptr, len).slice();
                }
                // fall through to byte-at-a-time if pointer is null
            }

            // Slow path: one value-returning call per byte (always works)
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) out[i] = readByte(space, (addr + i) & 0xFFFF);
            return out;
        },

        writeMem(space, addr, data) {
            const s = SPACE[space];
            if (s === undefined) return { refused: `no such address space: ${space}` };
            // emu_dbg_write_mem takes one byte at a time.
            for (let i = 0; i < data.length; i++) {
                wasm._emu_dbg_write_mem(s, (addr + i) & 0xFFFF, data[i]);
            }
            return undefined;
        },

        regs() {
            const psw = wasm._emu_dbg_psw();
            return {
                pc: wasm._emu_dbg_pc(),
                a: wasm._emu_dbg_acc(),
                b: wasm._emu_dbg_b(),
                dptr: wasm._emu_dbg_dptr(),
                sp: wasm._emu_dbg_sp(),
                psw,
                // Reported, not left for the front end to derive from PSW —
                // §6 says a conforming target states the bank explicitly.
                bank: (psw >> 3) & 3,
                r: Array.from({ length: 8 }, (_, n) => wasm._emu_dbg_rn(n))
            };
        },

        onHalt(cb) {
            listeners.push(cb);
            return () => { listeners = listeners.filter((f) => f !== cb); };
        },

        // ─── beyond the interface ────────────────────────────────────────

        /** Load stc_symtab.py's JSON. Needed for position and yield breakpoints. */
        setSymbols: loadSymbols,

        /** Level 1 position right now, or undefined without a symbol table. */
        position: positionOf,

        /** The scheduler's millisecond tick, or undefined without symbols. */
        bwMs() {
            return symbols && wasm._emu_dbg_bw_ms ? wasm._emu_dbg_bw_ms() : undefined;
        },

        /** Program time in nanoseconds since reset. */
        timeNs: nowNs,

        /**
         * The instruction at `addr`, as text.
         *
         * `emu_disasm` returns a `const char *`, which is a pointer — normally
         * out of reach here (see the header). `ccall` with a 'string' return
         * marshals it using Emscripten's own heap access, which is exported.
         * It does NOT report the instruction's length; a caller that needs to
         * walk forward gets that from an opcode table.
         */
        disasm(addr) {
            if (!wasm.ccall || !wasm._emu_disasm) return '';
            try {
                return wasm.ccall('emu_disasm', 'string', ['number'], [addr & 0xFFFF]) || '';
            } catch {
                return '';
            }
        },

        /**
         * Move the program counter. `g` in the TUI.
         *
         * Refused rather than silently ignored when the build predates it —
         * jumping the PC and having nothing happen is worse than being told.
         */
        setPc(addr) {
            if (!wasm._emu_set_pc) return { refused: 'this emulator build cannot set the PC' };
            wasm._emu_set_pc(addr & 0xFFFF);
            return undefined;
        },

        /** Clear RAM as well as the registers — the TUI's W)ipe, vs its R)eset. */
        wipe() {
            if (wasm._emu_reset) wasm._emu_reset(1);
            else wasm._emu_dbg_reset();
        },

        /**
         * Run at most `budgetNs` of PROGRAM time, or until the target halts.
         *
         * The primitive a host's frame loop is built from. Returns:
         *   'halted' — a breakpoint or a completed step. Listeners have fired.
         *   'budget' — the slice is used up and nothing happened. Call again.
         *   'idle'   — the target was not running to begin with.
         *
         * Never leaves a spurious halt visible to onHalt listeners, and always
         * leaves the target running when it returns 'budget', so a caller does
         * not have to know that the C halts on budget expiry.
         */
        runFor(budgetNs) {
            if (detached) return 'idle';
            if (wasm._emu_dbg_state() !== 1) return 'idle';
            const until = target.timeNs() + BigInt(budgetNs);
            const lo = Number(until & 0xFFFFFFFFn);
            const hi = Number((until >> 32n) & 0xFFFFFFFFn);

            const wasStepping = stepping;
            inBudgetedRun = true;
            let stopped;
            try {
                stopped = wasm._emu_dbg_run_until_ns(lo, hi) === 1;
            } finally {
                inBudgetedRun = false;
            }

            if (stopped) {
                // The return value is what separates a real stop from the
                // budget one, so it — not the swallowed callback — decides
                // what the listeners hear.
                stepping = false;
                announce(wasStepping ? 'step' : 'breakpoint');
                return 'halted';
            }

            // Budget expiry left the target halted. Put it back the way the
            // caller believes it is, so `state()` does not flicker to 'halted'
            // between frames of a run the user thinks is continuous.
            wasm._emu_dbg_run();
            return 'budget';
        },

        /** The link is gone. Only the live target can really detach; here it is for tests. */
        detach() { detached = true; },

        /** Release the registered callback. */
        destroy() {
            if (haltCbPtr !== null && wasm.removeFunction) {
                try { wasm.removeFunction(haltCbPtr); } catch { /* already gone */ }
            }
            haltCbPtr = null;
            listeners = [];
        }
    };

    return target;
}
