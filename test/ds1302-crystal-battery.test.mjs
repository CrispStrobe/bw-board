// DS1302 X1, X2 and VCC1 — the three legs of the DIP-8 the model did not
// have, so bw-parts' eight-pin sidecar named pins nothing could reach.
//
// They are not another packaging of the same part, the way a stepper's
// wiring or a gas sensor's carrier are. They are behaviour nobody had
// written: X1/X2 are the 32.768 kHz crystal that makes the clock advance
// at all, and VCC1 is the coin cell that makes it survive a power cut.
// Both are the first thing that goes wrong on a real bench — a DS1302
// with no crystal is silent in exactly the way a halted one is, and a
// DS1302 with no cell forgets the time every time the board is switched
// off.
//
// STATED DIVERGENCE, on the crystal: quartz has no DC signature — the
// engine's own `crystal` model is two pins with nothing between them — so
// the oscillator is decided by WIRING, via ctx.netFor, and any two-terminal
// part bridging X1 and X2 satisfies it. The model does not check that the
// thing fitted resonates at 32.768 kHz, and could not.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const RTC_PINS = ['vcc', 'gnd', 'ce', 'sclk', 'io', 'x1', 'x2', 'vcc1'];

/**
 * A DS1302 bit-banged from MCU pins, with the two things under test made
 * options: how X1/X2 are wired, and what sits on VCC1.
 *
 * VCC2 comes from an MCU pin rather than the rail so it can be cut without
 * taking the rest of the bench down with it — which is the whole experiment.
 *
 * @param {'fitted'|'none'|'half'|'shorted'} crystal
 * @param {number|null} batteryVolts — a cell on VCC1, or null for no cell
 */
function rtcBoard({ crystal = 'fitted', batteryVolts = null } = {}) {
    const parts = [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U1', kind: 'ds1302', params: {}, terminals: RTC_PINS },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
    ];
    const nets = [
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nvcc2', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'nce', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'ce' }] },
        { id: 'nck', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'sclk' }] },
        { id: 'nio', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'io' }] },
    ];

    if (crystal === 'fitted' || crystal === 'shorted') {
        parts.push({ id: 'Y1', kind: 'crystal', params: {}, terminals: ['a', 'b'] });
    }
    if (crystal === 'fitted') {
        nets.push({ id: 'nx1', terminals: [{ part: 'U1', terminal: 'x1' }, { part: 'Y1', terminal: 'a' }] });
        nets.push({ id: 'nx2', terminals: [{ part: 'U1', terminal: 'x2' }, { part: 'Y1', terminal: 'b' }] });
    } else if (crystal === 'shorted') {
        // Both legs on ONE net: a solder bridge across the crystal, which
        // kills the oscillator on a real board.
        nets.push({ id: 'nx', terminals: [
            { part: 'U1', terminal: 'x1' }, { part: 'U1', terminal: 'x2' },
            { part: 'Y1', terminal: 'a' }, { part: 'Y1', terminal: 'b' }] });
    } else if (crystal === 'half') {
        // One leg wired, the other in the air — the classic missed pin.
        nets.push({ id: 'nx1', terminals: [{ part: 'U1', terminal: 'x1' }, { part: 'GND', terminal: 'gnd' }] });
    }
    // 'none': X1 and X2 are named by the part and wired to nothing.

    if (batteryVolts !== null) {
        parts.push({ id: 'BAT', kind: 'battery', params: { volts: batteryVolts }, terminals: ['pos', 'neg'] });
        nets.push({ id: 'nbat', terminals: [{ part: 'BAT', terminal: 'pos' }, { part: 'U1', terminal: 'vcc1' }] });
        nets[0].terminals.push({ part: 'BAT', terminal: 'neg' });
    }

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    let t = 0n;
    const tick = (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); };
    const pin = (p, high) => { board.setPin(p, 'pushpull', high); tick(2); };
    const release = (p) => { board.setPin(p, 'input', false); tick(2); };

    board.setPin('P1.3', 'pushpull', true);      // VCC2 up
    tick(10);

    const writeByte = (b) => {
        for (let i = 0; i < 8; i++) {
            pin('P1.2', !!((b >> i) & 1));
            pin('P1.1', true);
            pin('P1.1', false);
        }
    };
    const readByte = () => {
        release('P1.2');
        let v = 0;
        for (let i = 0; i < 8; i++) {
            if (i > 0) { pin('P1.1', true); pin('P1.1', false); }
            if (board.readAnalog('P1.2') > 2.5) v |= 1 << i;
        }
        return v;
    };
    const cmd = (c) => { pin('P1.1', false); pin('P1.0', true); writeByte(c); };
    const end = () => { pin('P1.0', false); };

    return {
        board, tick,
        writeReg: (addr, val) => { cmd(0x80 | (addr << 1)); writeByte(val); end(); },
        readReg: (addr) => { cmd(0x81 | (addr << 1)); const v = readByte(); end(); return v; },
        writeRam: (i, val) => { cmd(0xc0 | (i << 1)); writeByte(val); end(); },
        readRam: (i) => { cmd(0xc1 | (i << 1)); const v = readByte(); end(); return v; },
        /** Cut or restore VCC2, the way a bench power switch does. */
        vcc2: (on) => { board.setPin('P1.3', 'pushpull', on); tick(100); },
        /** Start the clock at 00 seconds, CH clear. */
        start() { this.writeReg(0, 0x00); },
    };
}

describe('DS1302 crystal (X1/X2)', () => {
    it('with a crystal fitted, the clock counts', () => {
        const r = rtcBoard({ crystal: 'fitted' });
        r.start();
        r.tick(3_000_000);
        assert.equal(r.readReg(0), 0x03, 'three seconds, BCD');
    });

    it('with X1 and X2 wired to NOTHING, the clock still counts — legacy benches', () => {
        // Backwards compatibility asserted rather than hoped: every bench
        // written before these pins existed wires five legs and must keep
        // working. A part that names no crystal net is not modelling the
        // crystal, which is different from modelling a missing one.
        const r = rtcBoard({ crystal: 'none' });
        r.start();
        r.tick(3_000_000);
        assert.equal(r.readReg(0), 0x03);
    });

    it('one crystal leg wired and the other in the air: no oscillator, no time', () => {
        // The failure the pins exist to catch. Note what it looks like from
        // the bus: CH is CLEAR and the seconds still do not move, so it is
        // NOT the halt trap — a program that correctly cleared CH sees a
        // dead clock and has nothing on the wire to tell it why.
        const r = rtcBoard({ crystal: 'half' });
        r.start();
        assert.equal(r.readReg(0) & 0x80, 0, 'CH is clear — the part was told to run');
        r.tick(3_000_000);
        assert.equal(r.readReg(0) & 0x7f, 0x00, 'and it counted nothing anyway');
    });

    it('a solder bridge across the crystal kills it too', () => {
        const r = rtcBoard({ crystal: 'shorted' });
        r.start();
        r.tick(3_000_000);
        assert.equal(r.readReg(0) & 0x7f, 0x00, 'shorted quartz cannot resonate');
    });

    it('the bus still works with a dead oscillator — only TIME stops', () => {
        // A crystal fault must not look like a dead chip: RAM, write-protect
        // and register reads all answer normally. Conflating the two would
        // send someone chasing the wiring of the 3-wire bus instead.
        const r = rtcBoard({ crystal: 'half' });
        r.writeRam(3, 0xa5);
        assert.equal(r.readRam(3), 0xa5, 'RAM is unaffected by the oscillator');
    });
});

describe('DS1302 battery rail (VCC1)', () => {
    it('a cell on VCC1 keeps the clock running across a power cut', () => {
        const r = rtcBoard({ batteryVolts: 3.0 });
        r.start();
        r.tick(2_000_000);
        assert.equal(r.readReg(0), 0x02, 'two seconds before the cut');

        r.vcc2(false);
        r.tick(5_000_000);            // five seconds in the dark
        r.vcc2(true);

        const sec = r.readReg(0);
        assert.equal(sec & 0x80, 0, 'CH is still clear — it never halted');
        assert.ok(sec >= 0x07, `the cell kept it counting, got 0x${sec.toString(16)}`);
    });

    it('a cell keeps the RAM too', () => {
        const r = rtcBoard({ batteryVolts: 3.0 });
        r.writeRam(5, 0x5a);
        r.vcc2(false);
        r.tick(1_000_000);
        r.vcc2(true);
        assert.equal(r.readRam(5), 0x5a, 'battery-backed RAM survives');
    });

    it('with NO cell, a power cut loses the time — the halt flag comes back set', () => {
        // The contrast that a VCC1-ignoring model cannot produce: same cut,
        // same duration, opposite outcome. Without this the pin could be
        // wired and make no difference, which is how it became unreachable
        // in the first place.
        const r = rtcBoard({ batteryVolts: null });
        r.start();
        r.tick(2_000_000);
        assert.equal(r.readReg(0), 0x02, 'two seconds before the cut');

        r.vcc2(false);
        r.tick(5_000_000);
        r.vcc2(true);

        const sec = r.readReg(0);
        assert.equal(sec & 0x80, 0x80, 'back at the power-up state: halted');
        assert.equal(sec & 0x7f, 0x00, 'and back at zero seconds');
    });

    it('with no cell, RAM is lost as well', () => {
        const r = rtcBoard({ batteryVolts: null });
        r.writeRam(5, 0x5a);
        assert.equal(r.readRam(5), 0x5a, 'written while powered');
        r.vcc2(false);
        r.tick(1_000_000);
        r.vcc2(true);
        assert.equal(r.readRam(5), 0x00, 'unbacked RAM does not survive');
    });

    it('a flat cell is no cell', () => {
        // 1.5 V is below the datasheet's 2.0 V timekeeping minimum, so a
        // half-dead coin cell buys nothing — which is the bench symptom of
        // "it kept time for a year and then stopped".
        const r = rtcBoard({ batteryVolts: 1.5 });
        r.start();
        r.tick(2_000_000);
        r.vcc2(false);
        r.tick(5_000_000);
        r.vcc2(true);
        assert.equal(r.readReg(0) & 0x80, 0x80, 'flat cell: the clock still died');
    });
});
