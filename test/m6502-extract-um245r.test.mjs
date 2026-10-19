// The UM245R USB FIFO through the drawn decode — directional strobes,
// the second thing the rwb axis makes expressible. One address serves
// both directions: /RD = ~(sel·RWB) puts the FIFO on the bus during
// reads of the window, WR = sel·~RWB clocks a byte in during writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

function circuitWithFifo({ gateRdWithRwb = true } = {}) {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'usb1', kind: 'um245r' },
        { id: 'glue1', kind: '74hc00' },
        { id: 'glue2', kind: '74hc00' },
        { id: 'glue3', kind: '74hc00' },
    ];
    const wires = [];
    const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
    for (let i = 0; i <= 14; i++) {
        w('cpu1', `a${i}`, 'ram1', `a${i}`);
        w('cpu1', `a${i}`, 'rom1', `a${i}`);
    }
    // Base decode: RAM $0000-$3FFF, ROM $8000-$FFFF; sel high $4000-$5FFF.
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'glue2', '1a'); w('glue1', '4y', 'glue2', '1b');
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');
    w('glue2', '3y', 'glue2', '4a'); w('glue2', '3y', 'glue2', '4b'); // sel = g2.4y
    // /RD = NAND(sel, RWB): low exactly on reads of the window.
    if (gateRdWithRwb) {
        w('glue2', '4y', 'glue3', '1a'); w('cpu1', 'rwb', 'glue3', '1b');
    } else {
        // Mis-wiring: /RD from the select alone — active on writes too.
        w('glue2', '4y', 'glue3', '1a'); w('glue2', '4y', 'glue3', '1b');
    }
    w('glue3', '1y', 'usb1', 'rdb');
    // WR = sel·~RWB: g2 = ~RWB, g3 = NAND(sel, ~RWB), g4 = ~g3.
    w('cpu1', 'rwb', 'glue3', '2a'); w('cpu1', 'rwb', 'glue3', '2b');
    w('glue2', '4y', 'glue3', '3a'); w('glue3', '2y', 'glue3', '3b');
    w('glue3', '3y', 'glue3', '4a'); w('glue3', '3y', 'glue3', '4b');
    w('glue3', '4y', 'usb1', 'wr');
    return { parts, wires };
}

test('the FIFO decode classifies: one window, both directions, machine round-trip', () => {
    const r = extract6502Machine(circuitWithFifo());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.chips.find((c) => c.name === 'usb1'),
        { kind: 'um245r', name: 'usb1', at: 0x4000, span: 0x2000 });
    assert.ok(r.lines.includes('CHIP usb1 = UM245R AT $4000'),
        `expected the UM245R CHIP line, got: ${JSON.stringify(r.lines)}`);

    const sent = [];
    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips },
        { onSerial: (b) => sent.push(b) });
    m._write(0x4000, 0x55);
    assert.deepEqual(sent, [0x55], 'a write leaves through onSerial');
    assert.equal(m._read(0x4000), 0xff, 'empty FIFO reads open-bus high');
    m.chips.usb1.rxPush(0x42);
    assert.equal(m._read(0x4000), 0x42, 'a queued byte comes off the FIFO');
    assert.equal(m._read(0x4000), 0xff, 'and only once');
});

test('/RD without RWB gating refuses with the address and the fix named', () => {
    const r = extract6502Machine(circuitWithFifo({ gateRdWithRwb: false }));
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'),
        /usb1: \/RD is active during a CPU write cycle at \$4000 — gate \/RD with RWB/);
});
