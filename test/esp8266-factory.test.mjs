/**
 * The `esp8266` kind through the machine factory, the entry point production
 * uses: createDebugTarget('esp8266', {image}) lazily loads the esp8266js fork,
 * boots the flash image (bytes or the base64 text the compiler's esp8266
 * target returns) and hands back a debug target over the adapter it returns.
 *
 * Images are our own SDK-free firmware (test/fixtures/esp8266, see its
 * README). BW_ESP8266JS may name the engine's CommonJS entry directly; with
 * neither it nor the installed package, the engine cases skip by name.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDebugTarget, getTargetKinds} from '../src/debug-target-factory.js';
import {loadEsp8266js} from '../src/esp8266js-adapter.js';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';

registerAllDevices();

const here = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(here, 'fixtures/esp8266', name));
let engine = null;
try {
    engine = process.env.BW_ESP8266JS ? createRequire(import.meta.url)(process.env.BW_ESP8266JS) : await loadEsp8266js();
} catch {
    engine = null;
}
const skip = engine ? false : 'the esp8266js engine is not installed (npm install, or BW_ESP8266JS=<dist/cjs/index.js>)';
/** Hand the module in only when it came from BW_ESP8266JS; otherwise the factory loads it itself. */
const withEngine = opts => (process.env.BW_ESP8266JS ? {...opts, esp8266js: engine} : opts);
const MS = 1_000_000;

/** ESP8266 board: GPIO2 -> 220 R -> LED -> GND. */
function ledBench () {
    const board = new BoardImpl(3.3);
    board.setNetlist(
        [
            {id: 'ESP', kind: 'esp8266', params: {}, terminals: ['gpio2', 'gnd']},
            {id: 'R1', kind: 'resistor', params: {ohms: 220}, terminals: ['a', 'b']},
            {id: 'LED1', kind: 'led', params: {vForward: 2.0}, terminals: ['anode', 'cathode']},
        ],
        [
            {id: 'n_pin', terminals: [{part: 'ESP', terminal: 'gpio2'}, {part: 'R1', terminal: 'a'}]},
            {id: 'n_mid', terminals: [{part: 'R1', terminal: 'b'}, {part: 'LED1', terminal: 'anode'}]},
            {id: 'n_gnd', terminals: [{part: 'LED1', terminal: 'cathode'}, {part: 'ESP', terminal: 'gnd'}]},
        ],
    );
    board.setPower(true);
    return board;
}

test('esp8266 is a pickable target kind, and the board kind is registered', () => {
    const kind = getTargetKinds().find(k => k.kind === 'esp8266');
    assert.ok(kind, 'esp8266 is in the picker');
    assert.match(kind.description, /SDK/, 'the entry says which firmware it is offered for');
    // The board part sources its 3.3 V rail (a registered board kind, not the generic mcu fallback).
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            {id: 'ESP', kind: 'esp8266', params: {}, terminals: ['3v3', 'gnd']},
            {id: 'R1', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
        ],
        [
            {id: 'n_3v3', terminals: [{part: 'ESP', terminal: '3v3'}, {part: 'R1', terminal: 'a'}]},
            {id: 'n_gnd', terminals: [{part: 'R1', terminal: 'b'}, {part: 'ESP', terminal: 'gnd'}]},
        ],
    );
    const v = board.nodeVoltage('n_3v3');
    assert.ok(Math.abs(v - 3.3) < 0.05, `3v3 sources 3.3 V, got ${v.toFixed(3)} V`);
});

test('the factory refuses an image it cannot use, by name', async () => {
    await assert.rejects(() => createDebugTarget('esp8266', {}), /requires opts.image/);
    await assert.rejects(() => createDebugTarget('esp8266', {image: 'not base64!'}), /not base64/);
});

test('factory: blink from base64 lights and darkens the LED on GPIO2 as time advances', {skip}, async () => {
    const board = ledBench();
    // The compiler's esp8266 target returns base64 of the flash image.
    const image = fixture('blink.bin').toString('base64');
    const {target, adapter} = await createDebugTarget('esp8266', withEngine({image, board}));
    assert.ok(target, 'the factory produced no debug target');
    assert.ok(adapter, 'the factory produced no adapter');
    assert.equal(target.kind, 'esp8266');
    assert.deepEqual(adapter.pins, ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15']);
    let serial = '';
    adapter.onSerial(b => { serial += String.fromCharCode(b); });

    target.run();
    const at = [];
    for (const ms of [250, 750, 1250, 1750]) {
        assert.equal(target.runFor(ms * MS - Number(adapter.timeNs())), 'budget');
        at.push(board.ledBrightness('LED1') > 0.1);
    }
    assert.deepEqual(at, [false, true, false, true], 'off, on at 500 ms, off at 1000 ms, on at 1500 ms');
    assert.equal(serial, 'blink\non\noff\non\n');
    assert.equal(adapter.fault, null);
});

test('factory: the debug target pauses, steps instructions and stops at a code breakpoint', {skip}, async () => {
    const {target, adapter} = await createDebugTarget('esp8266', withEngine({image: new Uint8Array(fixture('blink.bin'))}));
    // The methods test/debug-factory.test.js requires of every factory target.
    for (const m of ['capabilities', 'state', 'run', 'halt', 'step', 'setBreakpoint', 'readMem', 'writeMem', 'onHalt', 'runFor', 'timeNs']) {
        assert.equal(typeof target[m], 'function', `esp8266 target has method: ${m}`);
    }
    target.run();
    assert.equal(target.runFor(1 * MS), 'budget');
    const halts = [];
    target.onHalt(h => halts.push(h));
    target.halt();
    assert.equal(target.state(), 'halted');
    const r0 = target.regs();
    assert.equal(typeof r0.pc, 'number');
    assert.equal(typeof r0.a1, 'number');
    // A breakpoint at a PC the program has just executed, which a loop revisits.
    target.step('insn', 1);
    assert.equal(target.runFor(1000), 'halted');
    assert.equal(halts.at(-1).cause, 'step');
    const pc = target.regs().pc;
    const id = target.setBreakpoint({kind: 'code', addr: pc});
    target.run();
    let r = 'budget';
    for (let i = 0; i < 20 && r === 'budget'; i++) r = target.runFor(1_000_000);
    assert.equal(r, 'halted', 'the code breakpoint stopped the run');
    assert.equal(halts.at(-1).cause, 'breakpoint');
    assert.equal(halts.at(-1).bp, id);
    assert.equal(target.regs().pc, pc);
    // Memory: the instruction bytes at the PC are readable; writes are refused, not ignored.
    const bytes = target.readMem('mem', pc, 3);
    assert.ok(bytes.some(b => b !== 0), 'the code at the PC reads back');
    assert.ok(target.writeMem('mem', pc, new Uint8Array([0])).refused);
    assert.ok(target.setBreakpoint({kind: 'data', addr: 0}).unsupported);
    assert.equal(adapter.fault, null);
});

test('factory: the button fixture answers the board\'s input', {skip}, async () => {
    const pins = {}, levels = {GPIO5: 1};
    const board = {
        setPin (name, mode, high) { pins[name] = {mode, high}; },
        readPin (name) { return levels[name] ?? 0; },
        advanceTo () {},
    };
    const {target, adapter} = await createDebugTarget('esp8266', withEngine({image: new Uint8Array(fixture('button.bin')), board}));
    let serial = '';
    adapter.onSerial(b => { serial += String.fromCharCode(b); });
    target.run();
    target.runFor(10 * MS);
    assert.equal(serial, 'ready\n');
    assert.deepEqual(pins.GPIO2, {mode: 'pushpull', high: true}, 'LED on while the button is up');
    levels.GPIO5 = 0;                                        // pressed
    target.runFor(10 * MS);
    assert.deepEqual(pins.GPIO2, {mode: 'pushpull', high: false}, 'LED follows the button down');
    assert.equal(serial, 'ready\npress\n');
    target.reset();
    serial = '';
    target.run();
    target.runFor(10 * MS);
    assert.equal(serial, 'ready\n', 'a reset starts the program again');
    assert.equal(adapter.fault, null);
});
