/**
 * The ESP8266 DebugTarget — the contract debug-session.js drives (run/pause/
 * step/runFor/onHalt), over an esp8266js-adapter.
 *
 * The smallest honest target, in the riscv32-debug.js mould: free run, pause,
 * instruction step, code breakpoints, the LX106 registers, a read of the
 * chip's memories, serial input. It claims nothing else, and the capabilities
 * say so. Memory writes are refused: the image lives in flash and IRAM copies
 * of it, and a poke the core's decode path may already hold is not a promise
 * this target can keep yet.
 *
 * A reset starts the program again from its image (the adapter builds a new
 * chip, whose time goes on from where the old one stopped).
 *
 * @module
 */

/** Instructions one runFor may single-step when a breakpoint or a step is pending. */
const SLOW_PATH_MAX = 200_000;
/** Chip time one idle slice of the slow path skips (the CPU is waiting for an interrupt). */
const IDLE_SLICE_NS = 10_000;

/**
 * @param {ReturnType<import('./esp8266js-adapter.js').createEsp8266jsAdapter>} adapter
 */
export function createEsp8266jsDebugTarget(adapter) {
    let runState = 'halted';
    const haltListeners = [];
    const breakpoints = new Map();          // id -> {kind:'code', addr}
    let nextBpId = 1;
    let pendingStep = null;                 // {remaining}

    const esp = () => adapter.esp;
    const core = () => adapter.esp.cores[0];
    const pc = () => core().PC >>> 0;

    function halt(info) {
        runState = 'halted';
        pendingStep = null;
        const why = {pc: pc(), ...info};
        for (const cb of haltListeners.slice()) cb(why);
    }

    function faultHalt() {
        halt({cause: 'fault', fault: adapter.fault});
        return 'halted';
    }

    /** The memories a read may touch: never a peripheral (reads there have effects). */
    function readable(addr) {
        const e = esp();
        const mem = e.mapAddress(addr >>> 0);
        return mem === e.iram || mem === e.dataMem || mem === e.rtcSlowMem
            || mem === e.flashMemory || mem === e.chipROM || mem === e.rom1;
    }

    return {
        kind: 'esp8266',

        capabilities() {
            return {
                steps: ['insn'],
                breakpoints: ['code'],
                runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xffffffff,
                    stopSides: ['before'], installation: 'sync'}],
                timeFreezes: true,
                consumes: [],
                events: [],
                spaces: {mem: {read: true, write: false, passiveRead: true}},
                fidelity: {instruction: 'unsupported', memory: 'unsupported', cycle: 'unsupported'},
                recording: [],
                extensions: {
                    checkpointRefusal: ['the ESP8266 target has no checkpoint support'],
                    inputReplay: [],
                    inputRefusals: ['serial input goes straight to the UART and is not recorded'],
                    memoryWriteRefusal: 'memory writes are not supported on the ESP8266 target',
                }
            };
        },

        state() { return runState; },

        onHalt(cb) {
            haltListeners.push(cb);
            return () => {
                const i = haltListeners.indexOf(cb);
                if (i >= 0) haltListeners.splice(i, 1);
            };
        },

        run() { runState = 'running'; pendingStep = null; },

        halt() { halt({cause: 'pause'}); },

        /** Start the program again from its image. */
        reset() { pendingStep = null; adapter.resetToProgram(); runState = 'halted'; },

        step(kind, count = 1) {
            if (kind !== 'insn') return {unsupported: `step kind '${kind}' not supported on ESP8266 (instruction steps only)`};
            runState = 'running';
            pendingStep = {remaining: Math.max(1, count | 0)};
            return undefined;
        },

        setBreakpoint(spec) {
            if (!spec || spec.kind !== 'code') return {unsupported: `breakpoint kind '${spec && spec.kind}' not supported on ESP8266`};
            if (!Number.isSafeInteger(spec.addr) || spec.addr < 0 || spec.addr > 0xffffffff) {
                return {unsupported: 'an ESP8266 code breakpoint needs a 32-bit address'};
            }
            const id = nextBpId++;
            breakpoints.set(id, {kind: 'code', addr: spec.addr >>> 0});
            return id;
        },

        clearBreakpoint(id) { breakpoints.delete(id); },

        /** Spend up to budgetNs of chip time. 'halted' when a breakpoint, a
         *  finished step or a fault stopped it; else 'budget'. */
        runFor(budgetNs) {
            if (runState !== 'running') return 'halted';
            if (adapter.fault) return faultHalt();
            if (!pendingStep && breakpoints.size === 0) {
                adapter.advanceNs(budgetNs);
                return adapter.fault ? faultHalt() : 'budget';
            }
            const n = Math.max(1, Math.min(SLOW_PATH_MAX, Math.round(budgetNs)));
            try {
                for (let i = 0; i < n; i++) {
                    const here = pc();
                    for (const [id, bp] of breakpoints) {
                        if (bp.addr === here && !(pendingStep && i === 0)) {
                            halt({cause: 'breakpoint', bp: id, bpKind: 'code'});
                            return 'halted';
                        }
                    }
                    if (pendingStep && pendingStep.remaining <= 0) { halt({cause: 'step'}); return 'halted'; }
                    if (esp().coresIdle) {
                        adapter.advanceNs(IDLE_SLICE_NS);      // waiting for an interrupt: let time pass
                        continue;
                    }
                    esp().step();
                    adapter.stats.steps++;
                    if (pendingStep) pendingStep.remaining--;
                    if (adapter.fault) return faultHalt();
                }
            } finally {
                adapter.advanceNs(0);                          // bring the board to the chip's time
            }
            if (pendingStep && pendingStep.remaining <= 0) { halt({cause: 'step'}); return 'halted'; }
            return 'budget';
        },

        regs() {
            const c = core();
            const r = {pc: c.PC >>> 0, sar: c.SAR >>> 0};
            for (let i = 0; i < 16; i++) r[`a${i}`] = c.AR(i) >>> 0;
            r.ccount = c.CCOUNT >>> 0;
            return r;
        },

        /** The chip's RAM, ROM and flash; peripheral addresses read as 0. */
        readMem(space, addr, len) {
            if (space !== 'mem') return {unsupported: `no space '${space}' on ESP8266`};
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                const a = (addr + i) >>> 0;
                out[i] = readable(a) ? core().readUint8(a) & 0xff : 0;
            }
            return out;
        },

        writeMem() { return {refused: 'memory writes are not supported on the ESP8266 target'}; },

        position() { return []; },

        timeNs() { return adapter.timeNs(); },

        /** Console input: one byte into the UART receiver. */
        sendSerial(byte) { adapter.sendSerial(byte & 0xff); return true; },
    };
}

export default createEsp8266jsDebugTarget;
