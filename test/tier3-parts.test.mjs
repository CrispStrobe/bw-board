// Tier-3 glue, measured through board pins.
//
// Every assertion here is a VOLTAGE or a bit read back out of the solver.
// "The kind is registered" is not a test — the whole point of the inert-part
// audit is that 178 parts were registered-looking and electrically dead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

function rig(parts, nets) {
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    let t = 0n;
    return {
        board,
        tick: (us = 10) => { t += BigInt(us) * 1000n; board.advanceTo(t); },
        hi: (p) => board.setPin(p, 'pushpull', true),
        lo: (p) => board.setPin(p, 'pushpull', false),
        inp: (p) => board.setPin(p, 'input', false),
        v: (netId) => board.nodeVoltage(netId),
        rd: (p) => board.readAnalog(p) > 2.5,
    };
}

// ─── 74HC595 ────────────────────────────────────────────────────────────

/** Build a '595 bench in whichever namespace, with pull-downs on two outs. */
function bench595(names) {
    const { ser, srclk, rclk, oe, outA, outB } = names;
    const terminals = ['vcc', 'gnd', ser, srclk, rclk, oe, outA, outB];
    return rig([
        V, G,
        { id: 'U1', kind: '74hc595', params: {}, terminals },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P2.0', 'P2.1'] },
        // Pull-downs: without a DC path a tri-stated output has no defined
        // node voltage, so "high-Z" would be indistinguishable from LOW.
        { id: 'RA', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
        { id: 'RB', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
    ], [
        net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['RA', 'b'], ['RB', 'b']),
        net('nser', ['MCU', 'P1.0'], ['U1', ser]),
        net('nclk', ['MCU', 'P1.1'], ['U1', srclk]),
        net('nrck', ['MCU', 'P1.2'], ['U1', rclk]),
        net('noe', ['MCU', 'P1.3'], ['U1', oe]),
        net('noutA', ['U1', outA], ['RA', 'a'], ['MCU', 'P2.0']),
        net('noutB', ['U1', outB], ['RB', 'a'], ['MCU', 'P2.1']),
    ]);
}

/** Clock one bit in, MSB-of-the-byte first (SER shifts in at QA). */
function shiftIn(r, bits) {
    for (const b of bits) {
        b ? r.hi('P1.0') : r.lo('P1.0');
        r.lo('P1.1'); r.tick();
        r.hi('P1.1'); r.tick();      // rising SRCLK
    }
}
function latch(r) { r.lo('P1.2'); r.tick(); r.hi('P1.2'); r.tick(); }

describe('74HC595', () => {
    it('datasheet namespace: SER/SRCLK/RCLK shift and latch onto QA..QH', () => {
        // QA is bit 0, QH is bit 7, and the FIRST bit clocked in walks all
        // the way to QH — the built-in shift_register's mapping exactly.
        const r = bench595({ ser: 'ser', srclk: 'srclk', rclk: 'rclk', oe: 'oe', outA: 'qa', outB: 'qh' });
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.3');                       // /OE low = outputs enabled
        shiftIn(r, [1, 0, 0, 0, 0, 0, 0, 1]);  // first bit -> QH, last -> QA
        latch(r);
        assert.ok(r.v('noutA') > 4.0, `QA high (got ${r.v('noutA')})`);
        assert.ok(r.v('noutB') > 4.0, `QH high (got ${r.v('noutB')})`);

        shiftIn(r, [0, 0, 0, 0, 0, 0, 0, 0]);
        latch(r);
        assert.ok(r.v('noutA') < 1.0, 'QA cleared after eight zeros');
        assert.ok(r.v('noutB') < 1.0, 'QH cleared after eight zeros');
    });

    it('abstract namespace: data/clock/latch drive UPPERCASE Q0..Q7', () => {
        // This is the spelling 08-led-chaser-595 actually uses. It was
        // reachable only through the examples-gate KIND_ALIASES rename
        // before this model existed.
        const r = bench595({ ser: 'data', srclk: 'clock', rclk: 'latch', oe: 'oe', outA: 'Q0', outB: 'Q7' });
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.3');
        shiftIn(r, [1, 0, 0, 0, 0, 0, 0, 0]);   // first bit walks to Q7
        latch(r);
        assert.ok(r.v('noutB') > 4.0, `Q7 high (got ${r.v('noutB')})`);
        assert.ok(r.v('noutA') < 1.0, `Q0 low (got ${r.v('noutA')})`);
    });

    it('the two namespaces address ONE register, not two', () => {
        // Clock in through the datasheet pins, read out through the
        // abstract ones. If the aliases were separate state this fails.
        const r = bench595({ ser: 'ser', srclk: 'srclk', rclk: 'rclk', oe: 'oe', outA: 'q7', outB: 'qh' });
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.3');
        shiftIn(r, [1, 0, 0, 0, 0, 0, 0, 0]);
        latch(r);
        assert.ok(r.v('noutA') > 4.0, 'q7 (abstract) high');
        assert.ok(r.v('noutB') > 4.0, 'qh (datasheet) high — same bit');
    });

    it('/OE HIGH tri-states the outputs; the pull-down then wins', () => {
        const r = bench595({ ser: 'ser', srclk: 'srclk', rclk: 'rclk', oe: 'oe', outA: 'qa', outB: 'qh' });
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.3');
        shiftIn(r, [1, 1, 1, 1, 1, 1, 1, 1]);
        latch(r);
        assert.ok(r.v('noutA') > 4.0, 'enabled: QA drives high');

        r.hi('P1.3');                       // /OE high = disabled
        r.tick();
        assert.ok(r.v('noutA') < 1.0, `disabled: QA released to the pull-down (got ${r.v('noutA')})`);

        r.lo('P1.3');                       // re-enable: the latch survived
        r.tick();
        assert.ok(r.v('noutA') > 4.0, 're-enabled: the stored bit is still there');
    });

    it("QH' carries the SHIFT register and is NOT gated by /OE", () => {
        // The cascade tap. Without it a 16-bit two-chip chain cannot be
        // expressed at all, which is one reason this is not an alias of
        // the built-in shift_register.
        const r = rig([
            V, G,
            { id: 'U1', kind: '74hc595', params: {}, terminals: ['vcc', 'gnd', 'ser', 'srclk', 'rclk', 'oe', 'qh_s'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P2.0'] },
            { id: 'RA', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['RA', 'b']),
            net('nser', ['MCU', 'P1.0'], ['U1', 'ser']),
            net('nclk', ['MCU', 'P1.1'], ['U1', 'srclk']),
            net('nrck', ['MCU', 'P1.2'], ['U1', 'rclk']),
            net('noe', ['MCU', 'P1.3'], ['U1', 'oe']),
            net('noutA', ['U1', 'qh_s'], ['RA', 'a'], ['MCU', 'P2.0']),
        ]);
        r.inp('P2.0');
        r.hi('P1.3');                       // /OE HIGH — QA..QH are off
        shiftIn(r, [1, 0, 0, 0, 0, 0, 0, 0]);   // no RCLK: nothing latched
        assert.ok(r.v('noutA') > 4.0, `QH' follows the shift register with /OE high (got ${r.v('noutA')})`);
    });

    it('/SRCLR clears the shift register — and only when the pin is wired', () => {
        const r = rig([
            V, G,
            { id: 'U1', kind: '74hc595', params: {}, terminals: ['vcc', 'gnd', 'ser', 'srclk', 'rclk', 'oe', 'srclr', 'qh'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P2.0'] },
            { id: 'RA', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['RA', 'b']),
            net('nser', ['MCU', 'P1.0'], ['U1', 'ser']),
            net('nclk', ['MCU', 'P1.1'], ['U1', 'srclk']),
            net('nrck', ['MCU', 'P1.2'], ['U1', 'rclk']),
            net('noe', ['MCU', 'P1.3'], ['U1', 'oe']),
            net('nclr', ['MCU', 'P1.4'], ['U1', 'srclr']),
            net('nout', ['U1', 'qh'], ['RA', 'a'], ['MCU', 'P2.0']),
        ]);
        r.inp('P2.0');
        r.lo('P1.3');
        r.hi('P1.4');                       // /SRCLR released
        shiftIn(r, [1, 0, 0, 0, 0, 0, 0, 0]);
        latch(r);
        assert.ok(r.v('nout') > 4.0, 'QH high before the clear');

        r.lo('P1.4'); r.tick();             // /SRCLR asserted
        latch(r);                           // latch the cleared shift reg
        assert.ok(r.v('nout') < 1.0, `QH cleared by /SRCLR (got ${r.v('nout')})`);
    });

    it('an UNWIRED /SRCLR does not hold the register cleared', () => {
        // The trap this model has to survive: /SRCLR is active LOW and an
        // unwired terminal reads 0 V, so a naive read would clear forever
        // and every abstract-namespace bench (which has no srclr wire)
        // would shift nothing but zeros.
        const r = bench595({ ser: 'data', srclk: 'clock', rclk: 'latch', oe: 'oe', outA: 'Q0', outB: 'Q7' });
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.3');
        shiftIn(r, [0, 0, 0, 0, 0, 0, 0, 1]);
        latch(r);
        assert.ok(r.v('noutA') > 4.0, `Q0 high with no srclr pin present (got ${r.v('noutA')})`);
    });
});

// ─── 74HC125 ────────────────────────────────────────────────────────────

describe('74HC125', () => {
    it('each gate passes A→Y when its own /OE is low, and floats when high', () => {
        const r = rig([
            V, G,
            {
                id: 'U1', kind: '74hc125', params: {},
                terminals: ['vcc', 'gnd', '1oeb', '1a', '1y', '2oeb', '2a', '2y'],
            },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P2.0', 'P2.1'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
            { id: 'R2', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['R1', 'b'], ['R2', 'b']),
            net('n1oe', ['MCU', 'P1.0'], ['U1', '1oeb']),
            net('n1a', ['MCU', 'P1.1'], ['U1', '1a']),
            net('n2oe', ['MCU', 'P1.2'], ['U1', '2oeb']),
            net('n2a', ['MCU', 'P1.3'], ['U1', '2a']),
            net('n1y', ['U1', '1y'], ['R1', 'a'], ['MCU', 'P2.0']),
            net('n2y', ['U1', '2y'], ['R2', 'a'], ['MCU', 'P2.1']),
        ]);
        r.inp('P2.0'); r.inp('P2.1');
        r.lo('P1.0'); r.hi('P1.1');         // gate 1 enabled, A high
        r.hi('P1.2'); r.hi('P1.3');         // gate 2 DISABLED, A high
        r.tick();
        assert.ok(r.v('n1y') > 4.0, `enabled gate follows A (got ${r.v('n1y')})`);
        assert.ok(r.v('n2y') < 1.0, `disabled gate floats to the pull-down (got ${r.v('n2y')})`);

        r.lo('P1.1');                       // gate 1 A low
        r.lo('P1.2');                       // gate 2 enabled
        r.tick();
        assert.ok(r.v('n1y') < 1.0, 'enabled gate follows A low');
        assert.ok(r.v('n2y') > 4.0, 'newly enabled gate drives A high');
    });
});

// ─── 74HC34 / 74HC4050 ──────────────────────────────────────────────────

describe('hex non-inverting buffers', () => {
    for (const kind of ['74hc34', '74hc4050']) {
        it(`${kind}: Y follows A on independent channels, no enable pin`, () => {
            const r = rig([
                V, G,
                { id: 'U1', kind, params: {}, terminals: ['vcc', 'gnd', '1a', '1y', '6a', '6y'] },
                { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P2.0', 'P2.1'] },
            ], [
                net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
                net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
                net('n1a', ['MCU', 'P1.0'], ['U1', '1a']),
                net('n6a', ['MCU', 'P1.1'], ['U1', '6a']),
                net('n1y', ['U1', '1y'], ['MCU', 'P2.0']),
                net('n6y', ['U1', '6y'], ['MCU', 'P2.1']),
            ]);
            r.inp('P2.0'); r.inp('P2.1');
            r.hi('P1.0'); r.lo('P1.1');
            r.tick();
            assert.ok(r.v('n1y') > 4.0, `1Y follows 1A high (got ${r.v('n1y')})`);
            assert.ok(r.v('n6y') < 1.0, `6Y follows 6A low (got ${r.v('n6y')})`);

            r.lo('P1.0'); r.hi('P1.1');
            r.tick();
            assert.ok(r.v('n1y') < 1.0, '1Y follows 1A low');
            assert.ok(r.v('n6y') > 4.0, '6Y follows 6A high');
        });
    }

    it('74HC4050 outputs at ITS OWN Vcc — the level-shift is the function', () => {
        // 5 V logic in, a 3.3 V-powered '4050, 3.3 V out. A model that
        // echoed the input voltage would be modelling a piece of wire and
        // would defeat the only reason this chip is on those 23 boards.
        const r = rig([
            { id: 'V33', kind: 'vcc', params: { volts: 3.3 }, terminals: ['vcc'] },
            G,
            { id: 'V5', kind: 'vcc', params: { volts: 5.0 }, terminals: ['vcc'] },
            { id: 'U1', kind: '74hc4050', params: {}, terminals: ['vcc', 'gnd', '1a', '1y'] },
        ], [
            net('nv', ['V33', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('n1a', ['V5', 'vcc'], ['U1', '1a']),
            net('n1y', ['U1', '1y']),
        ]);
        r.tick();
        const y = r.v('n1y');
        assert.ok(Math.abs(y - 3.3) < 0.3, `output sits at the chip's own 3.3 V rail, got ${y}`);
        assert.ok(y < 4.0, 'and emphatically not at the 5 V input level');
    });
});
