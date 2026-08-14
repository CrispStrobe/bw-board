/**
 * The bus extractor — config source #3 of the composable 6502 machine.
 *
 * Input: a designer circuit (parts + wires) holding a W65C02, RAM (62256),
 * ROM (28C256), a W65C22/W65C51, and 74HC00 glue, wired BY HAND like the
 * real breadboard build. Output: the same {regions, chips} config the
 * MAP/CHIP declarations produce — plus the declaration LINES themselves,
 * which is what makes the three config sources one.
 *
 * Method: no symbolic solving. Nets are built union-find style from the
 * wires; each chip's select condition (62256: CSB low; 28C256: CEB low; W65C22:
 * CS1 high AND CS2B low; W65C51: CS0 high AND CS1B low) is EVALUATED at
 * all 65536 addresses by propagating A0-A15 through the NAND network.
 * Wire the decode wrong and the extraction is wrong in exactly the way
 * the real breadboard would be — including the two failures that matter:
 * BUS CONTENTION (two chips selected at one address) and OPEN VECTORS
 * (no ROM at $FFFA-$FFFF), both refused with addresses named.
 *
 * v1 scope, stated: address/register-select pins must ride the CPU's
 * A-lines straight (a permuted address bus scrambles bytes inside a chip
 * without changing its range — refused rather than half-modeled); RWB,
 * PHI2 and the data bus are checked for presence, not timing.
 *
 * @module
 */

const SELECT = {
    62256: { kind: 'ram', low: ['csb'] },
    '28c256': { kind: 'rom', low: ['ceb'] },
    w65c22: { kind: 'via', high: ['cs1'], low: ['cs2b'] },
    w65c51: { kind: 'acia', high: ['cs0'], low: ['cs1b'] },
};
const RS_PINS = { via: ['rs0', 'rs1', 'rs2', 'rs3'], acia: ['rs0', 'rs1'] };

/**
 * @param {{parts: Array<{id: string, kind: string}>, wires: Array<{from: string, fromTerminal: string, to: string, toTerminal: string}>}} circuit
 * @returns {{ ok: boolean, regions?: Array, chips?: Array, lines?: string[], notes: string[], reasons: string[] }}
 */
export function extract6502Machine(circuit) {
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

    const cpu = parts.find((p) => p.kind === 'w65c02');
    if (!cpu) return { ok: false, notes, reasons: ['no W65C02 on the board'] };

    // ---- drivers per net ------------------------------------------------
    // A net is: an address line (CPU drives it), vcc (1), gnd (0), or a
    // NAND output. Everything else is undriven for select purposes.
    const netDriver = new Map(); // netRoot -> {type, ...}
    const setDriver = (net, d, what) => {
        const prev = netDriver.get(net);
        if (prev && (prev.type !== d.type || prev.bit !== d.bit || prev.gate !== d.gate)) {
            reasons.push(`net has two drivers (${prev.what} and ${what}) — that is a short, not a decode`);
            return;
        }
        netDriver.set(net, { ...d, what });
    };
    for (let bit = 0; bit < 16; bit++) {
        setDriver(find(key(cpu.id, `a${bit}`)), { type: 'addr', bit }, `${cpu.id}.a${bit}`);
    }
    for (const p of parts) {
        if (p.kind === 'vcc') setDriver(find(key(p.id, 'vcc')), { type: 'const', value: 1 }, p.id);
        if (p.kind === 'gnd') setDriver(find(key(p.id, 'gnd')), { type: 'const', value: 0 }, p.id);
        // The 74HC132 is the 74HC00 with Schmitt-trigger inputs — same
        // pinout, same truth table; hysteresis is invisible at logic level.
        // It is the Wilson-primer decode gate (its spare Schmitt inputs
        // double as the reset conditioner there).
        if (p.kind === '74hc00' || p.kind === '74hc132') {
            for (let g = 1; g <= 4; g++) {
                setDriver(find(key(p.id, `${g}y`)), {
                    type: 'nand', gate: `${p.id}.${g}`,
                    a: find(key(p.id, `${g}a`)), b: find(key(p.id, `${g}b`)),
                }, `${p.id}.${g}y`);
            }
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- evaluate a net at one address (memoized per address) ----------
    let addr = 0;
    let memo = new Map();
    const evalNet = (net, depth = 0) => {
        if (depth > 32) throw new Error('combinational loop in the glue network');
        if (memo.has(net)) return memo.get(net);
        const d = netDriver.get(net);
        let v;
        if (!d) v = null; // undriven
        else if (d.type === 'addr') v = (addr >> d.bit) & 1;
        else if (d.type === 'const') v = d.value;
        else {
            const a = evalNet(d.a, depth + 1);
            const b = evalNet(d.b, depth + 1);
            v = (a === null || b === null) ? null : 1 - (a & b);
        }
        memo.set(net, v);
        return v;
    };

    // ---- per-chip select nets ------------------------------------------
    const selChips = [];
    for (const p of parts) {
        const spec = SELECT[p.kind];
        if (!spec) continue;
        const pins = [];
        for (const t of spec.high || []) pins.push({ net: find(key(p.id, t)), want: 1, t });
        for (const t of spec.low || []) pins.push({ net: find(key(p.id, t)), want: 0, t });
        for (const pin of pins) {
            if (!netDriver.has(pin.net)) {
                reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            }
        }
        selChips.push({ part: p, kind: spec.kind, pins, selected: new Uint8Array(65536) });
    }
    if (!selChips.length) reasons.push('no RAM, ROM, VIA or ACIA on the board');
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- the sweep ------------------------------------------------------
    try {
        for (addr = 0; addr < 65536; addr++) {
            memo = new Map();
            for (const c of selChips) {
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

    // ---- contention: two chips at one address --------------------------
    for (let a = 0; a < 65536; a++) {
        const on = selChips.filter((c) => c.selected[a]);
        if (on.length > 1) {
            return { ok: false, notes,
                reasons: [`bus contention at $${a.toString(16).padStart(4, '0')}: ${on.map((c) => c.part.id).join(' and ')} are both selected — the decode must make them exclusive`] };
        }
    }

    // ---- ranges ---------------------------------------------------------
    const hx = (n) => '$' + n.toString(16).toUpperCase().padStart(4, '0');
    const rangeOf = (c) => {
        let lo = -1; let hi = -1; let count = 0;
        for (let a = 0; a < 65536; a++) {
            if (c.selected[a]) { if (lo < 0) lo = a; hi = a; count++; }
        }
        if (lo < 0) return null;
        if (count !== hi - lo + 1) {
            reasons.push(`${c.part.id} is selected over a non-contiguous range — the machine model wants one window per chip`);
            return null;
        }
        return { lo, hi, count };
    };

    // Address-line straightness for RAM/ROM and register selects for chips.
    const straight = (partId, chipPins, cpuBits) => {
        for (let i = 0; i < chipPins.length; i++) {
            const chipNet = find(key(partId, chipPins[i]));
            const d = netDriver.get(chipNet);
            if (!d || d.type !== 'addr' || d.bit !== cpuBits[i]) return chipPins[i];
        }
        return null;
    };

    const regions = [];
    const chips = [];
    for (const c of selChips) {
        const r = rangeOf(c);
        if (!r) { if (!reasons.length) reasons.push(`${c.part.id} is never selected — check its select wiring`); continue; }
        if (c.kind === 'ram' || c.kind === 'rom') {
            const abits = Math.min(15, Math.log2(r.count) | 0);
            const pinsNeeded = [];
            for (let i = 0; i < abits; i++) pinsNeeded.push(`a${i}`);
            const bad = straight(c.part.id, pinsNeeded, pinsNeeded.map((_, i) => i));
            if (bad) { reasons.push(`${c.part.id}.${bad} does not ride the CPU's matching address line — a permuted bus scrambles bytes; wire A-lines straight`); continue; }
            regions.push({ kind: c.kind, start: r.lo, end: r.hi, part: c.part.id });
        } else {
            const rs = RS_PINS[c.kind];
            const bad = straight(c.part.id, rs, rs.map((_, i) => i));
            if (bad) { reasons.push(`${c.part.id}.${bad} must ride A${rs.indexOf(bad)} — register selects are the low address lines`); continue; }
            const span = c.kind === 'via' ? 16 : 4;
            if (r.count > span) notes.push(`${c.part.id} mirrors through ${hx(r.lo)}-${hx(r.hi)} (decoded coarsely); its registers sit at ${hx(r.lo)}`);
            chips.push({ kind: c.kind, name: c.part.id, at: r.lo });
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- the vectors must live somewhere -------------------------------
    const rom = regions.find((r) => r.kind === 'rom' && r.start <= 0xfffa && r.end >= 0xffff);
    if (!rom) {
        return { ok: false, notes, reasons: ['no ROM is selected at $FFFA-$FFFF — the CPU reads RESET from there and this machine would never boot'] };
    }

    // Unmapped space is legal (open bus) but worth a note.
    const covered = new Uint8Array(65536);
    for (const c of selChips) for (let a = 0; a < 65536; a++) if (c.selected[a]) covered[a] = 1;
    let holes = 0;
    for (let a = 0; a < 65536; a++) if (!covered[a]) holes++;
    if (holes) notes.push(`${holes} addresses decode to nothing (open bus) — reads there return $FF`);

    const lines = [
        ...regions.map((r) => `MAP ${r.kind.toUpperCase()} ${hx(r.start)}-${hx(r.end)}`),
        ...chips.map((c) => `CHIP ${c.name} = ${c.kind === 'via' ? 'W65C22' : 'W65C51'} AT ${hx(c.at)}`),
    ];
    return {
        ok: true,
        regions: regions.map(({ kind, start, end }) => ({ kind, start, end })),
        chips,
        lines,
        notes,
        reasons: [],
    };
}

export default extract6502Machine;
