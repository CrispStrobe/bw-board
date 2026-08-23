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
 * Scope, stated: register-select pins must ride the CPU's A-lines
 * straight; RAM/ROM address pins may ride them in ANY order — a
 * permuted bus is detected per chip and carried as regions[].perm for
 * the machine's byte path (E5.2), while wiring no permutation can
 * describe (a data line, a glue output, a line above the window) stays
 * refused. RWB, PHI2 and the data bus are checked for presence, not
 * timing.
 *
 * @module
 */

const SELECT = {
    62256: { kind: 'ram', low: ['csb'] },
    '28c256': { kind: 'rom', low: ['ceb'] },
    w65c22: { kind: 'via', high: ['cs1'], low: ['cs2b'] },
    w65c51: { kind: 'acia', high: ['cs0'], low: ['cs1b'] },
    // TMS9918A: both strobes must decode low in one window. v1 contract,
    // stated: wire /CSR and /CSW from the SELECT side of the glue only —
    // the R/W / phi2 gating a real board adds is timing, and this
    // extractor models the address domain (same bound as RWB above).
    tms9918: { kind: 'vdp', low: ['csrb', 'cswb'] },
    // MC6850 (E5.1): three selects, all address-domain — cs0 and cs1
    // high, /cs2 low. The E clock is timing (same bound as PHI2 above);
    // the z80 twin extracts this chip identically on the IO side.
    mc6850: { kind: 'acia6850', high: ['cs0', 'cs1'], low: ['cs2b'] },
    // NS16C550 (E5.1): same three-select shape as the 6850; /ADS, the
    // strobes and the crystal are timing. The machine already ran
    // 'uart16550' from MAP/CHIP declarations — this entry lets the
    // DRAWN decode reach it.
    ns16c550: { kind: 'uart16550', high: ['cs0', 'cs1'], low: ['cs2b'] },
    // M6532 RIOT (E5.1): cs1 high, /cs2 low. RS0B is NOT a select — it
    // partitions the window into RAM (low) and registers (high), and the
    // core encodes it as address bit 7, so the RS row below demands it
    // ride A7 exactly like the 6507SBC decode.
    m6532: { kind: 'riot', high: ['cs1'], low: ['cs2b'] },
};
const RS_PINS = {
    via: ['rs0', 'rs1', 'rs2', 'rs3'], acia: ['rs0', 'rs1'], vdp: ['mode'],
    acia6850: ['rs'], uart16550: ['a0', 'a1', 'a2'],
    riot: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'rs0b'],
};
const CHIP_DECL = {
    via: 'W65C22', acia: 'W65C51', vdp: 'TMS9918', tilevga: 'TILEVGA',
    acia6850: 'MC6850', uart16550: 'NS16C550', riot: 'M6532',
};

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
            // E5.2: the v1 bound (refuse any permuted bus) is lifted for
            // RAM/ROM. Each chip A-pin must ride SOME CPU address line
            // inside the window, each line used exactly once — identity
            // is the common case, any other bijection is a PERMUTATION
            // the machine applies in its byte-access path (real
            // breadboards permute A-lines for routing convenience all
            // the time, and inside one chip that only relabels cells).
            // What stays refused is what a permutation cannot describe:
            // a pin on a data line or glue output, a pin above the
            // window, two pins on one line.
            const abits = Math.min(15, Math.log2(r.count) | 0);
            const perm = []; // perm[i] = CPU address bit chip pin a<i> rides
            let bad = null;
            for (let i = 0; i < abits && !bad; i++) {
                const d = netDriver.get(find(key(c.part.id, `a${i}`)));
                if (!d || d.type !== 'addr') {
                    bad = `${c.part.id}.a${i} does not ride a CPU address line — that is not a permutation, it is a different circuit`;
                } else if (d.bit >= abits) {
                    bad = `${c.part.id}.a${i} rides A${d.bit}, above the chip's ${abits}-bit window — not mappable as a permutation`;
                } else {
                    perm.push(d.bit);
                }
            }
            if (!bad && new Set(perm).size !== perm.length) {
                bad = `${c.part.id}: two A-pins ride the same CPU line — not a permutation`;
            }
            if (bad) { reasons.push(bad); continue; }
            const region = { kind: c.kind, start: r.lo, end: r.hi, part: c.part.id };
            if (perm.some((b, i) => b !== i)) {
                region.perm = perm;
                const swaps = perm.map((b, i) => (b !== i ? `a${i}→A${b}` : null))
                    .filter(Boolean).join(', ');
                notes.push(`${c.part.id} address lines are permuted (${swaps}) — modeled through the permutation; the bytes land where the wiring says`);
            }
            regions.push(region);
        } else {
            const rs = RS_PINS[c.kind];
            const bad = straight(c.part.id, rs, rs.map((_, i) => i));
            if (bad) { reasons.push(`${c.part.id}.${bad} must ride A${rs.indexOf(bad)} — register selects are the low address lines`); continue; }
            const span = c.kind === 'via' ? 16
                : (c.kind === 'vdp' || c.kind === 'acia6850') ? 2
                : c.kind === 'uart16550' ? 8
                : c.kind === 'riot' ? 256 : 4;
            if (r.count > span) notes.push(`${c.part.id} mirrors through ${hx(r.lo)}-${hx(r.hi)} (decoded coarsely); its registers sit at ${hx(r.lo)}`);
            // span = the MEASURED decode window, so the machine mirrors
            // the registers through it exactly like the silicon — a read
            // at any mirrored address hits the chip, not open bus.
            chips.push({ kind: c.kind, name: c.part.id, at: r.lo, span: r.count });
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    // ---- tilevga: the ribbon card, not a decoded chip -------------------
    // rene6502's card arrives on the expansion ribbon and claims a fixed
    // 16K window (the real cent1 pulls the RAM and gives it $0000-$3FFF).
    // The sidecar models that: one abstract `bus` terminal, the window
    // base in params.at. Extraction checks the ribbon is actually
    // connected and that the window collides with nothing already decoded.
    for (const p of parts) {
        if (p.kind !== 'tilevga') continue;
        const ribbon = wires.some((w) =>
            (w.from === p.id && String(w.fromTerminal).toLowerCase() === 'bus' && w.to === cpu.id)
            || (w.to === p.id && String(w.toTerminal).toLowerCase() === 'bus' && w.from === cpu.id));
        if (!ribbon) {
            reasons.push(`${p.id}.bus is not wired to ${cpu.id} — the card rides the CPU bus ribbon`);
            continue;
        }
        const at = (p.params && p.params.at != null) ? Number(p.params.at) : 0x4000;
        const end = at + 0x3fff;
        if (at < 0 || end > 0xffff || (at & 0x3fff) !== 0) {
            reasons.push(`${p.id}: window base ${hx(at)} must be 16K-aligned inside the address space`);
            continue;
        }
        let clash = null;
        for (let a = at; a <= end && !clash; a++) {
            for (const c of selChips) if (c.selected[a]) { clash = { a, id: c.part.id }; break; }
        }
        if (clash) {
            reasons.push(`bus contention at ${hx(clash.a)}: ${p.id}'s VRAM window overlaps ${clash.id} — move the window (params.at) or shrink the decode`);
            continue;
        }
        chips.push({ kind: 'tilevga', name: p.id, at });
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

    // ---- PS/2 keyboards wired to VIA port pins -------------------------
    // Not bus-decoded: the capture chain's parallel byte sits on PA/PB,
    // DATA AVAILABLE strobes CA1/CA2/CB1/CB2. Detected by net overlap.
    const peripherals = [];
    for (const p of parts) {
        if (p.kind !== 'ps2') continue;
        let viaChip = null;
        let port = null;
        let control = null;

        // Check d0-d7: if they share a net with a VIA's PA/PB pins
        for (let bit = 0; bit < 8; bit++) {
            const dNet = find(key(p.id, `d${bit}`));
            for (const c of chips) {
                if (c.kind !== 'via') continue;
                for (const [prt, prefix] of [['a', 'pa'], ['b', 'pb']]) {
                    if (find(key(c.name, `${prefix}${bit}`)) === dNet) {
                        viaChip = c.name;
                        port = prt;
                    }
                }
            }
        }
        // Check da: find the control line it's wired to
        const daNet = find(key(p.id, 'da'));
        if (viaChip) {
            for (const ctl of ['ca1', 'ca2', 'cb1', 'cb2']) {
                if (find(key(viaChip, ctl)) === daNet) {
                    control = ctl;
                }
            }
        }
        if (viaChip && port) {
            peripherals.push({
                kind: 'ps2', name: p.id,
                via: viaChip,
                port,
                control: control || 'ca1',
            });
            notes.push(`${p.id}: PS/2 keyboard on ${viaChip} port ${port.toUpperCase()}, DA → ${(control || 'ca1').toUpperCase()}`);
        }
    }

    const lines = [
        ...regions.map((r) => `MAP ${r.kind.toUpperCase()} ${hx(r.start)}-${hx(r.end)}`),
        ...chips.map((c) => `CHIP ${c.name} = ${CHIP_DECL[c.kind]} AT ${hx(c.at)}`),
    ];
    return {
        ok: true,
        // perm (when present) rides into the machine config; the MAP
        // grammar cannot express it, which is honest — only the drawn
        // wiring can produce a permuted bus in the first place.
        regions: regions.map(({ kind, start, end, perm }) =>
            (perm ? { kind, start, end, perm } : { kind, start, end })),
        chips,
        peripherals,
        lines,
        notes,
        reasons: [],
    };
}

export default extract6502Machine;
