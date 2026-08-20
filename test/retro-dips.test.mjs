// Retro DIP pin surfaces + the crystal, measured.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('the unregistered-kind failure this fixes', () => {
    it('an unknown kind takes down the WHOLE bench, it is not quietly inert', () => {
        // The audit's word for these parts was "inert". It is worse than
        // that: validateNetlist rejects an unknown kind and setNetlist
        // throws, so one unmodelled crystal fails every circuit it is on.
        const board = new BoardImpl(5.0);
        assert.throws(() => board.setNetlist([
            G, { id: 'X1', kind: 'no_such_part_kind', params: {}, terminals: ['a', 'b'] },
        ], [net('ng', ['GND', 'gnd'], ['X1', 'a'])]), /Unknown part kind "no_such_part_kind"/);
    });

    it('...and the ones this module registers now load instead', () => {
        for (const kind of ['w65c02', 'w65c22', 'w65c51', 'z80', 'mc6850', 'tms9918', 'crystal']) {
            const model = getDevice(kind);
            assert.ok(model, `${kind} is registered`);
            const board = new BoardImpl(5.0);
            assert.doesNotThrow(() => board.setNetlist([
                G, { id: 'U1', kind, params: {}, terminals: model.terminals },
            ], [net('ng', ['GND', 'gnd'], ['U1', model.terminals[0]])]), `${kind} loads`);
        }
    });
});

describe('DIP pin surfaces drive and read', () => {
    it('a W65C02 address pin really drives a loaded net, and reads back', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            V, G,
            { id: 'U1', kind: 'w65c02', params: {}, terminals: ['vdd', 'vss', 'a0', 'a1', 'rwb'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vdd']),
            net('ng', ['GND', 'gnd'], ['U1', 'vss'], ['R1', 'b']),
            net('na0', ['U1', 'a0'], ['R1', 'a']),
            net('nrw', ['VCC', 'vcc'], ['U1', 'rwb']),
        ]);
        board.setPin('a0', 'pushpull', true);
        board.advanceTo(10_000n);
        assert.ok(board.readAnalog('a0') > 4.5, `a0 drives the 10k net high (got ${board.readAnalog('a0')})`);

        board.setPin('a0', 'pushpull', false);
        board.advanceTo(20_000n);
        assert.ok(board.readAnalog('a0') < 0.5, 'a0 drives it low');

        board.setPin('rwb', 'input', false);
        board.advanceTo(30_000n);
        assert.equal(board.readPin('rwb'), 1, 'rwb strapped to VDD reads back 1');
    });

    it('a Z80 data pin drives too — the bus names differ, the surface does not', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            V, G,
            { id: 'U1', kind: 'z80', params: {}, terminals: ['vcc', 'gnd', 'd0', 'wrb'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['R1', 'b']),
            net('nd0', ['U1', 'd0'], ['R1', 'a']),
            net('nwr', ['GND', 'gnd'], ['U1', 'wrb']),
        ]);
        board.setPin('d0', 'pushpull', true);
        board.advanceTo(10_000n);
        assert.ok(board.readAnalog('d0') > 4.5, 'd0 drives high');
        board.setPin('wrb', 'input', false);
        board.advanceTo(20_000n);
        assert.equal(board.readPin('wrb'), 0, '/WR strapped low reads 0');
    });

    it('these are BARE chips: they stamp no supply of their own', () => {
        for (const kind of ['w65c02', 'w65c22', 'w65c51', 'z80', 'mc6850', 'tms9918']) {
            const m = getDevice(kind);
            assert.equal(m.gpioFollowsPinStates, true, `${kind} GPIO follows pin states`);
            const st = m.init({ id: 'U1', kind, params: {}, terminals: [] });
            assert.deepEqual(st.drives, {}, `${kind} drives no supply`);
        }
    });
});

describe('w65c02 is NOT the same part as eater6502', () => {
    it('one is a 40-pin CPU, the other a whole-computer surface', () => {
        // The alias question, answered with pinouts rather than with the
        // fact that both say "6502". eater6502 models Ben Eater's
        // breadboard computer AS A WHOLE — CPU plus VIA plus RAM plus ROM
        // — and exposes only what a user can actually wire to: the VIA's
        // two 8-bit ports and the rails. w65c02 is the CPU chip alone,
        // with the address and data buses that the eater6502 surface
        // deliberately hides. Aliasing them would offer 5 V and a set of
        // VIA port pins to a bench that wired A0-A15.
        const cpu = getDevice('w65c02').terminals;
        const machine = getDevice('eater6502').terminals;

        assert.equal(cpu.length, 40, 'the CPU is a DIP-40');
        assert.equal(machine.length, 18, 'the machine surface is VIA ports + rails');

        const shared = cpu.filter((t) => machine.includes(t));
        assert.deepEqual(shared, [], 'they do not share a single terminal name');

        for (const t of ['a0', 'a15', 'd0', 'd7', 'rwb', 'phi2', 'resb']) {
            assert.ok(cpu.includes(t), `CPU has ${t}`);
            assert.ok(!machine.includes(t), `machine surface hides ${t}`);
        }
        for (const t of ['via1.pa0', 'via1.pb7', '5v']) {
            assert.ok(machine.includes(t), `machine surface has ${t}`);
            assert.ok(!cpu.includes(t), `CPU has no ${t}`);
        }
    });
});

describe('crystal', () => {
    it('is an OPEN at DC: no path from a to b', () => {
        // The one electrical claim a crystal can honestly make in a DC
        // solver, and it is a real one — it is what distinguishes the part
        // from the short an importer produces by collapsing it, and what
        // keeps XTAL1 and XTAL2 from being tied together.
        const board = new BoardImpl(5.0);
        board.setNetlist([
            V, G,
            { id: 'X1', kind: 'crystal', params: { frequency: 32768 }, terminals: ['a', 'b'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ], [
            net('nsrc', ['VCC', 'vcc'], ['R1', 'a']),
            net('na', ['R1', 'b'], ['X1', 'a']),
            net('nb', ['X1', 'b'], ['R2', 'a']),
            net('ngnd', ['GND', 'gnd'], ['R2', 'b']),
        ]);
        board.advanceTo(10_000n);
        assert.ok(board.nodeVoltage('na') > 4.9,
            `the driven side sits at the supply (got ${board.nodeVoltage('na')})`);
        assert.ok(board.nodeVoltage('nb') < 0.1,
            `the far side is NOT pulled across the crystal (got ${board.nodeVoltage('nb')})`);
    });

    it('carries its frequency as documentation and claims nothing else', () => {
        const m = getDevice('crystal');
        assert.deepEqual(m.terminals, ['a', 'b'],
            'two terminals, matching bw-circuit-ui\'s fallback for this kind');
        const st = m.init({ id: 'X1', kind: 'crystal', params: { frequency: 8e6 }, terminals: [] });
        assert.deepEqual(st.drives, {}, 'a crystal drives nothing');
        assert.equal(m.update(), false, 'and never changes state');
    });
});
