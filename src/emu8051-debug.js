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
 * ## Checkpoints fail closed on this ABI
 *
 * Checkpoint support is admitted only by the exact five-export native ABI v1
 * and its deterministic layout id. Older, partial, wrong-version and
 * wrong-layout builds keep the prior structured refusal: reconstructing from
 * PC, IRAM, SFR and XRAM would omit in-flight and peripheral state. The native
 * blob is copied out of the WASM heap into caller-owned bytes and restore
 * validates its JS envelope before the atomic native call. This enables
 * checkpoint/restore recording only for a detached MCU+adapter. An attached
 * Board is a separate reactive machine whose editor snapshot omits scheduled
 * device and solver continuation, so the shared adapter/factory boundary fails
 * closed instead of mislabelling a native MCU blob as a whole-board checkpoint.
 * The returned value is deliberately an in-memory, same-target opaque handle:
 * its private token binds native bytes to debugger/adapter continuation state.
 * It is not structured-cloneable, transferable, or a persistence format;
 * callers may copy the byte values, including into a nonzero-offset view.
 * Reverse execution remains a separate, unclaimed integration.
 *
 * ## Native pin-event transport
 *
 * The pinned ABI exposes a 4,096-entry C ring of pin transitions. It is
 * decoded after execution in one batch, preserving native nanosecond time,
 * pin mode and drive level. Overflow becomes an explicit `history-gap`
 * signal. This is signal evidence, not an internal address/data bus trace or
 * a passive memory-read watchpoint.
 *
 * @module
 */

/** Step kinds, in the order dbg_step_kind declares them. Appended, never renumbered. */
const STEP_KIND = { insn: 0, line: 1, block: 2, over: 3, out: 4, cycle: 5 };

/** Address spaces, in the order dbg_space declares them. */
const SPACE = { code: 0, iram: 1, sfr: 2, xram: 3, bit: 4 };

/** The same table read the other way, for turning a reported space back into a name. */
const SPACE_NAME = Object.keys(SPACE);

/** stc12_pin_mode in stc12.h, by value: 0 quasi, 1 push-pull, 2 input, 3 open-drain. */
const MODE_NAMES = ['quasi', 'pushpull', 'input', 'opendrain'];

/** DBG_MAX_BP in debug.h. Exceeding it returns -1, which we turn into a reason. */
const MAX_BREAKPOINTS = 32;
const MAX_CODE_ADDRESS = 0xffff;
const CODE_ADDRESS_REFUSAL =
    `code breakpoint addr must be in 0x0000..0x${MAX_CODE_ADDRESS.toString(16)}`;
/** Nanoseconds per second: the one authority for the tick⇄ns conversion in debugTime. */
const NS_PER_S = 1_000_000_000n;
/** PIN_HISTORY_SIZE in the pinned native ABI. */
const PIN_HISTORY_CAPACITY = 4096;
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_BUILD_ID = 0x80510101;
/** Exact sizeof(emu_checkpoint_v1) for build 0x80510101. */
const CHECKPOINT_SIZE = 443483;
const CHECKPOINT_NATIVE_ERRORS = Object.freeze({
    [-1]: 'not-initialized', [-2]: 'null-buffer', [-3]: 'wrong-length',
    [-4]: 'malformed', [-5]: 'unsupported-version', [-6]: 'incompatible-build',
    [-7]: 'invalid-state', [-8]: 'allocation-failed'
});
// Captured once: checkpoint envelopes are untrusted and must not choose the
// comparison implementation through own/prototype method overrides.
const INTRINSIC_ARRAY_IS_ARRAY = Array.isArray;
const INTRINSIC_OBJECT_KEYS = Object.keys;
const INTRINSIC_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const INTRINSIC_ARRAY_SORT = Array.prototype.sort;
const INTRINSIC_ARRAY_EVERY = Array.prototype.every;
const INTRINSIC_ARRAY_MAP = Array.prototype.map;
const INTRINSIC_ARRAY_SOME = Array.prototype.some;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;

/**
 * What an architectural dump cannot carry, named rather than summarised, so a
 * caller that wanted a checkpoint learns which state is missing and not merely
 * that it was refused.
 */
const CHECKPOINT_MISSING = Object.freeze([
    'cpu-in-flight-microstate',
    'program-time',
    'timer-and-interrupt-internals',
    'uart-queues',
    'external-input-latches'
]);

function checkpointRefusal(operation) {
    return {
        refused: 'deterministic 8051 checkpoints require a native complete-state WASM ABI; ' +
            'copying visible registers and memory would omit mutable execution state',
        code: 'incomplete-snapshot-abi',
        operation,
        missing: [...CHECKPOINT_MISSING]
    };
}

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
 * @param {number} [opts.clockHz] oscillator frequency, for exact cycle-domain timestamps
 * @param {(opcode: number) => number} [opts.instructionLength] byte length of the
 *   instruction starting with this opcode. INJECTED, NOT IMPLEMENTED HERE: the
 *   8051 length table is generated from stc-compiler's stc_disasm.py, which does
 *   not live in this repo, so a copy here would be an unverified hand-copy of a
 *   generated artefact with no oracle behind it. Without it an instruction event
 *   still carries its address, registers and disassembly text — it omits `bytes`
 *   and `length`, and says so by leaving them absent rather than empty.
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
    let taskIndex = new Map();
    /** "<task>/<state>" -> code address, for yield breakpoints. */
    let yieldAddr = new Map();
    /** Handle -> the Breakpoint it was set from, so we can describe a hit. */
    let breakpoints = new Map();
    /** A native blob is valid only for the target/configuration that captured it. */
    const checkpointSession = {};
    const checkpointLocalProofs = new WeakMap();
    /** Exact value equality for the structured-cloneable checkpoint-local tree. */
    const checkpointValueEqual = (left, right, seen = new WeakMap()) => {
        if (Object.is(left, right)) return true;
        if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
        if (seen.has(left)) return seen.get(left) === right;
        seen.set(left, right);
        const leftIsBytes = INTRINSIC_GET_PROTOTYPE_OF(left) === UINT8_ARRAY_PROTOTYPE;
        const rightIsBytes = INTRINSIC_GET_PROTOTYPE_OF(right) === UINT8_ARRAY_PROTOTYPE;
        if (leftIsBytes || rightIsBytes) {
            if (!leftIsBytes || !rightIsBytes || left.length !== right.length) return false;
            for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
            return true;
        }
        const leftIsArray = INTRINSIC_ARRAY_IS_ARRAY(left);
        const rightIsArray = INTRINSIC_ARRAY_IS_ARRAY(right);
        if (leftIsArray || rightIsArray) {
            if (!leftIsArray || !rightIsArray || left.length !== right.length) return false;
            for (let i = 0; i < left.length; i++) {
                if (!checkpointValueEqual(left[i], right[i], seen)) return false;
            }
            return true;
        }
        const leftProto = INTRINSIC_GET_PROTOTYPE_OF(left);
        const rightProto = INTRINSIC_GET_PROTOTYPE_OF(right);
        if (![Object.prototype, null].includes(leftProto) ||
            ![Object.prototype, null].includes(rightProto)) return false;
        const leftKeys = INTRINSIC_OBJECT_KEYS(left);
        const rightKeys = INTRINSIC_OBJECT_KEYS(right);
        INTRINSIC_ARRAY_SORT.call(leftKeys);
        INTRINSIC_ARRAY_SORT.call(rightKeys);
        if (leftKeys.length !== rightKeys.length) return false;
        for (let i = 0; i < leftKeys.length; i++) {
            const key = leftKeys[i];
            if (key !== rightKeys[i] || !checkpointValueEqual(left[key], right[key], seen)) return false;
        }
        return true;
    };
    const checkpointBytesEqual = (left, right) => {
        if (left.length !== right.length) return false;
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
        return true;
    };
    const copyCheckpointBytes = source => {
        const copy = new Uint8Array(source.length);
        for (let i = 0; i < source.length; i++) copy[i] = source[i];
        return copy;
    };

    let symbols = null;
    let listeners = [];
    /** Recorded-fact subscribers. Separate from `listeners`, which are halts. */
    let debugListeners = [];
    /** Evidence captured before an armed step, read back when its halt arrives. */
    let pendingStep = null;
    /** Native ring read cursor: total produced, and the next-write position. */
    let pinHistoryReadCount = 0;
    let pinHistoryReadHead = 0;
    /**
     * Bumped on every reset so a timestamp taken after a reset carries a
     * different domain than one taken before it — two runs of the same program
     * never read as one monotonic series. Zero means "not yet reset".
     */
    let debugTimeEpoch = 0;
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

    /**
     * Complete native pin-history surface; partial/older ABIs fail closed.
     * The size check is a layout check: the decoder below reads fixed offsets
     * out of `struct stc12_pin_event`, so a build whose struct is smaller than
     * those offsets never becomes a capability.
     */
    const hasPinHistoryApi = !!(wasm.HEAPU8 &&
        typeof wasm._emu_pin_history_enable === 'function' &&
        typeof wasm._emu_pin_history_count === 'function' &&
        typeof wasm._emu_pin_history_head === 'function' &&
        typeof wasm._emu_pin_history_get === 'function' &&
        typeof wasm._emu_pin_event_size === 'function');
    const pinEventSize = hasPinHistoryApi ? wasm._emu_pin_event_size() : 0;
    const hasPinHistory = hasPinHistoryApi && pinEventSize >= 12;
    if (hasPinHistory) {
        wasm._emu_pin_history_enable();
        pinHistoryReadCount = wasm._emu_pin_history_count() >>> 0;
        pinHistoryReadHead = wasm._emu_pin_history_head() >>> 0;
    }

    const checkpointExports = [
        '_emu_checkpoint_version', '_emu_checkpoint_build_id', '_emu_checkpoint_size',
        '_emu_checkpoint_save', '_emu_checkpoint_restore'
    ];
    let checkpointSize = 0;
    let checkpointCode = 'incomplete-snapshot-abi';
    if (wasm.HEAPU8 && typeof wasm._malloc === 'function' && typeof wasm._free === 'function' &&
        checkpointExports.every(name => typeof wasm[name] === 'function')) {
        try {
            const version = wasm._emu_checkpoint_version();
            const buildId = wasm._emu_checkpoint_build_id();
            const size = wasm._emu_checkpoint_size();
            if (![version, buildId, size].every(Number.isSafeInteger) ||
                version < 0 || size < 0 || buildId < -0x80000000 || buildId > 0xffffffff) {
                checkpointCode = 'invalid-checkpoint-metadata';
            }
            else if (version !== CHECKPOINT_VERSION) checkpointCode = 'unsupported-checkpoint-version';
            // Emscripten exposes a C uint32_t result as a signed JS i32. Validate
            // its raw range first, then normalize that one representational case.
            else if ((buildId >>> 0) !== CHECKPOINT_BUILD_ID) checkpointCode = 'incompatible-checkpoint-build';
            else if (size !== CHECKPOINT_SIZE) {
                checkpointCode = 'invalid-checkpoint-size';
            } else checkpointSize = size;
        } catch {
            checkpointCode = 'invalid-checkpoint-abi';
        }
    }
    const nativeCheckpointAvailable = checkpointSize === CHECKPOINT_SIZE;
    const checkpointSupport = () => {
        if (!nativeCheckpointAvailable) return {supported: false, code: checkpointCode};
        if (opts.adapter) {
            if (typeof opts.adapter.checkpointSupport !== 'function' ||
                typeof opts.adapter.captureCheckpointState !== 'function' ||
                typeof opts.adapter.prepareCheckpointRestore !== 'function') {
                return {supported: false, code: 'incomplete-adapter-checkpoint',
                    reason: 'the 8051 adapter does not implement the checkpoint participant contract'};
            }
            try {
                const support = opts.adapter.checkpointSupport();
                if (!support?.supported) return support || {supported: false,
                    code: 'invalid-adapter-checkpoint-support'};
            } catch {
                return {supported: false, code: 'invalid-adapter-checkpoint-support',
                    reason: 'the 8051 adapter checkpoint support probe threw'};
            }
        }
        return {supported: true};
    };

    const nativeCheckpointRefusal = (operation, nativeCode) => ({
        refused: `native 8051 checkpoint ${operation} refused (${CHECKPOINT_NATIVE_ERRORS[nativeCode] ||
            `error-${nativeCode}`})`,
        code: 'native-checkpoint-refused', operation, nativeCode,
        reason: CHECKPOINT_NATIVE_ERRORS[nativeCode] || 'unknown-native-error'
    });
    const unavailableCheckpointRefusal = operation => {
        const support = checkpointSupport();
        return {...checkpointRefusal(operation), code: support.code || checkpointCode,
            ...(support.reason ? {reason: support.reason} : {})};
    };
    const freeCheckpointBuffer = ptr => {
        try { wasm._free(ptr); } catch { /* restore/capture outcome outranks allocator diagnostics */ }
    };

    /** The injected opcode-length table, or null when the host supplied none. */
    const instructionLength = typeof opts.instructionLength === 'function'
        ? opts.instructionLength
        : null;

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
        emitHaltEvidence(why);
        for (const cb of listeners) cb(why);
        return why;
    }

    function onHaltFromWasm() {
        if (inBudgetedRun) return;      // runFor speaks for this window
        const cause = pendingCause || 'breakpoint';
        pendingCause = null;
        stepping = false;
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
     * The reset-aware time domain the target reports facts in. `ticks` counts
     * oscillator cycles when a usable clockHz was supplied and native
     * nanoseconds otherwise; `domain` names which, and carries the reset epoch.
     * This is the single source of the domain string — cycleProvider (and any
     * later event contract) reads it here rather than re-deriving it, so the
     * clock-vs-ns choice and the reset epoch are decided in exactly one place.
     */
    function debugTime() {
        const ns = nowNs();
        const hz = Number(opts.clockHz);
        return Number.isSafeInteger(hz) && hz > 0
            ? {ticks: (ns * BigInt(hz) + NS_PER_S / 2n) / NS_PER_S,
                domain: debugTimeEpoch ? `8051-oscillator-reset-${debugTimeEpoch}` : '8051-oscillator', hz}
            : {ticks: ns,
                domain: debugTimeEpoch ? `8051-simulation-ns-reset-${debugTimeEpoch}` : '8051-simulation-ns',
                hz: Number(NS_PER_S)};
    }

    function emitDebug(event) {
        for (const cb of debugListeners) cb({...event, time: event.time || debugTime(), cpuId: 'main'});
    }

    /**
     * Decode the native ring in batches after execution. Unlike pin polling,
     * this preserves every retained sub-instruction edge and its native time.
     */
    function drainPinHistory() {
        if (!hasPinHistory) return;
        const count = wasm._emu_pin_history_count() >>> 0;
        const head = wasm._emu_pin_history_head() >>> 0;
        const produced = (count - pinHistoryReadCount) >>> 0;
        let available = produced;
        let first = pinHistoryReadHead;
        if (available > PIN_HISTORY_CAPACITY) {
            const dropped = available - PIN_HISTORY_CAPACITY;
            available = PIN_HISTORY_CAPACITY;
            // `head` is the native next-write position. Work backwards from
            // it to the oldest retained entry; count is used only for loss.
            first = (head - PIN_HISTORY_CAPACITY) >>> 0;
            emitDebug({kind: 'signal', phase: 'history-gap', fidelity: 'recorded',
                signal: {name: '8051.pin-history-gap', value: dropped}});
        }
        // The ABI returns sizeof(struct stc12_pin_event); offsets 0 and 8..11
        // are fixed by its exported C definition. Malformed layouts were
        // rejected during feature detection and never become a capability.
        // The view is built once: nothing in this loop executes code, so the
        // WASM heap cannot grow and detach the buffer underneath it.
        const view = new DataView(wasm.HEAPU8.buffer);
        for (let n = 0; n < available; n++) {
            const index = (first + n) >>> 0;
            const ptr = wasm._emu_pin_history_get(index);
            if (!ptr || ptr + pinEventSize > view.byteLength) break;
            const tNs = view.getBigUint64(ptr, true);
            const port = view.getUint8(ptr + 8);
            const bit = view.getUint8(ptr + 9);
            const mode = MODE_NAMES[view.getUint8(ptr + 10)] ?? 'unknown';
            const drive = view.getUint8(ptr + 11) !== 0;
            emitDebug({kind: 'signal', phase: 'pin-change', fidelity: 'recorded',
                time: {ticks: tNs,
                    domain: debugTimeEpoch ? `8051-simulation-ns-reset-${debugTimeEpoch}` :
                        '8051-simulation-ns', hz: Number(NS_PER_S)},
                signal: {name: `P${port}.${bit}`, value: drive, mode}});
        }
        pinHistoryReadCount = count;
        pinHistoryReadHead = head;
    }

    function emitHaltEvidence(why) {
        if (pendingStep && why.cause === 'step') {
            const step = pendingStep;
            pendingStep = null;
            if (step.kind === 'cycle') {
                // The WASM's cycle step is one real oscillator tick. No bus
                // pins are claimed: this build exposes the boundary, not its
                // internal address/data/control signals.
                emitDebug({kind: 'bus', phase: 'oscillator-clock', fidelity: 'recorded',
                    pcBefore: step.pcBefore, pcAfter: why.pc,
                    cause: 'step'});
            } else if (step.kind === 'insn') {
                if (!step.registersBefore) {
                    emitDebug({kind: 'instruction', phase: 'retire', fidelity: 'recorded',
                        pcBefore: step.pcBefore, pcAfter: why.pc,
                        instruction: {address: step.pcBefore}, cause: 'step'});
                    return;
                }
                const registersAfter = readRegisters();
                const registerChanges = {};
                for (const [name, after] of Object.entries(registersAfter)) {
                    const before = step.registersBefore[name];
                    const equal = Array.isArray(after) && Array.isArray(before) ?
                        after.length === before.length && after.every((value, index) => value === before[index]) :
                        Object.is(after, before);
                    if (!equal) registerChanges[name] = {before, after};
                }
                emitDebug({kind: 'instruction', phase: 'retire', fidelity: 'recorded',
                    pcBefore: step.pcBefore, pcAfter: why.pc,
                    instruction: step.instruction, registersAfter,
                    changes: {registers: registerChanges}, cause: 'step'});
            }
        }
        if (why.cause === 'watchpoint') {
            // This is evidence of a value transition sampled by the native
            // change watchpoint, not proof of every store (same-value stores
            // and multiple writes within one instruction remain invisible).
            emitDebug({kind: 'memory', phase: 'change-watchpoint', fidelity: 'recorded',
                memory: {space: why.space, address: why.addr, width: 1,
                    direction: 'write', before: why.prev, value: why.value},
                pcAfter: why.pc, cause: 'watchpoint'});
        }
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
    function readRegisters() {
        const psw = wasm._emu_dbg_psw();
        return {pc: wasm._emu_dbg_pc(), a: wasm._emu_dbg_acc(), b: wasm._emu_dbg_b(),
            dptr: wasm._emu_dbg_dptr(), sp: wasm._emu_dbg_sp(), psw,
            // Reported, not left for the front end to derive from PSW —
            // §6 says a conforming target states the bank explicitly.
            bank: (psw >> 3) & 3,
            r: Array.from({length: 8}, (_, n) => wasm._emu_dbg_rn(n))};
    }

    function disassemble(addr) {
        if (!wasm.ccall || !wasm._emu_disasm) return '';
        try {
            return wasm.ccall('emu_disasm', 'string', ['number'], [addr & 0xFFFF]) || '';
        } catch {
            return '';
        }
    }

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
        /** The reset-aware time domain (see debugTime) the emitted facts live in. */
        time() {
            return debugTime();
        },

        /**
         * What a resumable oscillator boundary is, and — as important — what it
         * is not. The pinned WASM's cycle step is one real oscillator tick, so
         * the boundary is recorded and resumable; but this ABI exposes no ALE,
         * PSEN, address or data bus, so `signals` is empty as a promise (clients
         * must not synthesize a waveform), and architectural reads omit in-flight
         * and peripheral state, so `checkpoint` is false. Null when the build has
         * no cycle step at all. The time domain comes from debugTime, not a
         * second copy of the clock-vs-ns rule.
         */
        cycleProvider() {
            if (!hasCycleStep) return null;
            const hz = Number(opts.clockHz);
            return {
                schema: 1,
                engine: 'emu8051-stc',
                boundary: 'oscillator-clock',
                timeDomain: debugTime().domain,
                ...(Number.isSafeInteger(hz) && hz > 0 ? {clockHz: hz} : {}),
                fidelity: 'recorded',
                resumable: true,
                signals: [],
                checkpoint: checkpointSupport().supported
            };
        },

        capabilities() {
            // Feature-detect watchpoints: available if _emu_dbg_set_bp_write exists
            const hasWatchpoints = typeof wasm._emu_dbg_set_bp_write === 'function';
            // A watchpoint that cannot report WHICH byte changed is a stop, not
            // evidence: the memory fact needs space/addr/prev/value out of the
            // halt reason, so the evidence claim is gated on both.
            const hasWatchpointEvidence = hasWatchpoints && hasHaltReason;

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
                runTo: [{kind: 'address', space: 'code', addressMin: 0,
                    addressMax: MAX_CODE_ADDRESS, stopSides: ['before'], installation: 'sync'}],
                spaces: ['code', 'iram', 'sfr', 'xram', 'bit'],
                writable: ['code', 'iram', 'sfr', 'xram', 'bit'],
                sfrs: 'all',
                haltPolicy: 'freeze-timers',
                timeFreezes: true,
                recording: checkpointSupport().supported ? ['checkpoint', 'restore'] : [],
                // An emulator takes nothing from the program: no timer, no
                // UART, no pin. The on-chip monitor is the one that has to
                // confess here (§7 decision 5).
                consumes: [],
                events: [
                    'instruction',
                    ...(hasCycleStep ? ['bus'] : []),
                    ...(hasWatchpointEvidence ? ['memory'] : []),
                    ...(hasPinHistory ? ['signal'] : [])
                ],
                fidelity: {
                    instruction: 'recorded',
                    cycle: hasCycleStep ? 'recorded' : 'unsupported',
                    memory: hasWatchpointEvidence ? 'recorded' : 'unsupported'
                },
                extensions: {
                    cycleEvidence: hasCycleStep ? 'oscillator-step-boundary' : 'none',
                    instructionEvidence: 'single-step-retire-only',
                    busSignals: false,
                    signalEvidence: hasPinHistory ? 'native-pin-history' : 'none',
                    pinHistoryCapacity: hasPinHistory ? PIN_HISTORY_CAPACITY : 0,
                    memoryEvidence: hasWatchpointEvidence ? 'change-watchpoint-only' : 'none',
                    // Whether an instruction fact can carry its opcode bytes is
                    // a property of the HOST's injection, not of this build.
                    instructionBytes: instructionLength ? 'injected-length-table' : 'none',
                    checkpoint: {
                        supported: checkpointSupport().supported,
                        ...(checkpointSupport().supported ? {version: CHECKPOINT_VERSION,
                            buildId: CHECKPOINT_BUILD_ID, size: checkpointSize} :
                            {code: checkpointSupport().code || checkpointCode,
                                reason: checkpointSupport().reason,
                                missing: [...CHECKPOINT_MISSING]})
                    }
                }
            };
        },

        state() {
            if (detached) return 'detached';
            return wasm._emu_dbg_state() === 1 ? 'running' : 'halted';
        },

        run() {
            stepping = false;
            pendingCause = null;
            pendingStep = null;
            wasm._emu_dbg_run();
        },

        halt() {
            pendingStep = null;
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
            const pcBefore = wasm._emu_dbg_pc();
            let stepEvidence = null;
            if (count === 1 && (kind === 'cycle' || kind === 'insn')) {
                stepEvidence = {kind, pcBefore};
                // Only read the machine for evidence somebody is listening for.
                if (kind === 'insn' && debugListeners.length) {
                    stepEvidence.registersBefore = readRegisters();
                    stepEvidence.instruction = {address: pcBefore, text: disassemble(pcBefore)};
                    // `bytes`/`length` need the injected table. ABSENT, not
                    // empty, when no table was supplied: an empty byte list
                    // would assert a zero-length instruction, which is a claim
                    // about the program rather than about this target's reach.
                    if (instructionLength) {
                        const length = instructionLength(readByte('code', pcBefore));
                        stepEvidence.instruction.bytes =
                            Array.from({length}, (_, offset) => readByte('code', pcBefore + offset));
                        stepEvidence.instruction.length = length;
                    }
                }
            }
            pendingStep = stepEvidence;
            // -1 means the emulator itself declined the kind. Passing that back
            // matters: the alternative is reporting "stepping" for a step that
            // never started, and then waiting for a halt that never comes.
            if (wasm._emu_dbg_step(k, count) < 0) {
                stepping = false;
                pendingCause = null;
                pendingStep = null;
                return { unsupported: `this emulator build does not implement step kind: ${kind}` };
            }
            return undefined;
        },

        reset() {
            stepping = false;
            pendingCause = null;
            pendingStep = null;
            debugTimeEpoch++;
            wasm._emu_dbg_reset();
            if (hasPinHistory) {
                // Re-seed rather than zero: stc12_init PRESERVES the ring
                // pointer but zeroes its head and count, so a cursor left at
                // the pre-reset totals would read the new epoch's first events
                // as an overflow.
                pinHistoryReadCount = wasm._emu_pin_history_count() >>> 0;
                pinHistoryReadHead = wasm._emu_pin_history_head() >>> 0;
            }
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
                if (!Number.isSafeInteger(bp.addr) || bp.addr < 0 || bp.addr > MAX_CODE_ADDRESS) {
                    return { unsupported: CODE_ADDRESS_REFUSAL };
                }
                pc = bp.addr;
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
                // The C side answers out of a fixed 256-byte scratch buffer and
                // does NOT clamp the length it was asked for: request more and
                // it hands back a pointer to 256 good bytes followed by
                // whatever the heap happens to hold, with no error and no short
                // count to notice. A 64 KB code read therefore came back as 256
                // bytes of program and 65280 bytes of nothing, which reads as
                // an erased chip — the disassembler and hex view both ask for
                // far more than 256 bytes. So the bulk read is issued one
                // bufferful at a time, advancing the ADDRESS as well as the
                // output offset. Pinned by test/emu8051-readmem-length.test.mjs,
                // which reads ACROSS the 256-byte seam — a test that only read
                // 256 bytes passes against the broken version.
                const CHUNK = 256;
                const out = new Uint8Array(len);
                let done = 0;
                while (done < len) {
                    const n = Math.min(CHUNK, len - done);
                    const ptr = wasm._emu_dbg_read_mem(SPACE[space], (addr + done) & 0xFFFF, n);
                    if (!ptr) break;
                    out.set(new Uint8Array(wasm.HEAPU8.buffer, ptr, n), done);
                    done += n;
                }
                if (done === len) return out;
                // a null pointer part-way through falls through to byte-at-a-time
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
            // A DRAIN OPPORTUNITY, NOT A CONSEQUENCE OF THE WRITE.
            //
            // The write itself moves no pin: `dbg_write_mem` assigns
            // `mSFR[addr - 0x80]` directly and never dispatches the `sfrwrite`
            // callbacks, so `emit_pin_changes` — the only writer of the ring —
            // is not reached. Driven at the pinned build: writing P1 and then
            // P1M0 leaves the native count unchanged, and a case below pins
            // that so a build which starts routing debug writes through the
            // hooks is a red rather than a silently withheld edge.
            //
            // THE DRAIN IS STILL LOAD-BEARING, and a previous revision of this
            // file removed it by reasoning from that measurement to the wrong
            // conclusion. "The write produces no edge" does not give "there is
            // nothing to drain": that needs "every edge was produced by
            // execution this target drove", and a host can advance the
            // emulator WITHOUT passing through runFor — calling
            // `wasm._emu_run` on the module it already holds is enough. Edges
            // from such a window sit in the ring undrained, and `writeMem` is
            // the next moment this target gets control. A debugger write is
            // exactly when a caller expects to see them.
            drainPinHistory();
            return undefined;
        },

        regs() {
            return readRegisters();
        },

        /** Copy the complete native blob out of transient WASM-owned memory. */
        captureCheckpoint() {
            if (!checkpointSupport().supported) return unavailableCheckpointRefusal('save');
            if (inBudgetedRun) return {refused: 'checkpoint capture requires a quiescent run boundary',
                code: 'checkpoint-not-quiescent'};
            if (typeof structuredClone !== 'function') return {
                refused: 'checkpoint local state requires structuredClone',
                code: 'checkpoint-clone-unavailable'};
            let local;
            try {
                const adapter = opts.adapter?.captureCheckpointState?.() ?? null;
                if (adapter?.refused) return adapter;
                local = structuredClone({
                    symbols, taskIndex: [...taskIndex], yieldAddr: [...yieldAddr],
                    breakpoints: [...breakpoints], pendingStep, pendingCause, stepping,
                    // Preserve the saved drain cursor: pending native ring entries
                    // are replayed once after restore, rather than silently dropped.
                    inBudgetedRun, pinHistoryReadCount, pinHistoryReadHead, adapter
                });
            } catch {
                return {refused: 'checkpoint debugger-local state cannot be cloned',
                    code: 'invalid-checkpoint-local-state'};
            }
            let ptr;
            try { ptr = wasm._malloc(checkpointSize); } catch (error) {
                return {refused: 'native 8051 checkpoint allocation threw',
                    code: 'checkpoint-allocation-threw', reason: String(error?.message || error)};
            }
            if (!ptr) return nativeCheckpointRefusal('save', -8);
            try {
                let heap = wasm.HEAPU8;
                if (!Number.isSafeInteger(ptr) || ptr < 0 || !heap ||
                    ptr + checkpointSize > heap.length) {
                    return {refused: 'checkpoint allocation lies outside the WASM heap',
                        code: 'invalid-checkpoint-allocation'};
                }
                let nativeCode;
                try { nativeCode = wasm._emu_checkpoint_save(ptr, checkpointSize); } catch (error) {
                    return {refused: 'native 8051 checkpoint save call threw',
                        code: 'native-checkpoint-call-threw', operation: 'save',
                        commitUnknown: false, reason: String(error?.message || error)};
                }
                if (nativeCode !== 0) return nativeCheckpointRefusal('save', nativeCode);
                heap = wasm.HEAPU8; // save may grow Emscripten memory
                if (!heap || ptr + checkpointSize > heap.length) return {
                    refused: 'checkpoint allocation became invalid after native save',
                    code: 'invalid-checkpoint-allocation'};
                const bytes = copyCheckpointBytes(heap.subarray(ptr, ptr + checkpointSize));
                let privateLocal;
                try { privateLocal = structuredClone(local); } catch {
                    return {refused: 'checkpoint continuation state cannot be privately sealed',
                        code: 'invalid-checkpoint-local-state'};
                }
                if (!checkpointValueEqual(local, privateLocal)) return {
                    refused: 'checkpoint continuation state is not a plain cloneable value tree',
                    code: 'invalid-checkpoint-local-state'};
                local.proof = {};
                checkpointLocalProofs.set(local.proof, {bytes: copyCheckpointBytes(bytes),
                    local: privateLocal});
                return {
                    schema: 1, kind: 'emu8051-native', version: CHECKPOINT_VERSION,
                    buildId: CHECKPOINT_BUILD_ID, size: checkpointSize,
                    session: checkpointSession, timeNs: nowNs(),
                    bytes, local
                };
            } finally {
                freeCheckpointBuffer(ptr);
            }
        },

        /** Validate the JS envelope before asking native code to mutate. */
        restoreCheckpoint(snapshot) {
            if (!checkpointSupport().supported) return unavailableCheckpointRefusal('restore');
            if (inBudgetedRun) return {
                refused: 'checkpoint restore requires a quiescent run boundary',
                code: 'checkpoint-not-quiescent'};
            if (!snapshot || snapshot.schema !== 1 || snapshot.kind !== 'emu8051-native' ||
                snapshot.session !== checkpointSession ||
                snapshot.version !== CHECKPOINT_VERSION || snapshot.buildId !== CHECKPOINT_BUILD_ID ||
                snapshot.size !== checkpointSize || typeof structuredClone !== 'function') {
                return {refused: 'checkpoint envelope or identity does not match this 8051 target',
                    code: 'invalid-checkpoint-envelope'};
            }
            let rawBytes;
            let rawLocal;
            let proofToken;
            try {
                rawBytes = snapshot?.bytes;
                rawLocal = snapshot?.local;
                const proofDescriptor = rawLocal &&
                    INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(rawLocal, 'proof');
                if (!proofDescriptor || !('value' in proofDescriptor)) throw new TypeError('opaque proof');
                proofToken = proofDescriptor.value;
            } catch {
                return {refused: 'checkpoint envelope cannot be staged safely',
                    code: 'invalid-checkpoint-envelope'};
            }
            if (!(rawBytes instanceof Uint8Array) || rawBytes.length !== checkpointSize || !rawLocal) {
                return {refused: 'checkpoint envelope or identity does not match this 8051 target',
                    code: 'invalid-checkpoint-envelope'};
            }
            let stagedLocal;
            let bytes;
            try {
                stagedLocal = structuredClone(rawLocal);
                delete stagedLocal.proof;
                bytes = copyCheckpointBytes(rawBytes);
            } catch {
                return {refused: 'checkpoint continuation state cannot be staged',
                    code: 'invalid-checkpoint-envelope'};
            }
            if (!INTRINSIC_ARRAY_IS_ARRAY(stagedLocal.taskIndex) ||
                !INTRINSIC_ARRAY_IS_ARRAY(stagedLocal.yieldAddr) ||
                !INTRINSIC_ARRAY_IS_ARRAY(stagedLocal.breakpoints)) {
                return {refused: 'checkpoint debugger-local state is malformed',
                    code: 'invalid-checkpoint-envelope'};
            }
            const validEntry = entry => Array.isArray(entry) && entry.length === 2;
            const tasks = stagedLocal.taskIndex;
            const yields = stagedLocal.yieldAddr;
            const bps = stagedLocal.breakpoints;
            const unique = values => new Set(values).size === values.length;
            const every = (array, predicate) => INTRINSIC_ARRAY_EVERY.call(array, predicate);
            const map = (array, mapper) => INTRINSIC_ARRAY_MAP.call(array, mapper);
            const validBreakpoint = ([id, bp]) => {
                if (!Number.isSafeInteger(id) || id <= 0 || id > 0x7fffffff ||
                    !bp || typeof bp !== 'object' ||
                    !Number.isSafeInteger(bp.pc) || bp.pc < 0 || bp.pc > 0xffff) return false;
                if (bp.kind === 'code') return Number.isSafeInteger(bp.addr) &&
                    bp.addr >= 0 && bp.addr <= 0xffff && bp.pc === bp.addr;
                if (bp.kind === 'yield') return typeof bp.task === 'string' &&
                    Number.isSafeInteger(bp.state) && bp.state >= 0 && bp.state <= 0x7fffffff &&
                    INTRINSIC_ARRAY_SOME.call(yields,
                        ([key, addr]) => key === `${bp.task}/${bp.state}` && addr === bp.pc);
                if (bp.kind === 'write') return SPACE[bp.space ?? 'iram'] !== undefined &&
                    Number.isSafeInteger(bp.addr) && bp.addr >= 0 && bp.addr <= 0xffff &&
                    bp.pc === bp.addr;
                return false;
            };
            const pending = stagedLocal.pendingStep;
            const validPending = pending === null || (pending && typeof pending === 'object' &&
                ['cycle', 'insn'].includes(pending.kind) && Number.isSafeInteger(pending.pcBefore) &&
                pending.pcBefore >= 0 && pending.pcBefore <= 0xffff);
            if (tasks.length > 8 || bps.length > MAX_BREAKPOINTS ||
                !every(tasks, entry => validEntry(entry) && typeof entry[0] === 'string' &&
                    Number.isSafeInteger(entry[1]) && entry[1] >= 0 && entry[1] < 8) ||
                !unique(map(tasks, entry => entry[0])) || !unique(map(tasks, entry => entry[1])) ||
                !every(yields, entry => validEntry(entry) && typeof entry[0] === 'string' &&
                    Number.isSafeInteger(entry[1]) && entry[1] >= 0 && entry[1] <= 0xffff) ||
                !unique(map(yields, entry => entry[0])) ||
                !every(yields, ([key]) => INTRINSIC_ARRAY_SOME.call(tasks,
                    ([name]) => key.startsWith(`${name}/`))) ||
                !every(bps, entry => validEntry(entry) && validBreakpoint(entry)) ||
                !unique(map(bps, entry => entry[0])) || !validPending ||
                typeof stagedLocal.stepping !== 'boolean' ||
                (stagedLocal.stepping && stagedLocal.pendingCause !== 'step') ||
                (pending !== null && (!stagedLocal.stepping ||
                    stagedLocal.pendingCause !== 'step')) ||
                (!stagedLocal.stepping && stagedLocal.pendingCause === 'step') ||
                stagedLocal.inBudgetedRun !== false ||
                !(stagedLocal.pendingCause === null ||
                    ['step', 'user'].includes(stagedLocal.pendingCause)) ||
                !Number.isSafeInteger(stagedLocal.pinHistoryReadCount) ||
                stagedLocal.pinHistoryReadCount < 0 ||
                stagedLocal.pinHistoryReadCount > 0xffffffff ||
                !Number.isSafeInteger(stagedLocal.pinHistoryReadHead) ||
                stagedLocal.pinHistoryReadHead < 0 ||
                stagedLocal.pinHistoryReadHead > 0xffffffff ||
                stagedLocal.pinHistoryReadHead !== stagedLocal.pinHistoryReadCount) {
                return {refused: 'checkpoint debugger-local state is malformed',
                    code: 'invalid-checkpoint-envelope'};
            }
            const proof = checkpointLocalProofs.get(proofToken);
            let bindingMatches = false;
            try {
                bindingMatches = !!proof && checkpointBytesEqual(bytes, proof.bytes) &&
                    checkpointValueEqual(stagedLocal, proof.local);
            } catch {
                return {refused: 'checkpoint continuation provenance is malformed',
                    code: 'invalid-checkpoint-envelope'};
            }
            if (!bindingMatches) return {
                refused: 'checkpoint native and local state differ from their opaque captured pair',
                code: 'invalid-checkpoint-envelope'};
            let staged;
            try {
                staged = {...stagedLocal, taskIndex: new Map(stagedLocal.taskIndex),
                    yieldAddr: new Map(stagedLocal.yieldAddr),
                    breakpoints: new Map(stagedLocal.breakpoints)};
            } catch {
                return {refused: 'checkpoint debugger-local state cannot be cloned',
                    code: 'invalid-checkpoint-envelope'};
            }
            const adapterRestore = opts.adapter?.prepareCheckpointRestore?.(staged.adapter);
            if (adapterRestore && !adapterRestore.accepted) return {
                refused: adapterRestore.reason || 'checkpoint adapter state cannot be restored',
                code: adapterRestore.code || 'checkpoint-adapter-refused'};
            let ptr;
            try { ptr = wasm._malloc(checkpointSize); } catch (error) {
                return {refused: 'native 8051 checkpoint allocation threw',
                    code: 'checkpoint-allocation-threw', reason: String(error?.message || error)};
            }
            if (!ptr) return nativeCheckpointRefusal('restore', -8);
            const heap = wasm.HEAPU8; // malloc may grow Emscripten memory
            if (!Number.isSafeInteger(ptr) || ptr < 0 || !heap ||
                ptr + checkpointSize > heap.length) {
                freeCheckpointBuffer(ptr);
                return {refused: 'checkpoint allocation lies outside the WASM heap',
                    code: 'invalid-checkpoint-allocation'};
            }
            let nativeCode;
            try {
                heap.set(bytes, ptr);
                nativeCode = wasm._emu_checkpoint_restore(ptr, checkpointSize);
            } catch (error) {
                return {refused: 'native 8051 checkpoint restore call threw',
                    code: 'native-checkpoint-call-threw', commitUnknown: true,
                    reason: String(error?.message || error)};
            } finally {
                freeCheckpointBuffer(ptr);
            }
            if (nativeCode !== 0) return nativeCheckpointRefusal('restore', nativeCode);

            // Native mutation has committed. Everything below is a prevalidated,
            // allocation-free assignment (plus the adapter's prepared no-fail commit).
            symbols = staged.symbols;
            taskIndex = staged.taskIndex;
            yieldAddr = staged.yieldAddr;
            breakpoints = staged.breakpoints;
            pendingStep = staged.pendingStep;
            pendingCause = staged.pendingCause;
            stepping = staged.stepping;
            inBudgetedRun = staged.inBudgetedRun;
            pinHistoryReadCount = staged.pinHistoryReadCount;
            pinHistoryReadHead = staged.pinHistoryReadHead;
            debugTimeEpoch++;
            adapterRestore?.commit();
            return true;
        },

        onHalt(cb) {
            listeners.push(cb);
            return () => { listeners = listeners.filter((f) => f !== cb); };
        },

        /** Subscribe to recorded facts. Sequencing/schema wrapping belongs to the runner. */
        onDebugEvent(cb) {
            if (typeof cb !== 'function') throw new TypeError('debug event listener must be a function');
            debugListeners.push(cb);
            return () => { debugListeners = debugListeners.filter((f) => f !== cb); };
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
            return disassemble(addr);
        },

        /** Normalise a code address and advance it in the 8051's 16-bit space. */
        nextCodeAddress(addr, length) {
            if (!Number.isSafeInteger(addr) || addr < 0 ||
                !Number.isSafeInteger(length) || length < 0) {
                return { unsupported: 'code address progression requires non-negative safe integers' };
            }
            return ((addr & 0xFFFF) + (length & 0xFFFF)) & 0xFFFF;
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
            // After execution, never during: one batch decode keeps native
            // timestamps and costs nothing per instruction.
            drainPinHistory();

            if (stopped) {
                // The return value is what separates a real stop from the
                // budget one, so it — not the swallowed callback — decides
                // what the listeners hear.
                stepping = false;
                pendingCause = null;
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
            debugListeners = [];
        }
    };

    return target;
}
