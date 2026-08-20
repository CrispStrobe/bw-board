// 62256 SRAM and 28C256 EEPROM, measured on the data bus.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

const ADDR_LO = ['a0', 'a1', 'a2'];   // only the low three are wired in these benches
const DATA = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];

/**
 * A memory with A0-A2, D0-D7, and the three control pins on MCU pins.
 * Unwired address lines read 0 V = LOW, so the bench addresses 0..7.
 */
function memRig(kind, sel, params = {}) {
    const mcuPins = [
        'PA0', 'PA1', 'PA2',                       // address
        'PS', 'PO', 'PW',                          // /CS(/CE), /OE, /WE
        'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
    ];
    const parts = [
        V, G,
        { id: 'U1', kind, params, terminals: ['vcc', 'gnd', sel, 'oeb', 'web', ...ADDR_LO, ...DATA] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuPins },
    ];
    const nets = [
        net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        net('nsel', ['MCU', 'PS'], ['U1', sel]),
        net('noe', ['MCU', 'PO'], ['U1', 'oeb']),
        net('nwe', ['MCU', 'PW'], ['U1', 'web']),
    ];
    ADDR_LO.forEach((a, i) => nets.push(net(`na${i}`, ['MCU', `PA${i}`], ['U1', a])));
    DATA.forEach((d, i) => nets.push(net(`nd${i}`, ['MCU', `PD${i}`], ['U1', d])));

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    let t = 0n;
    const tick = () => { t += 10_000n; board.advanceTo(t); };
    const set = (p, v) => board.setPin(p, 'pushpull', !!v);
    return {
        board, tick,
        addr(a) { for (let i = 0; i < 3; i++) set(`PA${i}`, (a >> i) & 1); },
        /** Park the bus: everything deselected, CPU not driving. */
        idle() {
            set('PS', 1); set('PO', 1); set('PW', 1);
            for (let i = 0; i < 8; i++) board.setPin(`PD${i}`, 'input', false);
            tick();
        },
        write(a, byte) {
            this.addr(a);
            for (let i = 0; i < 8; i++) set(`PD${i}`, (byte >> i) & 1);
            set('PO', 1);
            set('PS', 0); set('PW', 0);       // select + /WE low
            tick(); tick();                   // turnaround pass, then sample
            set('PW', 1); set('PS', 1);
            tick();
        },
        read(a) {
            this.addr(a);
            for (let i = 0; i < 8; i++) board.setPin(`PD${i}`, 'input', false);
            set('PW', 1);
            set('PS', 0); set('PO', 0);       // select + /OE low
            tick(); tick();
            let byte = 0;
            for (let i = 0; i < 8; i++) if (board.nodeVoltage(`nd${i}`) > 2.5) byte |= 1 << i;
            set('PS', 1); set('PO', 1);
            return byte;
        },
        busVolts: (i) => board.nodeVoltage(`nd${i}`),
    };
}

describe('62256 SRAM', () => {
    it('a byte written is the byte read back, at the right address', () => {
        const r = memRig('62256', 'csb');
        r.idle();
        r.write(5, 0xa5);
        r.write(2, 0x3c);
        assert.equal(r.read(5), 0xa5, 'address 5 holds 0xA5');
        assert.equal(r.read(2), 0x3c, 'address 2 holds 0x3C');
        assert.equal(r.read(1), 0x00, 'an untouched cell is still the power-on fill');
    });

    it('address lines actually select: the same data at two addresses does not alias', () => {
        const r = memRig('62256', 'csb');
        r.idle();
        for (let a = 0; a < 8; a++) r.write(a, a * 17 & 0xff);
        for (let a = 0; a < 8; a++) {
            assert.equal(r.read(a), a * 17 & 0xff, `address ${a} keeps its own byte`);
        }
    });

    it('deselected, the chip releases the bus — it does not drive a stale byte', () => {
        const r = memRig('62256', 'csb');
        r.idle();
        r.write(3, 0xff);
        assert.equal(r.read(3), 0xff, 'drives 0xFF while selected');
        r.idle();
        // /CS high: every data line must be released. With nothing else
        // driving, a released net sits at 0 V; a chip still driving 0xFF
        // would hold them all at 5 V.
        for (let i = 0; i < 8; i++) {
            assert.ok(r.busVolts(i) < 1.0,
                `d${i} released when deselected (got ${r.busVolts(i)})`);
        }
    });

    it('/OE high means no read even while selected', () => {
        const r = memRig('62256', 'csb');
        r.idle();
        r.write(7, 0xff);
        r.addr(7);
        for (let i = 0; i < 8; i++) r.board.setPin(`PD${i}`, 'input', false);
        r.board.setPin('PW', 'pushpull', true);
        r.board.setPin('PS', 'pushpull', false);   // selected
        r.board.setPin('PO', 'pushpull', true);    // but /OE HIGH
        r.tick(); r.tick();
        for (let i = 0; i < 8; i++) {
            assert.ok(r.busVolts(i) < 1.0, `d${i} stays off the bus with /OE high`);
        }
    });

    it('/CS high keeps it off the bus even with /OE LOW', () => {
        // The isolating test for chip-select. The "deselected releases the
        // bus" case above drives /OE high too, so a model that ignored /CS
        // entirely still passed it — caught by mutation, not by reading.
        // Here /OE is asserted and only /CS says no.
        const r = memRig('62256', 'csb');
        r.idle();
        r.write(0, 0xff);
        r.addr(0);
        for (let i = 0; i < 8; i++) r.board.setPin(`PD${i}`, 'input', false);
        r.board.setPin('PW', 'pushpull', true);
        r.board.setPin('PO', 'pushpull', false);   // /OE LOW — read asked for
        r.board.setPin('PS', 'pushpull', true);    // /CS HIGH — but not of us
        r.tick(); r.tick();
        for (let i = 0; i < 8; i++) {
            assert.ok(r.busVolts(i) < 1.0,
                `d${i} silent while deselected (got ${r.busVolts(i)})`);
        }
        r.board.setPin('PS', 'pushpull', false);   // now select it
        r.tick(); r.tick();
        assert.ok(r.busVolts(0) > 4.0, 'and it answers as soon as /CS goes low');
    });

    it('params.contents preloads the array at address 0', () => {
        const r = memRig('62256', 'csb', { contents: [0x11, 0x22, 0x33] });
        r.idle();
        assert.equal(r.read(0), 0x11);
        assert.equal(r.read(1), 0x22);
        assert.equal(r.read(2), 0x33);
        assert.equal(r.read(3), 0x00, 'past the preload, the power-on fill');
    });
});

describe('the undriven-bus trap', () => {
    it('a memory whose control pins are never driven does not eat its own contents', () => {
        // /CS, /OE and /WE are all active LOW and an unwired terminal
        // reads 0 V, so a chip on a bench nobody has driven yet looks
        // SELECTED with /WE ASSERTED. Before writes were edge-committed
        // this really happened: contents[0] came back 0x00 while [1] and
        // [2] survived, because exactly one phantom write ran at power-on
        // against address 0.
        const board = new BoardImpl(5.0);
        board.setNetlist([
            V, G,
            {
                id: 'U1', kind: '62256', params: { contents: [0x11, 0x22, 0x33] },
                terminals: ['vcc', 'gnd', 'csb', 'oeb', 'web', 'a0', ...DATA],
            },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        ]);
        board.advanceTo(50_000n);
        const mem = board.getDeviceState('U1').mem;
        assert.equal(mem[0], 0x11, 'address 0 survives an undriven bus');
        assert.equal(mem[1], 0x22);
        assert.equal(mem[2], 0x33);
    });
});

describe('28C256 EEPROM', () => {
    it('an unprogrammed part reads 0xFF, not 0x00 — erased floating gates', () => {
        // The one place the two chips genuinely differ at power-on. An
        // SRAM comes up indeterminate (we choose 0x00); an erased EEPROM
        // really does read all ones.
        const rom = memRig('28c256', 'ceb');
        rom.idle();
        assert.equal(rom.read(4), 0xff, 'EEPROM erased state');

        const ram = memRig('62256', 'csb');
        ram.idle();
        assert.equal(ram.read(4), 0x00, 'SRAM power-on fill');
    });

    it('reads its programmed contents back over the bus', () => {
        const r = memRig('28c256', 'ceb', { contents: [0x4c, 0x00, 0x80] }); // JMP $8000
        r.idle();
        assert.equal(r.read(0), 0x4c);
        assert.equal(r.read(1), 0x00);
        assert.equal(r.read(2), 0x80);
    });

    it('is byte-writable in circuit, but params.readOnly refuses', () => {
        const rw = memRig('28c256', 'ceb');
        rw.idle();
        rw.write(6, 0x5a);
        assert.equal(rw.read(6), 0x5a, 'a 28C256 really is byte-writable');

        const ro = memRig('28c256', 'ceb', { readOnly: true });
        ro.idle();
        ro.write(6, 0x5a);
        assert.equal(ro.read(6), 0xff, 'readOnly: the write is refused, erased state stands');
    });
});

describe('both memories carry the JEDEC 28-pin footprint', () => {
    it('28 terminals, in package order, differing only at pin 20', () => {
        const ram = getDevice('62256').terminals;
        const rom = getDevice('28c256').terminals;
        assert.equal(ram.length, 28);
        assert.equal(rom.length, 28);
        // Pin 20 is /CS on the SRAM and /CE on the EEPROM; everything
        // else is the same pin doing the same job.
        assert.equal(ram[22], 'csb');
        assert.equal(rom[22], 'ceb');
        assert.deepEqual(ram.filter((t) => t !== 'csb'), rom.filter((t) => t !== 'ceb'));
        // Spot-check the corners of the package order.
        assert.equal(ram[0], 'a14', 'pin 1');
        assert.equal(ram[13], 'gnd', 'pin 14');
        assert.equal(ram[14], 'vcc', 'pin 28 — the right column starts at the TOP');
        assert.equal(ram[27], 'd3', 'pin 15');
    });
});
