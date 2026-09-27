/**
 * The RISC-V DebugTarget — the contract debug-session.js drives (run/pause/
 * step/runFor/onHalt), over a riscv32-adapter.
 *
 * Until this existed the factory returned `{target: null, adapter}` for
 * riscv32, and a host that hands every machine bench to createDebugSession
 * (lite's debug-runner does) had nothing to drive: `createDebugSession(null)`
 * throws on its first line. This is the smallest honest target: it claims only
 * what it does — free run, pause, instruction step, code breakpoints,
 * registers, physical memory, serial input — and the capabilities say so.
 *
 * It is the same target for a program image and for a booted Linux kernel;
 * the adapter's `mode` says which, and a Linux reset REBOOTS the kernel (the
 * adapter builds a fresh machine), since a CPU reset into RAM the kernel has
 * already rewritten would boot nothing.
 *
 * @module
 */

const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];

/** Instructions one runFor may single-step when a breakpoint or a step is
 *  pending — the slow path; a free run takes the adapter's fast path. */
const SLOW_PATH_MAX = 200_000;

/**
 * @param {ReturnType<import('./riscv32-adapter.js').createRiscV32Adapter>} adapter
 */
export function createRiscV32DebugTarget(adapter) {
    let runState = 'halted';
    const haltListeners = [];
    const breakpoints = new Map();          // id -> {kind:'code', addr}
    let nextBpId = 1;
    let pendingStep = null;                 // {remaining}

    const m = () => adapter.machine;
    const pc = () => m().cpu.pc >>> 0;

    function halt(info) {
        runState = 'halted';
        pendingStep = null;
        const why = {pc: pc(), ...info};
        for (const cb of haltListeners.slice()) cb(why);
    }

    function exitedHalt() {
        const machine = m();
        halt({cause: 'exited', exitCode: machine.exitCode});
        return 'halted';
    }

    return {
        kind: 'riscv32',

        capabilities() {
            return {
                steps: ['insn'],
                breakpoints: ['code'],
                runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xffffffff,
                    stopSides: ['before'], installation: 'sync'}],
                timeFreezes: true,
                consumes: [],
                events: [],
                spaces: {mem: {read: true, write: true, passiveRead: true}},
                fidelity: {instruction: 'unsupported', memory: 'unsupported', cycle: 'unsupported'},
                recording: [],
                extensions: {
                    checkpointRefusal: ['the RISC-V machine has no checkpoint support'],
                    inputReplay: [],
                    inputRefusals: ['serial input goes straight to the UART and is not recorded'],
                    mode: adapter.mode || 'program'
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

        /** Program: reset the CPU to the image entry. Linux: reboot the kernel. */
        reset() { pendingStep = null; adapter.reset(); runState = 'halted'; },

        step(kind, count = 1) {
            if (kind !== 'insn') return {unsupported: `step kind '${kind}' not supported on RISC-V (instruction steps only)`};
            runState = 'running';
            pendingStep = {remaining: Math.max(1, count | 0)};
            return undefined;
        },

        setBreakpoint(spec) {
            if (!spec || spec.kind !== 'code') return {unsupported: `breakpoint kind '${spec && spec.kind}' not supported on RISC-V`};
            if (!Number.isSafeInteger(spec.addr) || spec.addr < 0 || spec.addr > 0xffffffff) {
                return {unsupported: 'a RISC-V code breakpoint needs a 32-bit address'};
            }
            const id = nextBpId++;
            breakpoints.set(id, {kind: 'code', addr: spec.addr >>> 0});
            return id;
        },

        clearBreakpoint(id) { breakpoints.delete(id); },

        /** Spend up to budgetNs. 'halted' when a breakpoint, a finished step,
         *  or the program's exit stopped it; else 'budget'. */
        runFor(budgetNs) {
            if (runState !== 'running') return 'halted';
            const machine = m();
            if (machine.halted) return exitedHalt();
            if (!pendingStep && breakpoints.size === 0) {
                adapter.advanceNs(budgetNs);
                return machine.halted ? exitedHalt() : 'budget';
            }
            const n = Math.max(1, Math.min(SLOW_PATH_MAX, Math.round(budgetNs)));
            for (let i = 0; i < n; i++) {
                const here = pc();
                for (const [id, bp] of breakpoints) {
                    if (bp.addr === here && !(pendingStep && i === 0)) {
                        halt({cause: 'breakpoint', bp: id, bpKind: 'code'});
                        return 'halted';
                    }
                }
                if (pendingStep && pendingStep.remaining <= 0) { halt({cause: 'step'}); return 'halted'; }
                adapter.step();
                if (pendingStep) pendingStep.remaining--;
                if (machine.halted) return exitedHalt();
            }
            if (pendingStep && pendingStep.remaining <= 0) { halt({cause: 'step'}); return 'halted'; }
            return 'budget';
        },

        regs() {
            const c = m().cpu;
            const r = {pc: c.pc >>> 0, priv: c.priv};
            for (let i = 1; i < 32; i++) r[ABI[i]] = c.x[i] >>> 0;
            r.instret = Number(c.retired || 0);
            return r;
        },

        /** Physical memory (RAM is at the machine's ramBase). */
        readMem(space, addr, len) {
            if (space !== 'mem') return {unsupported: `no space '${space}' on RISC-V`};
            const machine = m();
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                const idx = ((addr + i) >>> 0) - machine.ramBase;
                out[i] = idx >= 0 && idx < machine.memSize ? machine.mem[idx] : 0;
            }
            return out;
        },

        writeMem(space, addr, data) {
            if (space !== 'mem') return {refused: `no space '${space}' on RISC-V`};
            const machine = m();
            for (let i = 0; i < data.length; i++) {
                const idx = ((addr + i) >>> 0) - machine.ramBase;
                if (idx >= 0 && idx < machine.memSize) machine.mem[idx] = data[i];
            }
            return undefined;
        },

        position() { return []; },

        timeNs() { return adapter.timeNs(); },

        /** Console input: one byte into the UART receive FIFO. */
        sendSerial(byte) { return adapter.sendSerial(byte & 0xff); },

        /** Linux boot progress {phase, percent, ready}, or null for a program. */
        linuxProgress() { return typeof adapter.linuxProgress === 'function' ? adapter.linuxProgress() : null; },
    };
}

export default createRiscV32DebugTarget;
