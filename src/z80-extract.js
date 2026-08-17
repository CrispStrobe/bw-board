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
    // /RD and /WR: needed for port decodes that gate on the bus strobe
    // (UM245R's /RD IS the chip select; PainfulDiodes §5 ORs /RD into
    // the port-read term). During port sweep we assert /RD active.
    setDriver(find(key(cpu.id, 'rdb')), { type: 'cycle', sig: 'rdb' }, `${cpu.id}.rdb`);
    setDriver(find(key(cpu.id, 'wrb')), { type: 'cycle', sig: 'wrb' }, `${cpu.id}.wrb`);
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
        // 74HC04 / 74LS04 — Hex inverter
        if (p.kind === '74hc04' || p.kind === '74ls04') {
            for (let g = 1; g <= 6; g++) {
                setDriver(find(key(p.id, `${g}y`)), { type: 'not', a: find(key(p.id, `${g}a`)) }, `${p.id}.${g}y`);
            }
        }
        // 74HC32 / 74LS32 — Quad 2-input OR (same pinout as 74HC00)
        if (p.kind === '74hc32' || p.kind === '74ls32') {
            for (let g = 1; g <= 4; g++) {
                setDriver(find(key(p.id, `${g}y`)), { type: 'or', gate: `${p.id}.${g}`, a: find(key(p.id, `${g}a`)), b: find(key(p.id, `${g}b`)) }, `${p.id}.${g}y`);
            }
        }
        // 74HC244 — Octal buffer (two groups of 4, each with /OE)
        if (p.kind === '74hc244') {
            for (let g = 1; g <= 2; g++) {
                const oeNet = find(key(p.id, `${g}oeb`));
                for (let i = 0; i < 4; i++) {
                    setDriver(find(key(p.id, `${g}y${i}`)), { type: 'buf', a: find(key(p.id, `${g}a${i}`)), oe: oeNet }, `${p.id}.${g}y${i}`);
                }
            }
        }
        // 74HC245 — Octal transceiver (DIR selects A→B or B→A, /OE enables).
        // In address decode, DIR is typically tied HIGH (A→B) or LOW (B→A).
        // We register both output directions; evalNet resolves per DIR.
        if (p.kind === '74hc245') {
            const oeNet = find(key(p.id, 'oeb'));
            const dirNet = find(key(p.id, 'dir'));
            for (let i = 0; i < 8; i++) {
                const aNet = find(key(p.id, `a${i}`));
                const bNet = find(key(p.id, `b${i}`));
                // Only register if the output net isn't already driven by
                // something stronger (e.g. address lines from the CPU).
                if (!netDriver.has(bNet)) setDriver(bNet, { type: 'buf', a: aNet, oe: oeNet }, `${p.id}.b${i}`);
                if (!netDriver.has(aNet)) setDriver(aNet, { type: 'buf', a: bNet, oe: oeNet }, `${p.id}.a${i}`);
            }
        }
    }
    if (reasons.length) return { ok: false, notes, reasons };

    let addr = 0;
    let cycle = { mreqb: 1, iorqb: 1, rdb: 1, wrb: 1 };
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
        } else if (d.type === 'buf') {
            const oe = evalNet(d.oe, depth + 1);
            v = (oe === 0) ? evalNet(d.a, depth + 1) : null;
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
            ioChips.push({ part: p, pins, ioKind: 'acia6850', rsPin: 'rs', dir: 'level', selected: new Uint8Array(256) });
        } else if (p.kind === '74hc374') {
            // Write-only OUT port — PainfulDiodes' first program: the
            // decode glue strobes clk low during the IO write and the
            // '374 latches on the rising edge as the strobe ends; /OE is
            // strapped low, the Q pins face the LEDs, never the bus.
            const pins = [{ net: find(key(p.id, 'clk')), want: 0, t: 'clk' }];
            for (const pin of pins) if (!netDriver.has(pin.net)) reasons.push(`${p.id}.clk is undriven — a floating latch clock is not an OUT port`);
            ioChips.push({ part: p, pins, ioKind: 'latch', rsPin: null, dir: 'write', selected: new Uint8Array(256) });
        } else if (p.kind === 'mc6845') {
            const hasRsWire = wires.some(w =>
                (w.from === p.id && w.fromTerminal === 'rs') ||
                (w.to === p.id && w.toTerminal === 'rs'));
            const rsName = hasRsWire ? 'rs' : 'rsb';
            const pins = [{ net: find(key(p.id, 'csb')), want: 0, t: 'csb' }];
            for (const pin of pins) if (!netDriver.has(pin.net)) reasons.push(`${p.id}.${pin.t} is undriven — a floating chip select is not a decode`);
            ioChips.push({ part: p, pins, ioKind: 'crtc', rsPin: rsName, dir: 'level', selected: new Uint8Array(256) });
        } else if (p.kind === '74hc244') {
            // Read-only IN port — the input mirror of the '374 OUT latch.
            // The decode glue strobes /OE low during the IO read; the
            // buffer's A-inputs face the buttons/DIP switches, the Y
            // outputs face the data bus. Both /OE groups are checked;
            // the first driven one wins (most builds strap both together
            // or use only group 1).
            const oe1Net = find(key(p.id, '1oeb'));
            const oe2Net = find(key(p.id, '2oeb'));
            const oe1Driven = netDriver.has(oe1Net);
            const oe2Driven = netDriver.has(oe2Net);
            if (oe1Driven || oe2Driven) {
                const pins = [];
                if (oe1Driven) pins.push({ net: oe1Net, want: 0, t: '1oeb' });
                if (oe2Driven) pins.push({ net: oe2Net, want: 0, t: '2oeb' });
                ioChips.push({ part: p, pins, ioKind: 'buffer', rsPin: null, dir: 'read', selected: new Uint8Array(256) });
            }
        } else if (p.kind === 'um245r') {
            // The UM245R is a parallel FIFO: its /RD pin IS the decoded
            // port-read strobe, not a traditional chip-select. It has no
            // register select — it is one port, not two.
            const rdNet = find(key(p.id, 'rdb'));
            if (!netDriver.has(rdNet)) reasons.push(`${p.id}.rdb is undriven — a floating read strobe is not a decode`);
            ioChips.push({ part: p, pins: [{ net: rdNet, want: 0, t: 'rdb' }], ioKind: 'um245r', rsPin: null, dir: 'read', selected: new Uint8Array(256) });
        }
    }
    if (!memChips.length && !ioChips.length) reasons.push('no RAM, ROM, ACIA or OUT latch on the board');
    if (reasons.length) return { ok: false, notes, reasons };

    try {
        cycle = { mreqb: 0, iorqb: 1, rdb: 1, wrb: 1 };   // memory cycles (no read/write strobe)
        for (addr = 0; addr < 65536; addr++) {
            memo = new Map();
            for (const c of memChips) c.selected[addr] = evalNet(c.net) === 0 ? 1 : 0;
        }
        // I/O cycles, evaluated per chip DIRECTION: a level-selected chip
        // (ACIA /CS) decodes with both strobes idle; a read-strobed chip
        // (UM245R) under RD low; a write-strobed chip (the OUT latch,
        // whose clk is IORQ|WR glue) under WR low. One shared read cycle
        // hid every write-strobed decode — the latch was 'never selected'.
        const IO_CYCLES = {
            level: { mreqb: 1, iorqb: 0, rdb: 1, wrb: 1 },
            read: { mreqb: 1, iorqb: 0, rdb: 0, wrb: 1 },
            write: { mreqb: 1, iorqb: 0, rdb: 1, wrb: 0 },
        };
        for (const dir of ['level', 'read', 'write']) {
            cycle = IO_CYCLES[dir];
            for (addr = 0; addr < 256; addr++) {
                memo = new Map();
                for (const c of ioChips) {
                    if ((c.dir || 'level') !== dir) continue;
                    let on = 1;
                    for (const pin of c.pins) if (evalNet(pin.net) !== pin.want) { on = 0; break; }
                    c.selected[addr] = on;
                }
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
        if (on.length > 1) {
            // A read-strobed and a write-strobed chip legally share a port
            // (IN and OUT decode to different silicon on real boards). A
            // level-selected chip answers both directions, so it conflicts
            // with anything; same-direction pairs always conflict.
            const dirs = on.map((c) => c.dir || 'level');
            const legal = on.length === 2 && dirs.includes('read') && dirs.includes('write');
            if (!legal) return { ok: false, notes, reasons: [`port-space contention at port ${hx(a)}: ${on.map((c) => c.part.id).join(' and ')}`] };
        }
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
        if (c.rsPin) {
            // Register-select devices (ACIA, CRTC): rs must ride A0
            const rs = netDriver.get(find(key(c.part.id, c.rsPin)));
            if (!rs || rs.type !== 'addr' || rs.bit !== 0) { reasons.push(`${c.part.id}.${c.rsPin} must ride A0 — the register select is the low address line`); continue; }
        }
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
            ...ports.map((p) => {
                const label = p.kind === 'crtc' ? 'MC6845' : p.kind === 'um245r' ? 'UM245R' : p.kind === 'latch' ? '74HC374 OUT latch' : p.kind === 'buffer' ? '74HC244 IN buffer' : 'MC6850';
                return `CHIP ${p.name} = ${label} AT PORT ${hx(p.at)}`;
            }),
        ],
        notes,
        reasons: [],
    };
}

export default extractZ80Machine;
