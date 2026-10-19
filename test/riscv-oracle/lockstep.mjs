// Lockstep: run a program on our RiscV32 core against a Spike trace of the same
// program, one instruction at a time, and stop at the first divergence with a
// readable diff.
//
// The trace comes from `spike -l --log-commits` (see spike-trace.mjs, which
// parses it into records). Per Spike record we compare:
//   commit  — privilege, pc, instruction bits, every GPR Spike says was written
//             (and that no OTHER GPR changed on our side), every CSR Spike
//             logged as written (read back through our CSR view), and each
//             store's value/size (plus its address while translation is off);
//   trap    — that our core took a trap on that step, with the same cause and
//             epc (and tval where Spike reports one).
// Spike's bootrom (reset vector at 0x1000) runs before the program; its
// register writes are replayed into our core so both start the ELF entry in
// the same state.

import {makeTestCpu} from './riscv-tests-runner.mjs';

const TRAP_CAUSE = {
    trap_instruction_address_misaligned: 0, trap_instruction_access_fault: 1, trap_illegal_instruction: 2,
    trap_breakpoint: 3, trap_load_address_misaligned: 4, trap_load_access_fault: 5,
    trap_store_address_misaligned: 6, trap_store_access_fault: 7, trap_user_ecall: 8,
    trap_supervisor_ecall: 9, trap_machine_ecall: 11, trap_instruction_page_fault: 12,
    trap_load_page_fault: 13, trap_store_page_fault: 15
};

const hex = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');

/**
 * CSR values that legitimately differ between two conforming harts. Each entry
 * says why; the harness skips comparing that CSR's logged value (the step's
 * GPR results are still compared, so a read of it that diverges still shows).
 */
export const CSR_VALUE_EXEMPT = new Map([
    [0x7a0, 'tselect: we implement no debug triggers (Sdtrig optional); hardwired 0'],
    [0x7a1, 'tdata1: no triggers — type 0 (none), hardwired 0'],
    [0x7a2, 'tdata2: no triggers, hardwired 0'],
    [0x7a3, 'tdata3: no triggers, hardwired 0'],
    [0x7a5, 'tcontrol: no triggers'],
    [0x309, 'mvip: Spike logs this AIA alias of mip.SSIP/STIP when sip/mip change; our hart has no AIA (mip itself is compared)'],
]);

const ID_CSRS = new Map([
    [0xf11, 'mvendorid: implementation-defined (Spike 0, ours 0)'],
    [0xf12, 'marchid: implementation-defined (Spike 5, ours 0 = not implemented)'],
    [0xf13, 'mimpid: implementation-defined'],
]);

/**
 * @param {Uint8Array|object} program an ELF or a fixture program
 * @param {Array} records Spike trace records (spike-trace.mjs)
 * @param {{maxSteps?: number, exemptRead?: Map<number,string>}} [opts]
 * @returns {{ok: boolean, steps: number, compared: number, diff?: string, exempted: Set<string>}}
 */
export function lockstep(program, records, opts = {}) {
    const {cpu, state} = makeTestCpu(program, opts);
    const entry = cpu.pc >>> 0;
    // Skip Spike's bootrom; replay its register writes.
    let i = 0;
    while (i < records.length && !(records[i].kind === 'commit' && records[i].pc === entry)) {
        const r = records[i];
        if (r.kind === 'commit') for (const [rd, v] of r.regs) cpu.x[rd] = v | 0;
        i++;
    }
    if (i === records.length) return {ok: false, steps: 0, compared: 0, diff: `Spike trace never reached the entry ${hex(entry)}`};

    // Record our stores during a step.
    let stores = [];
    const st8 = cpu.st8.bind(cpu), st16 = cpu.st16.bind(cpu), st32 = cpu.st32.bind(cpu);
    let depth = 0;   // st32 → st16 → st8 nest; record only the outermost
    // A/D updates by the page walk are implicit (Spike does not log them).
    const translate = cpu._translate.bind(cpu);
    cpu._translate = (va, acc) => { depth++; try { return translate(va, acc); } finally { depth--; } };
    cpu.st8 = (a, v) => { if (!depth) stores.push([a >>> 0, v & 0xff, 1]); depth++; try { st8(a, v); } finally { depth--; } };
    cpu.st16 = (a, v) => { if (!depth) stores.push([a >>> 0, v & 0xffff, 2]); depth++; try { st16(a, v); } finally { depth--; } };
    cpu.st32 = (a, v) => { if (!depth) stores.push([a >>> 0, v >>> 0, 4]); depth++; try { st32(a, v); } finally { depth--; } };

    const history = [];
    const exempted = new Set();
    let compared = 0, steps = 0;
    const max = opts.maxSteps ?? 5_000_000;
    const fail = (rec, why) => {
        const ctx = history.slice(-8).map(h => '    ' + h).join('\n');
        return {ok: false, steps, compared, exempted,
            diff: `first divergence at Spike record ${i} (step ${steps}):\n` +
                `  Spike: ${describe(rec)}\n  ours : ${why}\n  last instructions (ours, agreed):\n${ctx}`};
    };

    for (; i < records.length && steps < max && !state.done; ) {
        const rec = records[i];
        const before = Int32Array.from(cpu.x);
        const pc = cpu.pc >>> 0, priv = cpu.priv, traps0 = cpu._traps;
        // Stores are compared by address only when untranslated (MPRV counts).
        const bare = (cpu.csr[0x180] >>> 31) === 0 || cpu._effPriv('store') === 3;
        const inst = peekInst(cpu, pc);
        stores = [];
        cpu.step();
        steps++;
        const trapped = cpu._traps !== traps0;
        if (cpu.halted) return fail(rec, `core halted (${JSON.stringify(cpu.trap)}) at ${hex(pc)}`);

        if (trapped) {
            if (rec.kind !== 'trap') return fail(rec, `took a trap at ${hex(pc)} cause ${lastCause(cpu)}`);
            const cause = lastCause(cpu);
            if (rec.interrupt) {
                if (cause !== (0x80000000 | rec.code) >>> 0) return fail(rec, `trap cause ${hex(cause)}`);
            } else if (TRAP_CAUSE[rec.name] !== undefined && cause !== TRAP_CAUSE[rec.name]) {
                return fail(rec, `trap cause ${cause} (expected ${TRAP_CAUSE[rec.name]}) epc ${hex(pc)}`);
            }
            if (rec.epc !== pc) return fail(rec, `trap epc ${hex(pc)}`);
            if (rec.tval !== undefined && lastTval(cpu) !== rec.tval) return fail(rec, `trap tval ${hex(lastTval(cpu))}`);
            history.push(`${hex(pc)} trap ${rec.name}`);
            compared++; i++;
            continue;
        }
        if (rec.kind !== 'commit') return fail(rec, `retired ${hex(pc)} (${hex(inst)}) without a trap`);
        if (rec.pc !== pc) return fail(rec, `pc ${hex(pc)}`);
        if (rec.priv !== priv) return fail(rec, `priv ${priv} at ${hex(pc)}`);
        if (rec.insn !== inst) return fail(rec, `instruction ${hex(inst)} at ${hex(pc)}`);
        const written = new Set();
        // A read of an implementation-ID CSR (mvendorid/marchid/mimpid) returns
        // each model's own ID: adopt Spike's so later arithmetic agrees.
        const csrRead = (inst & 0x7f) === 0x73 && ((inst >>> 12) & 7) !== 0 ? inst >>> 20 : -1;
        if (ID_CSRS.has(csrRead)) {
            const rd = (inst >>> 7) & 0x1f;
            for (const [r, v] of rec.regs) if (r === rd) cpu.x[rd] = v | 0;
            exempted.add(ID_CSRS.get(csrRead));
        }
        for (const [rd, v] of rec.regs) {
            written.add(rd);
            if ((cpu.x[rd] >>> 0) !== (v >>> 0)) return fail(rec, `x${rd} = ${hex(cpu.x[rd])} after ${hex(pc)} (${hex(inst)})`);
        }
        for (let r = 1; r < 32; r++) {
            if (!written.has(r) && cpu.x[r] !== before[r])
                return fail(rec, `also wrote x${r} = ${hex(cpu.x[r])} (was ${hex(before[r])}) at ${hex(pc)}`);
        }
        for (const [n, v] of rec.csrs) {
            if (CSR_VALUE_EXEMPT.has(n)) { exempted.add(CSR_VALUE_EXEMPT.get(n)); continue; }
            // mip/sip: the machine timer/software/external lines (MTIP/MSIP/MEIP)
            // are driven by each model's own devices — Spike's CLINT starts
            // with mtimecmp = 0 so MTIP is up at boot; the harness has none.
            const devMask = (n === 0x344 || n === 0x144) ? ~0x888 : ~0;
            const ours = (cpu._readCsr(n) & devMask) >>> 0;
            if (ours !== ((v & devMask) >>> 0)) return fail(rec, `csr 0x${n.toString(16)} = ${hex(ours)} after ${hex(pc)} (${hex(inst)})`);
        }
        if (rec.stores.length !== stores.length)
            return fail(rec, `${stores.length} store(s) ${JSON.stringify(stores.map(s => s.map(hex)))} at ${hex(pc)}`);
        for (let k = 0; k < stores.length; k++) {
            const [sa, sv, ssz] = rec.stores[k], [oa, ov, osz] = stores[k];
            if (ssz !== osz || (sv >>> 0) !== (ov >>> 0) || (bare && sa !== oa))
                return fail(rec, `store ${hex(oa)} = ${hex(ov)} (${osz} bytes)`);
        }
        history.push(`${hex(pc)} ${hex(inst)}`);
        if (history.length > 64) history.splice(0, 32);
        compared++; i++;
    }
    // Spike's HTIF polls tohost every few thousand instructions, so its trace
    // may stop right after the terminate's low-word store, before our runner
    // has seen the high word: that is a clean halt too.
    if (!state.done && !(i >= records.length && state.pending)) return {ok: false, steps, compared, exempted,
        diff: `ran out of ${i >= records.length ? 'Spike trace' : 'steps'} before the program halted (pc ${hex(cpu.pc)})`};
    return {ok: true, steps, compared, exempted};
}

function peekInst(cpu, pc) {
    // The instruction bits Spike logs: 16 for a compressed op, else 32. Each
    // half is translated on its own (a 32-bit op can straddle a page), with
    // traps and A/D writes suppressed so the peek has no side effects; a
    // fetch fault is left to the step itself (and compared as a trap).
    const lo = peekHalf(cpu, pc);
    if (lo === null) return 0;
    if ((lo & 3) !== 3) return lo;
    const hi = peekHalf(cpu, (pc + 2) >>> 0);
    return hi === null ? 0 : (lo | (hi << 16)) >>> 0;
}

// The peek walks with a scratch TLB so it can neither use nor fill the core's
// real one (it walks with ADUE forced on, which the real core may not have).
const peekTlb = {tag: new Int32Array(768), ctx: new Int8Array(768), ppn: new Int32Array(768)};

function peekHalf(cpu, va) {
    const tlb = [cpu._tlbTag, cpu._tlbCtx, cpu._tlbPpn];
    if (tlb[0]) { peekTlb.tag.fill(0); [cpu._tlbTag, cpu._tlbCtx, cpu._tlbPpn] = [peekTlb.tag, peekTlb.ctx, peekTlb.ppn]; }
    try { return peekHalfRaw(cpu, va); }
    finally { if (tlb[0]) [cpu._tlbTag, cpu._tlbCtx, cpu._tlbPpn] = tlb; }
}

function peekHalfRaw(cpu, va) {
    const saveTrap = cpu._trap, st32 = cpu.st32, traps = cpu._traps;
    let faulted = false;
    cpu._trap = () => { faulted = true; };
    cpu.st32 = () => {};
    const adue = cpu.csr[0x31a];
    cpu.csr[0x31a] |= 1 << 29;                     // never fault on A/D in a peek
    let pa;
    try { pa = cpu._translate(va, 'fetch'); }
    finally { cpu._trap = saveTrap; cpu.st32 = st32; cpu._traps = traps; cpu.csr[0x31a] = adue; }
    return (faulted || pa === null) ? null : cpu.ld16(pa);
}

function lastCause(cpu) {
    // Whichever of mcause/scause the trap just wrote: S if we are now in S.
    return (cpu.priv === 1 ? cpu.csr[0x142] : cpu.csr[0x342]) >>> 0;
}
function lastTval(cpu) { return (cpu.priv === 1 ? cpu.csr[0x143] : cpu.csr[0x343]) >>> 0; }

function describe(r) {
    if (!r) return '(end of trace)';
    if (r.kind === 'trap') return `${r.name} epc ${hex(r.epc)}${r.tval !== undefined ? ' tval ' + hex(r.tval) : ''}`;
    const regs = r.regs.map(([n, v]) => `x${n}=${hex(v)}`).join(' ');
    const csrs = r.csrs.map(([n, v]) => `csr0x${n.toString(16)}=${hex(v)}`).join(' ');
    const st = r.stores.map(([a, v, s]) => `[${hex(a)}]=${hex(v)}/${s}`).join(' ');
    return `priv ${r.priv} ${hex(r.pc)} (${hex(r.insn)}) ${regs} ${csrs} ${st}`.trim();
}
