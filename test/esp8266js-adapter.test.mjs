/**
 * The ESP8266 adapter on two images of our own SDK-free firmware
 * (test/fixtures/esp8266), with a board this file plays: it records what the
 * chip drives and supplies the levels the chip reads.
 *
 * The engine is the esp8266js package (our fork). BW_ESP8266JS may name its
 * CommonJS entry directly (a checkout's dist/cjs/index.js); without either,
 * the engine cases skip by name.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEsp8266jsAdapter, ESP8266_PINS, loadEsp8266js} from '../src/esp8266js-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const image = name => new Uint8Array(readFileSync(join(here, 'fixtures/esp8266', name)));
let engine = null;
try {
    engine = process.env.BW_ESP8266JS ? createRequire(import.meta.url)(process.env.BW_ESP8266JS) : await loadEsp8266js();
} catch {
    engine = null;
}
const skip = engine ? false : 'the esp8266js engine is not installed (npm install, or BW_ESP8266JS=<dist/cjs/index.js>)';
const MS = 1_000_000;

/** A board that records pin reports and answers reads from `levels`. */
function recordingBoard () {
    const pins = {}, log = [], levels = {};
    let now = 0n;
    return {
        pins, log, levels,
        get now () { return now; },
        setPin (name, mode, high) { pins[name] = {mode, high}; log.push([Number(now) / MS, name, mode, high]); },
        readPin (name) { return levels[name] ?? 0; },
        advanceTo (t) { assert.ok(t >= now, 'time never runs backwards'); now = t; },
    };
}

test('the adapter refuses what it cannot run, by name', () => {
    assert.throws(() => createEsp8266jsAdapter({image: image('blink.bin')}), /must be the esp8266js module/);
    const fake = {ESP8266: class {}, RomHle: class {}, bootFromFlash () {}};
    assert.throws(() => createEsp8266jsAdapter({esp8266js: fake, image: new Uint8Array(16)}), /must be an ESP8266 flash image/);
    assert.equal(ESP8266_PINS.length, 16);
});

test('blink: the board sees GPIO2 driven high and low every 500 ms of chip time, and the serial lines arrive', {skip}, () => {
    const adapter = createEsp8266jsAdapter({esp8266js: engine, image: image('blink.bin')});
    const board = recordingBoard();
    adapter.attachBoard(board);
    assert.deepEqual(adapter.pins, ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15']);
    let serial = '';
    adapter.onSerial(b => { serial += String.fromCharCode(b); });
    adapter.advanceNs(1600 * MS);
    const led = board.log.filter(([, name, mode]) => name === 'GPIO2' && mode === 'pushpull');
    assert.deepEqual(led.map(([, , , high]) => high), [false, true, false, true], 'output low, then on, off, on');
    for (const [i, [ms]] of led.slice(1).entries()) {
        assert.ok(Math.abs(ms - 500 * (i + 1)) < 2, `edge ${i + 1} at ${ms.toFixed(2)} ms`);
    }
    assert.equal(serial, 'blink\non\noff\non\n');
    assert.ok(adapter.timeNs() >= 1600n * 1_000_000n && adapter.timeNs() < 1601n * 1_000_000n, String(adapter.timeNs()));
    assert.equal(board.now, adapter.timeNs(), 'the board was advanced to the chip\'s time');
    assert.equal(adapter.fault, null);
});

test('button: the board\'s level reaches the chip, and the chip\'s answer reaches the board', {skip}, () => {
    const adapter = createEsp8266jsAdapter({esp8266js: engine, image: image('button.bin')});
    const board = recordingBoard();
    board.levels.GPIO5 = 1;                                  // released: the pull-up wins
    adapter.attachBoard(board);
    let serial = '';
    adapter.onSerial(b => { serial += String.fromCharCode(b); });
    adapter.advanceNs(10 * MS);
    assert.equal(serial, 'ready\n');
    assert.deepEqual(board.pins.GPIO5, {mode: 'input-pullup', high: true}, 'the button pin is an input with its pull-up on');
    assert.deepEqual(board.pins.GPIO2, {mode: 'pushpull', high: true}, 'LED on while the button is up');
    // The shift register's view: GPIO4's level at each rising edge of GPIO14, replayed from the log.
    const bits = [];
    let data = false, clock = false;
    // Only what the chip drives counts: before setup makes them outputs the pins
    // report as inputs (with whatever pull they had), which is not a clock edge.
    for (const [, name, mode, high] of board.log) {
        if (mode !== 'pushpull') continue;
        if (name === 'GPIO4') data = high;
        if (name === 'GPIO14') { if (high && !clock) bits.push(data ? 1 : 0); clock = high; }
    }
    assert.deepEqual(bits, [1, 0, 1, 0, 0, 1, 0, 1], '0xA5, most significant bit first');
    board.levels.GPIO5 = 0;                                  // pressed
    adapter.advanceNs(10 * MS);
    assert.deepEqual(board.pins.GPIO2, {mode: 'pushpull', high: false}, 'LED follows the button down');
    assert.equal(serial, 'ready\npress\n');
    board.levels.GPIO5 = 1;
    adapter.advanceNs(10 * MS);
    board.levels.GPIO5 = 0;
    adapter.advanceNs(10 * MS);
    assert.equal(serial, 'ready\npress\npress\n', 'two presses, two interrupts');
    const before = adapter.timeNs();
    adapter.resetToProgram();
    serial = '';
    adapter.advanceNs(10 * MS);
    assert.equal(serial, 'ready\n', 'a reset starts the program again');
    assert.ok(adapter.timeNs() >= before + 10n * 1_000_000n, 'and time goes on from where it was');
    assert.equal(adapter.fault, null);
});
