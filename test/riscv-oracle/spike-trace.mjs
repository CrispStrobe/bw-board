// Parse `spike -l --log-commits` output (stderr) into lockstep records, and
// pack/unpack them as a compact gzipped fixture so CI need not build Spike.
//
// Spike prints, per instruction: an `-l` fetch line
//     core   0: 0x80000000 (0x0480006f) j       pc + 0x48
// then, if it retired, a commit line
//     core   0: 3 0x80000000 (0x0480006f) x5  0x80000004 c768_mstatus 0x00000080 mem 0x80002000 0x00000001
// (priv, pc, instruction bits, then GPR writes `xN val`, CSR writes
// `cNNN_name val`, loads `mem addr`, stores `mem addr val` — the store value
// printed at its access width), or, if it trapped,
//     core   0: exception trap_illegal_instruction, epc 0x80000104
//     core   0:           tval 0x00000000
// (an interrupt reads `exception interrupt #7, epc ...`).

import {gzipSync, gunzipSync} from 'node:zlib';

const COMMIT = /^core\s+\d+: (\d) 0x([0-9a-f]+) \(0x([0-9a-f]+)\)(.*)$/;
const TRAP = /^core\s+\d+: exception (.+?), epc 0x([0-9a-f]+)/;
const TVAL = /^core\s+\d+:\s+tval 0x([0-9a-f]+)/;

export function parseSpikeLog(text) {
    const recs = [];
    for (const line of text.split('\n')) {
        let m = COMMIT.exec(line);
        if (m) {
            const r = {kind: 'commit', priv: +m[1], pc: parseInt(m[2], 16) >>> 0, insn: parseInt(m[3], 16) >>> 0,
                regs: [], csrs: [], stores: []};
            const t = m[4].trim().split(/\s+/).filter(Boolean);
            for (let k = 0; k < t.length; k++) {
                const tok = t[k];
                let mm;
                if ((mm = /^x(\d+)$/.exec(tok))) { r.regs.push([+mm[1], parseInt(t[++k], 16) >>> 0]); }
                else if ((mm = /^c(\d+)_/.exec(tok))) { r.csrs.push([+mm[1], parseInt(t[++k], 16) >>> 0]); }
                else if (tok === 'mem') {
                    const addr = parseInt(t[++k], 16) >>> 0;
                    const nx = t[k + 1];
                    if (nx && /^0x[0-9a-f]+$/.test(nx)) {                    // a store: value at its width
                        k++;
                        r.stores.push([addr, parseInt(nx, 16) >>> 0, (nx.length - 2) / 2]);
                    }
                }
            }
            recs.push(r);
            continue;
        }
        m = TRAP.exec(line);
        if (m) {
            const name = m[1];
            const im = /^interrupt #(\d+)$/.exec(name);
            recs.push({kind: 'trap', name, interrupt: !!im, code: im ? +im[1] : undefined, epc: parseInt(m[2], 16) >>> 0});
            continue;
        }
        m = TVAL.exec(line);
        if (m && recs.length && recs[recs.length - 1].kind === 'trap') recs[recs.length - 1].tval = parseInt(m[1], 16) >>> 0;
    }
    return recs;
}

// Fixture form: one JSON array per record, gzipped. Commit:
//   [pc, insn, priv, [rd,v,...], [csr,v,...], [addr,v,size,...]]   (pc omitted as 0
//   when it is the fall-through of the previous commit — the common case)
// Trap: ['t', name, epc, tval|null]
export function packTrace(recs) {
    return gzipSync(Buffer.from(JSON.stringify(packTraceRows(recs))), {level: 9});
}

export function unpackTrace(buf) { return unpackTraceRows(JSON.parse(gunzipSync(buf).toString())); }

/** The row form (JSON-able) — fixtures embed it inside a larger gzipped JSON. */
export function packTraceRows(recs) {
    const out = [];
    let expect = -1;
    for (const r of recs) {
        if (r.kind === 'trap') { out.push(['t', r.name, r.epc, r.tval ?? null]); expect = -1; continue; }
        const len = (r.insn & 3) === 3 ? 4 : 2;
        const row = [r.pc === expect ? 0 : r.pc, r.insn, r.priv, r.regs.flat(), r.csrs.flat(), r.stores.flat()];
        while (row.length > 3 && row[row.length - 1].length === 0) row.pop();
        out.push(row);
        expect = (r.pc + len) >>> 0;
    }
    return out;
}

export function unpackTraceRows(rows) {
    const recs = [];
    let expect = -1;
    const pairs = (a = []) => { const o = []; for (let k = 0; k < a.length; k += 2) o.push([a[k], a[k + 1]]); return o; };
    for (const row of rows) {
        if (row[0] === 't') {
            const im = /^interrupt #(\d+)$/.exec(row[1]);
            const r = {kind: 'trap', name: row[1], interrupt: !!im, code: im ? +im[1] : undefined, epc: row[2]};
            if (row[3] !== null) r.tval = row[3];
            recs.push(r); expect = -1; continue;
        }
        const [pc0, insn, priv, regs, csrs, st = []] = row;
        const pc = pc0 === 0 ? expect : pc0;
        const stores = [];
        for (let k = 0; k < st.length; k += 3) stores.push([st[k], st[k + 1], st[k + 2]]);
        recs.push({kind: 'commit', pc, insn, priv, regs: pairs(regs), csrs: pairs(csrs), stores});
        expect = (pc + ((insn & 3) === 3 ? 4 : 2)) >>> 0;
    }
    return recs;
}
