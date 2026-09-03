/**
 * The 8086 bus extractor — the Z80 extractor's method on a twenty-bit
 * address space. The defining split is M/IO (active-low on the 8288 bus
 * controller, active-high on the 8086's own S2 line): memory and I/O are
 * SEPARATE decode spaces, exactly as with the Z80's MREQ/IORQ, and every
 * breadboard 8086 runs its chips off a 74138 or 74LS138 whose enable
 * inputs carry the bus-cycle type.
 *
 * The address domain is TWENTY bits for memory (the 8086's A0-A19) but
 * only SIXTEEN for I/O (A0-A15; in practice breadboard decodes never wire
 * past A7, so the chip mirrors through the upper byte exactly like the
 * Z80's eight-bit port idiom). Evaluating all 2^20 = 1,048,576 memory
 * addresses at every chip is the expensive case; the I/O pass is 65,536.
 *
 * SELECT entries: 62256 (RAM, CSB low), 28C256 (ROM, CEB low),
 * i8255 (PPI), MC6850 / NS16C550 (serial), and the Intel support chips
 * i8254 (PIT), i8259 (PIC) and i8251 (USART) — each a single active-low
 * /CS decoded in the port space, register-selected off the low A-lines.
 *
 * Refusals: contention (two chips at one address in one space), open
 * reset vector (no ROM at FFFF0h-FFFFFh), floating selects, non-
 * contiguous windows — each with the address named.
 *
 * @module
 */

const MEM_SELECT = {
    62256: { kind: 'ram', low: ['csb'] },
    '28c256': { kind: 'rom', low: ['ceb'] },
};

const IO_SELECT = {
    i8255: { kind: 'ppi', low: ['csb'] },
    mc6850: { kind: 'acia6850', high: ['cs0', 'cs1'], low: ['cs2b'] },
    ns16c550: { kind: 'uart16550', high: ['cs0', 'cs1'], low: ['cs2b'] },
    // The Intel-family support chips: each has a single active-low /CS and
    // selects its registers off the low address lines. The PIT and PIC are
    // wired the same way the PPI is; the 8251's one register-select line is
    // its C/D pin.
    i8254: { kind: 'pit', low: ['csb'] },
    i8259: { kind: 'pic', low: ['csb'] },
    i8251: { kind: 'usart8251', low: ['csb'] },
};

const RS_PINS = {
    ppi: ['a0', 'a1'],
    acia6850: ['rs'],
    uart16550: ['a0', 'a1', 'a2'],
    pit: ['a0', 'a1'],      // A0/A1 pick counter 0/1/2 or the control word
    pic: ['a0'],            // A0 picks command/status vs data/mask
    usart8251: ['cd'],      // C/D picks data vs control/status
};

const CHIP_DECL = {
    ppi: 'I8255', acia6850: 'MC6850', uart16550: 'NS16C550',
    pit: 'I8254', pic: 'I8259', usart8251: 'I8251',
};

/**
 * @param {{parts: Array<{id: string, kind: string}>,
 *          wires: Array<{from: string, fromTerminal: string,
 *                        to: string, toTerminal: string}>}} circuit
 * @returns {{ ok: boolean, regions?: Array, chips?: Array, lines?: string[],
 *             notes: string[], reasons: string[] }}
 */
export function extract8086Machine(circuit) {
    const reasons = [];
    const notes = [];
    const parts = circuit.parts || [];
    const wires = circuit.wires || [];

    // ---- nets: union-find over terminals -------------------------------
    const parent = new Map();
    const key = (id, t) => `${id}.${String(t).toLowerCase()}`;
    const find = (k) => {
        let r = k;
        while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
        parent.set(k, r);
        return r;
    };
    const union = (a, b) => {
        const ra = find(a); const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    for (const w of wires) union(key(w.from, w.fromTerminal), key(w.to, w.toTerminal));

    const cpu = parts.find((p) => p.kind === 'i8086' || p.kind === '8086'
        || p.kind === 'i8088' || p.kind === '8088');
    if (!cpu) return { ok: false, notes, reasons: ['no 8086/8088 on the board'] };

    // ---- drivers per net ------------------------------------------------
    const netDriver = new Map();
    const setDriver = (net, d, what) => {
        const prev = netDriver.get(net);
        if (prev && (prev.type !== d.type || prev.bit !== d.bit || prev.gate !== d.gate || prev.sig !== d.sig)) {
            reasons.push(`net has two drivers (${prev.what} and ${what}) — that is a short, not a decode`);
            return;
        }
        netDriver.set(net, { ...d, what });
    };
    for (let bit = 0; bit < 20; bit++) {
        setDriver(find(key(cpu.id, `a${bit}`)), { type: 'addr', bit }, `${cpu.id}.a${bit}`);
    }
    setDriver(find(key(cpu.id, 'mio')), { type: 'cycle', sig: 'mio' }, `${cpu.id}.mio`);
    for (const p of parts) {
        if (p.kind === 'vcc') setDriver(find(key(p.id, 'vcc')), { type: 'const', value: 1 }, p.id);
        if (p.kind === 'gnd') setDriver(find(key(p.id, 'gnd')), { type: 'const', value: 0 }, p.id);
        if (p.kind === '74hc00' || p.kind === '74hc132' || p.kind === '74ls00') {
            for (let g = 1; g <= 4; g++) {
                setDriver(find(key(p.id, `${g}y`)), {
                    type: 'nand', gate: `${p.id}.${g}`,
                    a: find(key(p.id, `${g}a`)), b: find(key(p.id, `${g}b`)),
                }, `${p.id}.${g}y`);
            }
        }
        if (p.kind === '74hc04' || p.kind === '74ls04') {
            for (let g = 1; g <= 6; g++) {
                setDriver(find(key(p.id, `${g}y`)), { type: 'not', a: find(key(p.id, `${g}a`)) }, `${p.id}.${g}y`);
            }
        }
        if (p.kind === '74hc32' || p.kind === '74ls32') {
            for (let g = 1; g <= 4; g++) {
                setDriver(find(key(p.id, `${g}y`)), {
                    type: 'or', gate: `${p.id}.${g}`,
                    a: find(key(p.id, `${g}a`)), b: find(key(p.id, `${g}b`)),
                }, `${p.id}.${g}y`);
            }
        }
        if (p.kind === '74hc138' || p.kind === '74ls138') {
            for (let out = 0; out < 8; out++) {
                setDriver(find(key(p.id, `y${out}`)), {
                    type: '138', gate: `${p.id}`,
                    e1b: find(key(p.id, 'e1b')), e2b: find(key(p.id, 'e2b')),
                    e3: find(key(p.id, 'e3')),
                    a: find(key(p.id, 'a')), b: find(key(p.id, 'b')), c: find(key(p.id, 'c')),
                    out,
                }, `${p.id}.y${out}`);
            }
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- evaluate a net at one address ----------------------------------
    let addr = 0;
    let cycle = { mio: 1 };
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
        else if (d.type === 'nand') {
            const a = evalNet(d.a, depth + 1); const b = evalNet(d.b, depth + 1);
            v = (a === null || b === null) ? null : 1 - (a & b);
        } else if (d.type === 'or') {
            const a = evalNet(d.a, depth + 1); const b = evalNet(d.b, depth + 1);
            v = (a === null || b === null) ? null : (a | b);
        } else if (d.type === 'not') {
            const a = evalNet(d.a, depth + 1);
            v = a === null ? null : 1 - a;
        } else if (d.type === '138') {
            const e1b = evalNet(d.e1b, depth + 1);
            const e2b = evalNet(d.e2b, depth + 1);
            const e3 = evalNet(d.e3, depth + 1);
            if (e1b === null || e2b === null || e3 === null) { v = null; }
            else if (e1b !== 0 || e2b !== 0 || e3 !== 1) { v = 1; }
            else {
                const a = evalNet(d.a, depth + 1) ?? 0;
                const b = evalNet(d.b, depth + 1) ?? 0;
                const c = evalNet(d.c, depth + 1) ?? 0;
                const sel = a | (b << 1) | (c << 2);
                v = (sel === d.out) ? 0 : 1;
            }
        }
        memo.set(net, v);
        return v;
    };

    // ---- collect memory-bus and I/O-bus chips ----------------------------
    const memChips = [];
    const ioChips = [];

    for (const p of parts) {
        const memSpec = MEM_SELECT[p.kind];
        if (memSpec) {
            const pins = [];
            for (const t of memSpec.high || []) pins.push({ net: find(key(p.id, t)), want: 1, t });
            for (const t of memSpec.low || []) pins.push({ net: find(key(p.id, t)), want: 0, t });
            for (const pin of pins) {
                if (!netDriver.has(pin.net)) reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            }
            memChips.push({ part: p, kind: memSpec.kind, pins, selected: null });
            continue;
        }
        const ioSpec = IO_SELECT[p.kind];
        if (ioSpec) {
            const pins = [];
            for (const t of ioSpec.high || []) pins.push({ net: find(key(p.id, t)), want: 1, t });
            for (const t of ioSpec.low || []) pins.push({ net: find(key(p.id, t)), want: 0, t });
            for (const pin of pins) {
                if (!netDriver.has(pin.net)) reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            }
            ioChips.push({ part: p, kind: ioSpec.kind, pins, selected: new Uint8Array(65536) });
        }
    }
    if (!memChips.length && !ioChips.length) reasons.push('no RAM, ROM, PPI or serial chip on the board');
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- memory sweep (20-bit) ------------------------------------------
    // A full 1M sweep per chip is expensive but correct. To keep it
    // tractable, store only the contiguous range boundaries rather than a
    // megabyte-wide selected[] array.
    const memRanges = memChips.map(() => ({ lo: -1, hi: -1, count: 0, holed: false }));

    try {
        cycle = { mio: 1 };   // memory cycle: M/IO high (active-high memory)
        for (addr = 0; addr < (1 << 20); addr++) {
            memo = new Map();
            for (let ci = 0; ci < memChips.length; ci++) {
                const c = memChips[ci];
                let on = 1;
                for (const pin of c.pins) {
                    if (evalNet(pin.net) !== pin.want) { on = 0; break; }
                }
                if (on) {
                    const r = memRanges[ci];
                    if (r.lo < 0) r.lo = addr;
                    else if (addr > r.hi + 1) r.holed = true;
                    r.hi = addr;
                    r.count++;
                }
            }
        }

        // I/O sweep (16-bit port space, but breadboard decodes use 8-bit)
        cycle = { mio: 0 };   // I/O cycle: M/IO low
        for (addr = 0; addr < 65536; addr++) {
            memo = new Map();
            for (const c of ioChips) {
                let on = 1;
                for (const pin of c.pins) {
                    if (evalNet(pin.net) !== pin.want) { on = 0; break; }
                }
                c.selected[addr] = on;
            }
        }
    } catch (e) {
        return { ok: false, notes, reasons: [e.message] };
    }

    // ---- contention: memory space ---------------------------------------
    // Check pairwise overlap using the discovered ranges.
    for (let i = 0; i < memChips.length; i++) {
        const ri = memRanges[i];
        if (ri.lo < 0) continue;
        for (let j = i + 1; j < memChips.length; j++) {
            const rj = memRanges[j];
            if (rj.lo < 0) continue;
            if (ri.lo <= rj.hi && rj.lo <= ri.hi) {
                const overlap = Math.max(ri.lo, rj.lo);
                return { ok: false, notes, reasons: [
                    `memory-space contention at ${hx20(overlap)}: ${memChips[i].part.id} and ${memChips[j].part.id} are both selected`] };
            }
        }
    }

    // ---- contention: I/O space ------------------------------------------
    for (let a = 0; a < 65536; a++) {
        const on = ioChips.filter((c) => c.selected[a]);
        if (on.length > 1) {
            return { ok: false, notes, reasons: [
                `port-space contention at port ${hx16(a)}: ${on.map((c) => c.part.id).join(' and ')}`] };
        }
    }

    // ---- build regions and chips ----------------------------------------
    const regions = [];
    for (let ci = 0; ci < memChips.length; ci++) {
        const c = memChips[ci];
        const r = memRanges[ci];
        if (r.lo < 0) { reasons.push(`${c.part.id} is never selected — check its select wiring`); continue; }
        if (r.holed || r.count !== r.hi - r.lo + 1) {
            reasons.push(`${c.part.id} is selected over a non-contiguous range — the machine model wants one window per chip`);
            continue;
        }
        regions.push({ kind: c.kind, start: r.lo, end: r.hi });
    }

    const chips = [];
    for (const c of ioChips) {
        let lo = -1; let hi = -1; let count = 0;
        for (let a = 0; a < 65536; a++) {
            if (c.selected[a]) { if (lo < 0) lo = a; hi = a; count++; }
        }
        if (lo < 0) { reasons.push(`${c.part.id} is never selected in port space — check its select wiring`); continue; }
        const rs = RS_PINS[c.kind];
        if (rs) {
            for (let i = 0; i < rs.length; i++) {
                const d = netDriver.get(find(key(c.part.id, rs[i])));
                if (!d || d.type !== 'addr' || d.bit !== i) {
                    reasons.push(`${c.part.id}.${rs[i]} must ride A${i} — register selects are the low address lines`);
                }
            }
        }
        if (count > (rs ? (1 << rs.length) : 1)) {
            notes.push(`${c.part.id} mirrors through ports ${hx16(lo)}-${hx16(hi)}; its registers sit at ${hx16(lo)}`);
        }
        chips.push({ kind: c.kind, name: c.part.id, at: lo, span: count });
    }
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- the reset vector must live somewhere ---------------------------
    const rom = regions.find((r) => r.kind === 'rom' && r.start <= 0xffff0 && r.end >= 0xfffff);
    if (!rom) {
        return { ok: false, notes, reasons: [
            'no ROM is selected at FFFF0h-FFFFFh — the 8086 fetches its first instruction from FFFF:0000 and this machine would never boot'] };
    }

    // Unmapped space note
    let memCovered = 0;
    for (const r of regions) memCovered += r.end - r.start + 1;
    const holes = (1 << 20) - memCovered;
    if (holes) notes.push(`${holes} memory addresses decode to nothing (open bus) — reads there return FFh`);

    const lines = [
        ...regions.map((r) => `MAP ${r.kind.toUpperCase()} ${hx20(r.start)}-${hx20(r.end)}`),
        ...chips.map((c) => `CHIP ${c.name} = ${CHIP_DECL[c.kind]} AT PORT ${hx16(c.at)}`),
    ];
    return { ok: true, regions, chips, lines, notes, reasons: [] };
}

function hx20(n) { return n.toString(16).toUpperCase().padStart(5, '0') + 'h'; }
function hx16(n) { return n.toString(16).toUpperCase().padStart(4, '0') + 'h'; }

export default extract8086Machine;
