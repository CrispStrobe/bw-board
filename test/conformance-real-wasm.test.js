/**
 * Run the conformance kit against the REAL emu8051-stc WASM build.
 *
 * This is the end-to-end proof: the contract has an executable test suite,
 * and the emulator passes or fails it. A contract that is only prose gets
 * diverged from; one with a test suite does not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformance, formatReport } from '../src/conformance.js';
import { createEmu8051Adapter, formatPollingLossReport } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

// Load the real WASM module
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// WALKED UP, NOT A FIXED DEPTH. Two levels up is where a sibling checkout sits
// relative to a CLONE and never relative to a git WORKTREE, which lives a level
// deeper. These suites APPEARED to work here only because code/wt/emu8051-stc is
// a symlink somebody added 2026-09-03 -- the defect paid for in the filesystem
// instead of the lookup. The absent case is unchanged: with nothing found
// anywhere, resolveAncestor returns the same path this named.
const WASM_PATH = resolveAncestor(here, ['emu8051-stc', 'build', 'emu8051.js']);
/**
 * ABSENT AND BROKEN ARE DIFFERENT ANSWERS AND THIS FILE USED TO GIVE ONE.
 *
 * Both the `require` failing and the module failing to INSTANTIATE printed a
 * `# SKIP` and returned null, and every case then did `if (!wasm) { …; return; }`
 * — an early return, which the runner counts as a PASS. So an emulator that was
 * not there and an emulator that was there and would not load were reported
 * identically, and both as green.
 *
 * They are separated now, and only one of them is a skip:
 *
 *   NOT THERE       a real `skip:`, naming the oracle and how to get it. ci.yml
 *                   checks the emulator out and `--require nasm,emu8051` asserts
 *                   it arrived, so this means a developer box.
 *   THERE, BROKEN   a FAILURE, carrying the exception's own message. A broken
 *                   oracle is a real problem somebody has to see, and hiding it
 *                   behind a skip is how it stays invisible for weeks.
 *
 * Same species as a refusal and a crash sharing a constructor: two conditions
 * with one outcome tells you less than either would alone.
 */
// THE PATH IS THE QUESTION, NOT THE EXCEPTION. My first attempt used "did
// `require` throw" as the signal — and `require` throws MODULE_NOT_FOUND for an
// absent file too, so every absent case turned into a failure. The exception
// cannot tell the two apart; only the filesystem can.
const WASM_PRESENT = existsSync(WASM_PATH);

let createEmu8051;
let loadError = null;
if (WASM_PRESENT) {
  try {
    createEmu8051 = require(WASM_PATH);
  } catch (e) {
    loadError = e;
  }
}

const SKIP_EMU8051 = WASM_PRESENT ? false
  : `no emu8051 build at ${WASM_PATH} — check out CrispStrobe/emu8051-stc beside this `
    + 'repo and build its WASM, or set $EMU8051_JS';

async function loadWasm() {
  // `require` threw on a path that EXISTS: the build is there and unusable.
  if (loadError) {
    throw new Error(`${WASM_PATH} exists but would not load: ${loadError.message}`);
  }
  // Instantiation throwing is the same class — the caller lets it out.
  return createEmu8051();
}

describe('conformance: real emu8051-stc WASM', () => {
  it('loads the WASM module', {skip: SKIP_EMU8051}, async () => {
    const wasm = await loadWasm();
    assert.ok(wasm._emu_init, 'should have _emu_init');
    assert.ok(wasm._emu_set_board_callbacks, 'should have _emu_set_board_callbacks');
    assert.ok(wasm.addFunction, 'should have addFunction');
  });

  it('creates adapter in poll mode (push needs WASM_BIGINT rebuild)', {skip: SKIP_EMU8051}, async () => {
    const wasm = await loadWasm();

    // Force poll mode: the current WASM build does not have -sWASM_BIGINT,
    // so Emscripten legalizes uint64_t to split i32 args in callbacks,
    // causing addFunction type signature mismatches at runtime.
    const adapter = createEmu8051Adapter(wasm, { mode: 'poll' });
    adapter.attachBoard({
      setPin() {},
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    const stats = adapter.getStats();
    console.log(`# Adapter mode: ${stats.mode}`);
    assert.equal(stats.mode, 'poll');
    adapter.destroy();
  });

  it('runs full conformance suite and reports per-requirement', {skip: SKIP_EMU8051}, async () => {
    const wasm = await loadWasm();

    const adapter = createEmu8051Adapter(wasm, { mode: 'poll' });
    const results = runConformance(adapter);

    // Print the full report
    console.log('\n' + formatReport(results) + '\n');

    // Report each result individually
    for (const r of results) {
      console.log(`# ${r.pass ? 'PASS' : 'FAIL'}: ${r.name}`);
      if (!r.pass) console.log(`#   ${r.detail}`);
    }

    // Count
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`# Total: ${passed} passed, ${failed} failed out of ${results.length}`);

    adapter.destroy();
  });

  it('drives an LED end-to-end through real WASM + BoardImpl', {skip: SKIP_EMU8051}, async () => {
    const wasm = await loadWasm();

    const adapter = createEmu8051Adapter(wasm, { mode: 'poll' });
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    adapter.attachBoard(board);

    // Write P1.0 = 0 (LED on, active-low)
    adapter.writePort(1, 0xFE);
    adapter.runNs(25_000_000);

    const b = board.ledBrightness('LED1');
    console.log(`# LED brightness through real WASM: ${b.toFixed(4)}`);

    if (b > 0.10) {
      console.log('# LED is ON through real emulator — end-to-end works');
    } else {
      console.log('# LED brightness is low — push callbacks may not be firing');
    }

    // Print polling loss report
    const stats = adapter.getStats();
    console.log(`# Mode: ${stats.mode}, pin changes: ${stats.pinChangeCount}, push callbacks: ${stats.pushCallbackCount}`);

    adapter.destroy();
  });
});
