/**
 * Two boards on one radio air — a micro:bit V1 sender and a Calliope mini
 * receiver, both real MakeCode images, on the real engine.
 *
 * The pair is the classroom remote-controlled car: the sender reports its two
 * buttons as numbers (A down 0 / up 1, B down 2 / up 3) with
 * `radio.sendNumber`, and the receiver turns each number into
 * `motors.dualMotorPower(Motor.A | Motor.B, 50 | 0)`. Sources and provenance
 * of the two images: test/fixtures/labwired/radio-pair.
 *
 * What is observed is the receiver's motor driver INPUT lines as GPIO edges
 * (Calliope mini 1.x: IN1 = P0.29, IN2 = P0.30). The driver and the motors are
 * not modelled, so this says "the number crossed the air and the receiving
 * firmware acted on it", and nothing about speed, torque, radio range or
 * timing.
 *
 * The control matters as much as the positive: the same two machines WITHOUT
 * a shared bus must leave those lines still, or the positive proves nothing
 * about the air.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { LABWIRED_CATALOG, LABWIRED_BOARDS } from '../src/labwired-catalog.js';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { plain } from '../src/labwired-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.LABWIRED_WASM;
const skip = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir'
    : !existsSync(join(WASM_DIR, 'labwired_wasm.js')) ? `no labwired_wasm.js in ${WASM_DIR}`
        : false;

const fixture = name => new Uint8Array(readFileSync(join(here, 'fixtures/labwired/radio-pair', name)));
const MS = 1_000_000n;
/** IN1, IN2 of the Calliope's motor driver, in watch-channel order. */
const MOTOR = [29, 30].map(pin => ({ kind: 'gpio', peripheral: 'gpio0', pin }));
/** Both runtimes are up and the sender's loop is running well before this. */
const BOOT_MS = 3000;
const HOLD_MS = 600;

describe('the Calliope mini 1.x board entry', () => {
    it('is an S110 board on the nRF51822, with button B on P0.16', () => {
        const board = LABWIRED_BOARDS['calliope-mini-v1'];
        assert.ok(board, 'calliope-mini-v1 is in the catalog');
        assert.equal(board.chip, 'nrf51822');
        assert.equal(board.softdevice, 's110');
        assert.match(board.systemYaml, /id: "button_b"\n\s+kind: "button"\n\s+peripheral: "gpio0"\n\s+pin: 16\n/);
        assert.match(LABWIRED_BOARDS['microbit-v1'].systemYaml, /id: "button_b"\n\s+kind: "button"\n\s+peripheral: "gpio0"\n\s+pin: 26\n/,
            'and the micro:bit keeps its own');
    });
});

describe('micro:bit V1 sender and Calliope receiver on the real engine', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR && !skip ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;

    async function pair (shared) {
        const air = shared ? new wasm.AirBus() : undefined;
        const mk = async (board, file, name) => (await createDebugTarget('labwired', {
            wasm, chip: LABWIRED_CATALOG.nrf51822, labwiredBoard: LABWIRED_BOARDS[board],
            firmware: fixture(file), name, labAir: air,
        })).adapter;
        const remote = await mk('microbit-v1', 'remote.elf', 'remote');
        const car = await mk('calliope-mini-v1', 'car.elf', 'car');
        for (const b of ['button_a', 'button_b']) remote.sim.set_board_io_input(b, false);
        car.sim.watch_logic_signals(MOTOR);
        let cursor = 0;
        /** Run both for `ms`, interleaved per millisecond; edges per motor line since the last call. */
        const run = ms => {
            for (let i = 0; i < ms; i++) { remote.advanceNs(MS); car.advanceNs(MS); }
            const batch = plain(car.sim.read_logic_edges(cursor)) || {};
            cursor = batch.cursor ?? cursor;
            const edges = [0, 0];
            for (const e of batch.edges || []) edges[e.ch]++;
            return { in1: edges[0], in2: edges[1] };
        };
        const press = (id, down) => remote.sim.set_board_io_input(id, down);
        return { run, press };
    }

    it('each button moves its own motor line, and only while held', async () => {
        const { run, press } = await pair(true);
        assert.deepEqual(run(BOOT_MS), { in1: 0, in2: 0 }, 'no button: both lines still');
        press('button_a', true);
        const a = run(HOLD_MS);
        assert.ok(a.in1 > 0, `A held: IN1 switches (${a.in1} edges)`);
        assert.equal(a.in2, 0, 'A held: IN2 still');
        press('button_a', false);
        run(HOLD_MS);                       // the release frame is somewhere in here
        assert.deepEqual(run(HOLD_MS), { in1: 0, in2: 0 }, 'A released: both lines still again');
        press('button_b', true);
        const b = run(HOLD_MS);
        assert.ok(b.in2 > 0, `B held: IN2 switches (${b.in2} edges)`);
        assert.equal(b.in1, 0, 'B held: IN1 still');
        press('button_b', false);
        run(HOLD_MS);
        assert.deepEqual(run(HOLD_MS), { in1: 0, in2: 0 }, 'B released: both lines still again');
    });

    it('without a shared bus the receiver hears nothing', async () => {
        const { run, press } = await pair(false);
        run(BOOT_MS);
        press('button_a', true);
        assert.deepEqual(run(HOLD_MS), { in1: 0, in2: 0 }, 'A held on a private air');
        press('button_a', false);
        press('button_b', true);
        assert.deepEqual(run(HOLD_MS), { in1: 0, in2: 0 }, 'B held on a private air');
    });
});
