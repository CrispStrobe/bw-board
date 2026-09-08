/**
 * Explicitly limited, generator-resumable real-mode boot executor. All byte
 * fetches and memory operations use the external phase board. No prefetch,
 * instruction timing, protection, exception delivery or bus-HLT claim.
 */
import {CircuitFault} from './digital-circuit.js';

const REGS = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const FLAGS = 0x8d5; // OF SF ZF AF PF CF; other bits preserved

export function bootAdd16(a, b, flags) {
    const sum = a + b;
    const result = sum & 0xffff;
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (result >> i) & 1;
    const status = Number(sum > 0xffff) | (!parity ? 4 : 0) |
        (((a ^ b ^ result) & 0x10) ? 0x10 : 0) | (result === 0 ? 0x40 : 0) |
        (result & 0x8000 ? 0x80 : 0) | ((~(a ^ b) & (a ^ result) & 0x8000) ? 0x800 : 0);
    return {result, flags: (flags & ~FLAGS) | status | 2};
}

export class HarrisBootCPU {
    constructor({enabled = false, board, historyLimit = 64} = {}) {
        if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
        if (!board?.submit || !board?.clock || !board?.initialize) throw new TypeError('wired phase board required');
        if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new RangeError('historyLimit');
        this.board = board; this.historyLimit = historyLimit;
        this.status = 'uninitialized'; this.retired = 0; this.history = []; this.dropped = 0;
        this.capabilities = Object.freeze({experimental: true, instructionExecution: true,
            cpuModel: 'harris-286-boot-subset', general80286: false, protectedMode: false,
            prefetch: false, instructionTiming: false, busHaltSignalling: false, snapshots: false});
    }

    initialize() {
        if (this.status === 'faulted') throw new CircuitFault('CPU_FAULTED', 'reconstruct CPU/board after a fault');
        try { this._initialize(); } catch (error) {
            this.status = 'faulted';
            this.fault = Object.freeze({code: error.code || 'ERROR', message: error.message});
            throw error;
        }
    }
    _initialize() {
        this.board.initialize();
        // Unspecified general registers use a deterministic model value, NOT
        // a claim about silicon power-on contents. Architecturally defined
        // reset values and hidden code base are separate from those registers.
        this.regs = Object.fromEntries(REGS.map(r => [r, 0]));
        this.cs = 0xf000; this.csBase = 0xff0000; this.ip = 0xfff0;
        this.ds = 0; this.es = 0; this.ss = 0; this.flags = 2; this.msw = 0xfff0;
        this.retired = 0; this.history = []; this.dropped = 0; this.fault = null;
        this.status = 'running';
        this.iterator = this._instructions();
        this._pump();
    }

    *_byte() {
        if (this.ip >= 0xffff) throw new CircuitFault('UNSUPPORTED_SEGMENT_WRAP', 'instruction fetch at segment end');
        const byte = yield {kind: 'code-read', address: this.csBase + this.ip, width: 1};
        this.ip++;
        return byte;
    }
    *_word() { const low = yield* this._byte(); return low | ((yield* this._byte()) << 8); }
    *_memory(offset, write = false, value = 0) {
        if (offset > 0xfffe) throw new CircuitFault('UNSUPPORTED_SEGMENT_WRAP', 'word operand crosses segment end');
        return yield {kind: write ? 'memory-write' : 'memory-read', address: this.ds * 16 + offset, width: 2, value};
    }
    _add(value) {
        const result = bootAdd16(this.regs.ax, value, this.flags);
        this.regs.ax = result.result; this.flags = result.flags;
    }
    *_instructions() {
        while (this.status === 'running') {
            const start = {cs: this.cs, ip: this.ip, physical: this.csBase + this.ip};
            const opcode = yield* this._byte();
            if (opcode >= 0xb8 && opcode <= 0xbf) this.regs[REGS[opcode - 0xb8]] = yield* this._word();
            else switch (opcode) {
            case 0xea: {
                const offset = yield* this._word();
                const segment = yield* this._word();
                this.cs = segment; this.csBase = segment * 16; this.ip = offset;
                break;
            }
            case 0xa1: this.regs.ax = yield* this._memory(yield* this._word()); break;
            case 0xa3: yield* this._memory(yield* this._word(), true, this.regs.ax); break;
            case 0x05: this._add(yield* this._word()); break;
            case 0x03: {
                const modrm = yield* this._byte();
                if (modrm !== 0x06) throw new CircuitFault('UNSUPPORTED_ENCODING', `ADD requires AX,[disp16], got ${modrm.toString(16)}`);
                this._add(yield* this._memory(yield* this._word()));
                break;
            }
            case 0x90: break;
            case 0xfa: this.flags &= ~0x200; break;
            case 0xf4: this.status = 'halted'; break;
            default: throw new CircuitFault('UNSUPPORTED_OPCODE', `0x${opcode.toString(16)} at ${start.cs.toString(16)}:${start.ip.toString(16)}`);
            }
            this.retired++;
            if (this.history.length === this.historyLimit) { this.history.shift(); this.dropped++; }
            this.history.push(Object.freeze({...start, opcode, retired: this.retired}));
        }
    }
    _pump(value) {
        const next = this.iterator.next(value);
        if (!next.done) this.board.submit(next.value);
    }
    stepClock(ready_n = 0) {
        if (this.status !== 'running') throw new CircuitFault('CPU_NOT_RUNNING', this.status);
        try {
            const transfer = this.board.clock({ready_n});
            if (transfer?.last) this._pump(transfer.operand);
            return transfer;
        } catch (error) {
            this.status = 'faulted';
            this.fault = Object.freeze({code: error.code || 'ERROR', message: error.message});
            throw error;
        }
    }
    run(maxClocks = 512) {
        if (!Number.isSafeInteger(maxClocks) || maxClocks < 1) throw new RangeError('maxClocks');
        let clocks = 0;
        while (this.status === 'running' && clocks < maxClocks) { this.stepClock(); clocks++; }
        return {status: this.status === 'running' ? 'budget-exhausted' : this.status, clocks, retired: this.retired};
    }
    cancel() { if (this.status === 'running') this.status = 'cancelled'; }
    inspect() {
        return {status: this.status, registers: {...this.regs}, cs: this.cs, csBase: this.csBase, ip: this.ip,
            ds: this.ds, es: this.es, ss: this.ss, flags: this.flags, msw: this.msw,
            retired: this.retired, fault: this.fault ? {...this.fault} : null,
            history: this.history.map(e => ({...e})), dropped: this.dropped};
    }
}
