/**
 * The netlist → manifest bridge, and the census that keeps it honest.
 *
 * Runs everywhere: no wasm, no toolchain, no gallery checkout. The corpus half
 * reads `test/fixtures/labwired/f030-bench-netlists.json`, which is the ENGINE
 * side of the real 85 shipped `circuit.stm32f030.json` benches, resolved once by
 * `scripts/labwired-bridge-census.mjs` and stamped with the sb3-creator commit
 * it came from. The designer-file dialects (seating, breadboard rows, hole
 * endpoints) are bw-circuit-ui's problem, and they are already solved there;
 * what this repo has to be right about is what happens to `{parts, nets}`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLabwiredSystem, classifyAttachment, labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';
import { STM32F0_LABWIRED_PINS } from '../src/labwired-chips.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(join(here, 'fixtures/labwired/f030-bench-netlists.json'), 'utf8'));

/** Minimal netlist helper: nets are `[['id', 'part.terminal', …], …]`. */
function netlist (parts, nets) {
    return {
        parts: parts.map(([id, kind, params = {}]) => ({ id, kind, params })),
        nets: nets.map(([id, ...members]) => ({
            id,
            terminals: members.map((m) => {
                const i = m.indexOf('.');
                return { part: m.slice(0, i), terminal: m.slice(i + 1) };
            }),
        })),
    };
}

/** 01-blink's electrical shape: pa0 → R → LED → gnd, plus the supply rails. */
const BLINK = netlist(
    [['u1', 'mcu'], ['R1', 'resistor', { ohms: 1000 }], ['D1', 'led', { vf: 2 }],
        ['VCC', 'vcc'], ['GND', 'gnd']],
    [['n_pa0', 'u1.pa0', 'R1.a'],
        ['n_led', 'R1.b', 'D1.anode'],
        ['rail-', 'D1.cathode', 'GND.gnd', 'u1.gnd'],
        ['rail+', 'VCC.vcc', 'u1.vcc']],
);

describe('labwired bridge: our netlist → their system manifest', () => {
    it('every header pin gets an injection binding, whatever it is wired to', () => {
        const built = buildLabwiredSystem({ netlist: BLINK });
        assert.equal(built.ok, true);
        const inputs = built.bindings.filter((b) => b.signal === 'input' && b.kind === 'button');
        assert.equal(inputs.length, Object.keys(STM32F0_LABWIRED_PINS).length,
            'a pad with no input binding cannot be driven from the board — pillar 2');
        for (const name of Object.keys(STM32F0_LABWIRED_PINS)) {
            assert.ok(inputs.some((b) => b.id === name), `${name} has no injection binding`);
        }
        // The adapter resolves `set_board_io_input(headerName)`, so the id must
        // be the header name and nothing prettier.
        assert.ok(built.systemYaml.includes('- id: "PA0"'));
    });

    it('the classifier walks THROUGH the series resistor to the LED', () => {
        const built = buildLabwiredSystem({ netlist: BLINK });
        const pa0 = built.attachments.find((a) => a.pin === 'PA0');
        assert.equal(pa0.role, 'indicator',
            'stopping at the resistor would classify 160 corpus attachments as "a resistor"');
        assert.ok(pa0.parts.some((p) => p.kind === 'led'));
        assert.ok(!pa0.parts.some((p) => p.kind === 'resistor'),
            'a series element is a conductor, not a leaf');
    });

    it('an output binding is named with OUR part id, so a consumer can join on it', () => {
        const built = buildLabwiredSystem({ netlist: BLINK });
        const out = built.bindings.filter((b) => b.signal === 'output');
        assert.equal(out.length, 1);
        assert.deepEqual(
            { id: out[0].id, kind: out[0].kind, peripheral: out[0].peripheral, pin: out[0].pin },
            { id: 'D1', kind: 'led', peripheral: 'gpioPortA', pin: 0 });
    });

    it('the manifest declares NO external_devices — one board, one truth', () => {
        const built = buildLabwiredSystem({ netlist: BLINK });
        assert.ok(!built.systemYaml.includes('external_devices'),
            'a second model of one LED is the disagreement the law exists to prevent');
    });

    it('a pull-up + button pad is a contact, and gets ONE input binding', () => {
        const nl = netlist(
            [['u1', 'mcu'], ['R1', 'resistor', { ohms: 10000 }], ['SW', 'button'],
                ['VCC', 'vcc'], ['GND', 'gnd']],
            [['n_pa1', 'u1.pa1', 'SW.a', 'R1.b'],
                ['rail+', 'R1.a', 'VCC.vcc', 'u1.vcc'],
                ['rail-', 'SW.b', 'GND.gnd', 'u1.gnd']],
        );
        const built = buildLabwiredSystem({ netlist: nl });
        assert.equal(built.attachments.find((a) => a.pin === 'PA1').role, 'contact');
        const onPa1 = built.bindings.filter((b) => b.pin === 1 && b.peripheral === 'gpioPortA');
        assert.equal(onPa1.length, 1,
            'two signal:input bindings on one pad attach two Buttons, and the second '
            + 'overwrites the first level every service');
        assert.match(onPa1[0].why, /button on PA1/);
        assert.deepEqual(built.refusals, []);
    });

    it('an analog pad is NAMED and its injection is REFUSED, not silently booleanised', () => {
        const nl = netlist(
            [['u1', 'mcu'], ['POT', 'potentiometer'], ['VCC', 'vcc'], ['GND', 'gnd']],
            [['n_pa1', 'u1.pa1', 'POT.wiper'],
                ['rail+', 'POT.a', 'VCC.vcc', 'u1.vcc'],
                ['rail-', 'POT.b', 'GND.gnd', 'u1.gnd']],
        );
        const built = buildLabwiredSystem({ netlist: nl });
        assert.equal(built.attachments.find((a) => a.pin === 'PA1').role, 'analog');
        const adc = built.bindings.find((b) => b.kind === 'adc_input');
        assert.ok(adc, 'the pad must still be named — a silent drop is the bug we refuse');
        assert.match(adc.why, /ADC_IN1/);
        assert.equal(built.refusals.length, 1);
        assert.equal(built.refusals[0].code, 'analog-injection-unavailable');
        assert.equal(built.refusals[0].subject, 'PA1');
    });

    it('a connection on a pad outside the header map is refused BY NAME', () => {
        // pa13 is SWDIO on the package and has no GPIO role in the codegen's
        // cap, so it is deliberately absent from the header map. Wiring an LED
        // to it must say so rather than losing the LED.
        const nl = netlist(
            [['u1', 'mcu'], ['D1', 'led'], ['GND', 'gnd'], ['VCC', 'vcc']],
            [['n_pa13', 'u1.pa13', 'D1.anode'],
                ['rail-', 'D1.cathode', 'GND.gnd', 'u1.gnd'],
                ['rail+', 'VCC.vcc', 'u1.vcc']],
        );
        const built = buildLabwiredSystem({ netlist: nl });
        const r = built.refusals.filter((x) => x.code === 'pin-unmapped');
        assert.equal(r.length, 1);
        assert.equal(r[0].subject, 'pa13');
        assert.match(r[0].reason, /led\(D1\)/);
    });

    it('the controller\'s OWN supply terminals are not refusals', () => {
        const built = buildLabwiredSystem({ netlist: BLINK });
        assert.deepEqual(built.refusals, [],
            'u1.vcc / u1.gnd sit on rails; treating them as unmapped signal pins '
            + 'would make every bench in the gallery refuse');
    });

    it('a chip with no heavy-tier descriptor refuses, and names what does ship', () => {
        const built = buildLabwiredSystem({ netlist: BLINK, chipKind: 'attiny85' });
        assert.equal(built.ok, false);
        assert.equal(built.refusals[0].code, 'chip-unmapped');
        assert.match(built.refusals[0].reason, /stm32f030/);
    });

    it('no controller, or two, refuses rather than guessing', () => {
        const empty = buildLabwiredSystem({ netlist: netlist([['R1', 'resistor']], []) });
        assert.equal(empty.refusals[0].code, 'mcu-absent');

        const two = netlist([['u1', 'mcu'], ['u2', 'mcu']], []);
        const built = buildLabwiredSystem({ netlist: two });
        assert.equal(built.refusals[0].code, 'mcu-ambiguous');
        // …and naming one resolves it.
        assert.equal(buildLabwiredSystem({ netlist: two, mcuId: 'u1' }).ok, true);
    });

    it('classifyAttachment orders analog before contact before indicator', () => {
        assert.equal(classifyAttachment([]), 'floating');
        assert.equal(classifyAttachment([{ kind: 'gnd' }]), 'rail');
        assert.equal(classifyAttachment([{ kind: 'shift_register' }]), 'digital');
        assert.equal(classifyAttachment([{ kind: 'led' }, { kind: 'button' }]), 'contact');
        assert.equal(classifyAttachment([{ kind: 'led' }, { kind: 'ldr' }]), 'analog');
    });

    it('adapter options come out ready to hand to createLabwiredAdapter', () => {
        const opts = labwiredAdapterOptionsFor({ netlist: BLINK, firmware: null });
        assert.ok(opts.chipYaml.includes('profile: stm32v2'),
            'the V2 profile is what stops every pad reading low forever');
        assert.equal(opts.clockHz, 48_000_000);
        assert.deepEqual(Object.keys(opts.pins), Object.keys(STM32F0_LABWIRED_PINS));
    });

    it('a board the bridge cannot carry throws with the reasons attached', () => {
        assert.throws(() => labwiredAdapterOptionsFor({ netlist: BLINK, chipKind: 'z80' }),
            (e) => e.refusals[0].code === 'chip-unmapped');
    });
});

describe('labwired bridge census: the shipped F030 gallery', () => {
    it('the fixture is the corpus, and says where it came from', () => {
        assert.equal(CORPUS.chipKind, 'stm32f030');
        assert.equal(CORPUS.variant, 'circuit.stm32f030.json');
        assert.match(CORPUS.sourceCommit, /^[0-9a-f]{40}$/,
            'a fixture with no provenance cannot be checked for staleness');
        assert.equal(CORPUS.benches.length, 84);
    });

    it('every shipped bench bridges — no chip, mcu or pin refusal anywhere', () => {
        const bad = [];
        for (const { bench, netlist: nl } of CORPUS.benches) {
            const built = buildLabwiredSystem({ netlist: nl, chipKind: CORPUS.chipKind });
            if (!built.ok) { bad.push(`${bench}: not ok (${built.refusals[0]?.code})`); continue; }
            for (const r of built.refusals) {
                if (r.code !== 'analog-injection-unavailable') bad.push(`${bench}: ${r.code} ${r.subject}`);
            }
        }
        assert.deepEqual(bad, [],
            'the pad is the boundary: an unrecognised part beyond it is our board\'s '
            + 'business, so nothing in the gallery should refuse for wiring');
    });

    it('THE LEDGER IS EMPTY for every bench with no analog pad', () => {
        let clean = 0;
        let analog = 0;
        for (const { bench, netlist: nl } of CORPUS.benches) {
            const built = buildLabwiredSystem({ netlist: nl, chipKind: CORPUS.chipKind });
            const hasAnalog = built.attachments.some((a) => a.role === 'analog');
            if (hasAnalog) { analog++; continue; }
            assert.deepEqual(built.refusals, [], `${bench} refused something and has no analog pad`);
            clean++;
        }
        // Measured 2026-08-29 against sb3-creator 934f594. These are exact on
        // purpose: a bridge that quietly stops carrying benches, or quietly
        // starts carrying ones it used to refuse, is the failure this census
        // exists to catch, and a >= would hide the first half of that.
        assert.equal(clean, 60, 'benches carried with an empty ledger');
        assert.equal(analog, 24, 'benches whose analog pads are refused');
    });

    it('the analog refusals are exactly the ADC pads, one per pad', () => {
        let refusals = 0;
        let analogPads = 0;
        for (const { netlist: nl } of CORPUS.benches) {
            const built = buildLabwiredSystem({ netlist: nl, chipKind: CORPUS.chipKind });
            analogPads += built.attachments.filter((a) => a.role === 'analog').length;
            refusals += built.refusals.length;
        }
        assert.equal(analogPads, 31);
        assert.equal(refusals, 31, 'one refusal per analog pad, and nothing else');
    });

    it('the pad-role census matches what the corpus actually wires', () => {
        const tally = {};
        for (const { netlist: nl } of CORPUS.benches) {
            for (const a of buildLabwiredSystem({ netlist: nl, chipKind: CORPUS.chipKind }).attachments) {
                if (a.role === 'floating') continue;
                tally[a.role] = (tally[a.role] ?? 0) + 1;
            }
        }
        assert.deepEqual(tally, { indicator: 104, analog: 31, contact: 16, digital: 8 });
    });
});
