/**
 * The Z80 bus extractor — the 6502 extractor's method with the Z80's
 * defining split: a chip select is a function of the address lines AND
 * the cycle type, because /MREQ and /IORQ separate memory space from
 * port space on the real bus. Every select is therefore evaluated
 * TWICE per address: once as a memory cycle (mreqb=0, iorqb=1) and once
 * as an I/O cycle (iorqb=0, mreqb=1, high address byte 0 — the Z80's
 * 8-bit port decode idiom). Memory-mode selections become regions; I/O-
 * mode selections of an MC6850 become port entries.
 *
 * Terminal-name CONTRACT (bw-parts follows this): z80 = a0-a15, d0-d7,
 * mreqb, iorqb, rdb, wrb, m1b, rfshb, haltb, waitb, intb, nmib, resetb,
 * busrqb, busakb, clk, vcc, gnd. mc6850 = cs0, cs1, cs2b, rs, rw, e,
 * d0-d7, txd, rxd, txclk, rxclk, rtsb, ctsb, dcdb, irqb, vcc, vss.
 * MC6850 selected iff cs0=1 AND cs1=1 AND cs2b=0; rs must ride a0.
 *
 * Refusals mirror the 6502 extractor's: contention (two chips in one
 * space at one address), floating selects, shorts, non-contiguous
 * windows, permuted address buses — each with the address named.
 *
 * @module
 */

const MEM_SELECT = { 62256: { kind: 'ram', low: ['csb'] }, '28c256': { kind: 'rom', low: ['ceb'] } };

export function extractZ80Machine(circuit) {
    const reasons = [];
    const notes = [];
    const parts = circuit.parts || [];
    const wires = circuit.wires || [];

    const parent = new Map();
    const key = (id, t) => `${id}.${String(t).toLowerCase()}`;
    const find = (k) => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r); parent.set(k, r); return r; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const w of wires) union(key(w.from, w.fromTerminal), key(w.to, w.toTerminal));

    const cpu = parts.find((p) => p.kind === 'z80');
    if (!cpu) return { ok: false, notes, reasons: ['no Z80 on the board'] };

    const netDriver = new Map();
    const setDriver = (net, d, what) => {
        const prev = netDriver.get(net);
        if (prev && (prev.type !== d.type || prev.bit !== d.bit || prev.gate !== d.gate || prev.sig !== d.sig)) {
            reasons.push(`net has two drivers (${prev.what} and ${what}) — that is a short, not a decode`);
            return;
        }
        netDriver.set(net, { ...d, what });
    };
    for (let bit = 0; bit < 16; bit++) setDriver(find(key(cpu.id, `a${bit}`)), { type: 'addr', bit }, `${cpu.id}.a${bit}`);
    setDriver(find(key(cpu.id, 'mreqb')), { type: 'cycle', sig: 'mreqb' }, `${cpu.id}.mreqb`);
    setDriver(find(key(cpu.id, 'iorqb')), { type: 'cycle', sig: 'iorqb' }, `${cpu.id}.iorqb`);
    for (const p of parts) {
        if (p.kind === 'vcc') setDriver(find(key(p.id, 'vcc')), { type: 'const', value: 1 }, p.id);
        if (p.kind === 'gnd') setDriver(find(key(p.id, 'gnd')), { type: 'const', value: 0 }, p.id);
        // 74HC132 = 74HC00 pinout/truth table with Schmitt inputs; the
        // hysteresis is invisible at logic level, so it aliases here too.
        if (p.kind === '74hc00' || p.kind === '74hc132') {
            for (let g = 1; g <= 4; g++) {
                setDriver(find(key(p.id, `${g}y`)), { type: 'nand', gate: `${p.id}.${g}`, a: find(key(p.id, `${g}a`)), b: find(key(p.id, `${g}b`)) }, `${p.id}.${g}y`);
            }
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    let addr = 0;
    let cycle = { mreqb: 1, iorqb: 1 };
    let memo = new Map();
    const evalNet = (net, depth = 0) => {
        if (depth > 32) throw new Error('combinational loop in the glue network');
        if (memo.has(net)) return memo.get(net);
        const d = netDriver.get(net);
        let v;
        if (!d) v = null;
        else if (d.type === 'addr') v = (addr >> d.bit) & 1;
        else if (d.type === 'cycle') v = cycle[d.sig];
        else if (d.type === 'const') v = d.value;
        else {
            const a = evalNet(d.a, depth + 1); const b = evalNet(d.b, depth + 1);
            v = (a === null || b === null) ? null : 1 - (a & b);
        }
        memo.set(net, v);
        return v;
    };

    const memChips = [];
    const ioChips = [];
    for (const p of parts) {
        const spec = MEM_SELECT[p.kind];
        if (spec) {
            const net = find(key(p.id, spec.low[0]));
            if (!netDriver.has(net)) { reasons.push(`${p.id}.${spec.low[0]} is undriven — a floating chip select is not a decode`); continue; }
            memChips.push({ part: p, kind: spec.kind, net, selected: new Uint8Array(65536) });
        } else if (p.kind === 'mc6850') {
            const pins = [
                { net: find(key(p.id, 'cs0')), want: 1, t: 'cs0' },
                { net: find(key(p.id, 'cs1')), want: 1, t: 'cs1' },
                { net: find(key(p.id, 'cs2b')), want: 0, t: 'cs2b' },
            ];
            for (const pin of pins) if (!netDriver.has(pin.net)) reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            ioChips.push({ part: p, pins, ioKind: 'acia6850', rsPin: 'rs', selected: new Uint8Array(256) });
        } else if (p.kind === 'mc6845') {
            // The CRTC: /CS decodes low in port space; the register
            // select rides A0. The SILICON calls it RS (active-HIGH),
            // but the bw-parts sidecar currently names it rsb — accept
            // either spelling so a sidecar rename doesn't break wiring.
            // MA0-MA13/RA0-RA4 generate the framebuffer scan on a real
            // board and are decorative here — the machine gives the chip
            // a live view of system RAM at params.vramAt instead.
            const hasRsWire = wires.some(w =>
                (w.from === p.id && w.fromTerminal === 'rs') ||
                (w.to === p.id && w.toTerminal === 'rs'));
            const rsName = hasRsWire ? 'rs' : 'rsb';
            const pins = [{ net: find(key(p.id, 'csb')), want: 0, t: 'csb' }];
            for (const pin of pins) if (!netDriver.has(pin.net)) reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            ioChips.push({ part: p, pins, ioKind: 'crtc', rsPin: rsName, selected: new Uint8Array(256) });
        }
    }
    if (!memChips.length && !ioChips.length) reasons.push('no RAM, ROM or ACIA on the board');
    if (reasons.length) return { ok: false, notes, reasons };

    try {
        cycle = { mreqb: 0, iorqb: 1 };            // memory cycles
        for (addr = 0; addr < 65536; addr++) {
            memo = new Map();
            for (const c of memChips) c.selected[addr] = evalNet(c.net) === 0 ? 1 : 0;
        }
        cycle = { mreqb: 1, iorqb: 0 };            // I/O cycles, 8-bit ports
        for (addr = 0; addr < 256; addr++) {
            memo = new Map();
            for (const c of ioChips) {
                let on = 1;
                for (const pin of c.pins) if (evalNet(pin.net) !== pin.want) { on = 0; break; }
                c.selected[addr] = on;
            }
        }
    } catch (e) {
        return { ok: false, notes, reasons: [e.message] };
    }

    const hx = (n) => '$' + n.toString(16).toUpperCase().padStart(4, '0');
    for (let a = 0; a < 65536; a++) {
        const on = memChips.filter((c) => c.selected[a]);
        if (on.length > 1) return { ok: false, notes, reasons: [`memory-space contention at ${hx(a)}: ${on.map((c) => c.part.id).join(' and ')}`] };
    }
    for (let a = 0; a < 256; a++) {
        const on = ioChips.filter((c) => c.selected[a]);
        if (on.length > 1) return { ok: false, notes, reasons: [`port-space contention at port ${hx(a)}: ${on.map((c) => c.part.id).join(' and ')}`] };
    }

    const regions = [];
    for (const c of memChips) {
        let lo = -1, hi = -1, count = 0;
        for (let a = 0; a < 65536; a++) if (c.selected[a]) { if (lo < 0) lo = a; hi = a; count++; }
        if (lo < 0) { reasons.push(`${c.part.id} is never selected — check its select wiring`); continue; }
        if (count !== hi - lo + 1) { reasons.push(`${c.part.id} is selected over a non-contiguous range`); continue; }
        const abits = Math.min(15, Math.log2(count) | 0);
        for (let i = 0; i < abits; i++) {
            const d = netDriver.get(find(key(c.part.id, `a${i}`)));
            if (!d || d.type !== 'addr' || d.bit !== i) { reasons.push(`${c.part.id}.a${i} does not ride the CPU's matching address line — wire A-lines straight`); break; }
        }
        regions.push({ kind: c.kind, start: lo, end: hi });
    }
    const ports = [];
    for (const c of ioChips) {
        let lo = -1, hi = -1, count = 0;
        for (let a = 0; a < 256; a++) if (c.selected[a]) { if (lo < 0) lo = a; hi = a; count++; }
        if (lo < 0) { reasons.push(`${c.part.id} is never selected in port space — check its select wiring`); continue; }
        const rs = netDriver.get(find(key(c.part.id, c.rsPin)));
        if (!rs || rs.type !== 'addr' || rs.bit !== 0) { reasons.push(`${c.part.id}.${c.rsPin} must ride A0 — the register select is the low address line`); continue; }
        if (count > 2) notes.push(`${c.part.id} mirrors through ports ${hx(lo)}-${hx(hi)}; its registers sit at ${hx(lo)}`);
        const entry = { kind: c.ioKind, name: c.part.id, at: lo };
        if (c.ioKind === 'crtc') {
            entry.vramAt = c.part.params?.vramAt ?? 0xf000;
            notes.push(`${c.part.id}: framebuffer is system RAM at ${hx(entry.vramAt)} (params.vramAt) — the MA/RA pins are the real board's scan generator, unused here`);
        }
        ports.push(entry);
    }
    if (reasons.length) return { ok: false, notes, reasons };

    return {
        ok: true,
        regions,
        ports,
        lines: [
            ...regions.map((r) => `MAP ${r.kind.toUpperCase()} ${hx(r.start)}-${hx(r.end)}`),
            ...ports.map((p) => `CHIP ${p.name} = ${p.kind === 'crtc' ? 'MC6845' : 'MC6850'} AT PORT ${hx(p.at)}`),
        ],
        notes,
        reasons: [],
    };
}

export default extractZ80Machine;
