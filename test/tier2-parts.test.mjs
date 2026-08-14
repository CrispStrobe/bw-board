// Tier-2 glue and input parts, golden-tested through board pins.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerTier2Parts } from '../src/devices/tier2-parts.js';

registerTier2Parts();

function rig(deviceRow, extraNets = []) {
    const board = new BoardImpl(5.0);
    board.setNetlist(deviceRow.parts, deviceRow.nets.concat(extraNets));
    let t = 0n;
    return {
        board,
        tick: (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); },
        out: (p) => { board.setPin(p, 'pushpull', true); },
        hi: (p) => board.setPin(p, 'pushpull', true),
        lo: (p) => board.setPin(p, 'pushpull', false),
        inp: (p) => board.setPin(p, 'input', false),
        rd: (p) => board.readAnalog(p) > 2.5,
    };
}

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('74HC138', () => {
    it('decodes CBA with enables; disable floats nothing, parks all high', () => {
        const r = rig({
            parts: [V, G,
                { id: 'U1', kind: '74hc138', params: {}, terminals: ['vcc', 'gnd', 'a', 'b', 'c', 'g1', 'g2ab', 'g2bb', 'y0b', 'y1b', 'y2b', 'y3b', 'y4b', 'y5b', 'y6b', 'y7b'] },
                { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P2.0', 'P2.5'] }],
            nets: [
                net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
                net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['U1', 'g2ab'], ['U1', 'g2bb']),
                net('na', ['MCU', 'P1.0'], ['U1', 'a']),
                net('nb', ['MCU', 'P1.1'], ['U1', 'b']),
                net('nc', ['MCU', 'P1.2'], ['U1', 'c']),
                net('ne', ['MCU', 'P1.3'], ['U1', 'g1']),
                net('n0', ['MCU', 'P2.0'], ['U1', 'y0b']),
                net('n5', ['MCU', 'P2.5'], ['U1', 'y5b']),
            ],
        });
        r.inp('P2.0'); r.inp('P2.5');
        r.hi('P1.3');                        // G1 enable
        r.hi('P1.0'); r.lo('P1.1'); r.hi('P1.2');   // CBA = 101 → Y5
        r.tick(10);
        assert.equal(r.rd('P2.5'), false, 'selected output low');
        assert.equal(r.rd('P2.0'), true, 'unselected output high');
        r.lo('P1.3');                        // disable
        r.tick(10);
        assert.equal(r.rd('P2.5'), true, 'disabled: everything parks high');
    });
});

describe('74HC245', () => {
    it('A→B follows; direction flip releases and reverses', () => {
        const r = rig({
            parts: [V, G,
                { id: 'U1', kind: '74hc245', params: {}, terminals: ['vcc', 'gnd', 'dir', 'oeb', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] },
                { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P2.0', 'P2.1'] }],
            nets: [
                net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
                net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['U1', 'oeb']),
                net('nd', ['MCU', 'P1.0'], ['U1', 'dir']),
                net('na0', ['MCU', 'P1.1'], ['U1', 'a0']),
                net('na1', ['MCU', 'P1.2'], ['U1', 'a1']),
                net('nb0', ['MCU', 'P2.0'], ['U1', 'b0']),
                net('nb1', ['MCU', 'P2.1'], ['U1', 'b1']),
            ],
        });
        r.hi('P1.0');                        // DIR: A→B
        r.hi('P1.1'); r.lo('P1.2');          // a0=1, a1=0
        r.inp('P2.0'); r.inp('P2.1');
        r.tick(10);
        assert.equal(r.rd('P2.0'), true, 'b0 follows a0');
        assert.equal(r.rd('P2.1'), false, 'b1 follows a1');

        r.lo('P1.0');                        // DIR: B→A
        r.inp('P1.1'); r.inp('P1.2');        // former inputs become readers
        r.lo('P2.0'); r.hi('P2.1');          // drive the B side
        r.tick(10);
        assert.equal(r.rd('P1.1'), false, 'a0 follows b0 after the flip');
        assert.equal(r.rd('P1.2'), true, 'a1 follows b1 after the flip');
    });
});

describe('74HC165', () => {
    it('loads a..h and shifts out H-first with SER refilling', () => {
        // a..h strapped: a,c,e,g to GND; b,d,f,h to VCC → reg 0xAA
        // (bit0=a=0, bit1=b=1 ... bit7=h=1); QH shifts h,g,f,... = 1,0,1,0...
        const r = rig({
            parts: [V, G,
                { id: 'U1', kind: '74hc165', params: {}, terminals: ['vcc', 'gnd', 'shldb', 'clk', 'clkinh', 'ser', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'qh', 'qhb'] },
                { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P2.0'] }],
            nets: [
                net('nv', ['VCC', 'vcc'], ['U1', 'vcc'], ['U1', 'b'], ['U1', 'd'], ['U1', 'f'], ['U1', 'h']),
                net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['U1', 'a'], ['U1', 'c'], ['U1', 'e'], ['U1', 'g'], ['U1', 'clkinh'], ['U1', 'ser']),
                net('nl', ['MCU', 'P1.0'], ['U1', 'shldb']),
                net('nk', ['MCU', 'P1.1'], ['U1', 'clk']),
                net('nq', ['MCU', 'P2.0'], ['U1', 'qh']),
            ],
        });
        r.inp('P2.0');
        r.lo('P1.1');                        // clk idle low
        r.lo('P1.0'); r.tick(5);             // /SH-LD low: load
        r.hi('P1.0'); r.tick(5);
        const bits = [];
        bits.push(r.rd('P2.0') ? 1 : 0);     // QH shows h before any clock
        for (let i = 0; i < 7; i++) {
            r.hi('P1.1'); r.tick(2); r.lo('P1.1'); r.tick(2);
            bits.push(r.rd('P2.0') ? 1 : 0);
        }
        assert.deepEqual(bits, [1, 0, 1, 0, 1, 0, 1, 0], 'h,g,f,e,d,c,b,a');
        // One more clock: SER (grounded) has arrived at... bit 0 side; QH
        // now shifts out what SER fed seven clocks ago — still 0.
        r.hi('P1.1'); r.tick(2); r.lo('P1.1'); r.tick(2);
        assert.equal(r.rd('P2.0'), false, 'SER zeros follow the payload');
    });
});

describe('KY-040', () => {
    it('two CW detents play the full quadrature sequence; switch pulls low', () => {
        const parts = [V, G,
            { id: 'ENC', kind: 'ky040', params: { position: 0, stepUs: 100 }, terminals: ['vcc', 'gnd', 'clk', 'dt', 'sw'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] }];
        const r = rig({
            parts,
            nets: [
                net('nv', ['VCC', 'vcc'], ['ENC', 'vcc']),
                net('ng', ['GND', 'gnd'], ['ENC', 'gnd']),
                net('nc', ['MCU', 'P1.0'], ['ENC', 'clk']),
                net('nd', ['MCU', 'P1.1'], ['ENC', 'dt']),
                net('ns', ['MCU', 'P1.2'], ['ENC', 'sw']),
            ],
        });
        r.inp('P1.0'); r.inp('P1.1'); r.inp('P1.2');
        r.tick(10);
        assert.equal(r.rd('P1.0'), true, 'CLK idles high at a detent');
        assert.equal(r.rd('P1.2'), true, 'switch open, pulled up');

        // The classic decoder: on CLK falling edge, DT high means CW.
        parts[2].params.position = 2;
        r.board.setControl('ENC', 2);
        let cw = 0, ccw = 0, lastClk = true;
        for (let i = 0; i < 120; i++) {
            r.tick(60);
            const clk = r.rd('P1.0');
            if (!clk && lastClk) { if (r.rd('P1.1')) cw++; else ccw++; }
            lastClk = clk;
        }
        assert.equal(cw, 2, 'two CW detents, two decodable falling edges');
        assert.equal(ccw, 0);

        // Back one detent: the mirrored sequence decodes CCW.
        parts[2].params.position = 1;
        r.board.setControl('ENC', 1);
        cw = 0; ccw = 0; lastClk = r.rd('P1.0');
        for (let i = 0; i < 80; i++) {
            r.tick(60);
            const clk = r.rd('P1.0');
            if (!clk && lastClk) { if (r.rd('P1.1')) cw++; else ccw++; }
            lastClk = clk;
        }
        assert.equal(ccw, 1, 'one CCW detent');
        assert.equal(cw, 0);

        parts[2].params.pressed = true;
        r.board.setControl('ENC', 1);
        assert.equal(r.rd('P1.2'), false, 'pressed switch pulls SW low');
    });
});
