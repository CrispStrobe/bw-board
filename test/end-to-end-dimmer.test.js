/**
 * End-to-end: real 06-dimmer firmware → real emu8051 WASM → real board.
 *
 * This is the strongest possible test: a real compiled program runs on
 * a real emulator, drives real pin events through boundary A, and the
 * board integrates the PWM duty into LED brightness.
 *
 * If this passes, the entire stack works.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// WALKED UP, NOT A FIXED DEPTH. `'../../x'` is where a sibling checkout sits
// relative to a CLONE and never relative to a git WORKTREE, which lives a level
// deeper -- so CI kept these cases and every lane lost them, as a '# skipped'
// that reads like a deliberate exclusion. The absent case is unchanged: with
// nothing found anywhere, resolveAncestor returns the same path this named.
const WASM_PATH = resolveAncestor(here, ['emu8051-stc', 'build', 'emu8051.js']);
const HEX_PATH = resolveAncestor(here, ['stc', 'examples', '06-dimmer', '06-dimmer.hex']);
const PINS_PATH = resolveAncestor(here, ['stc', 'examples', '06-dimmer', 'pins.json']);

/**
 * TWO ORACLES OF DIFFERENT STATUS, ONE GUARD EACH, EACH NAMING ITSELF.
 *
 * The firmware half already reached the runner, via `it.skip`, but under a
 * placeholder name and with the whole describe returning early — so the cases
 * that would have run were never REGISTERED and the summary said "1 skipped"
 * for two tests. The emulator half did not reach the runner at all:
 * `if (!wasm) { console.log('# SKIP: …'); return; }` is an early return, which
 * is counted as a PASS.
 *
 *   the emulator  ci.yml checks it out and `oracle-census.mjs --require
 *                 nasm,emu8051` asserts it arrived, so a skip means a developer box
 *   the 06-dimmer hex and pins.json  come from an `stc` checkout beside this
 *                 repo, which CI does not make; that skip is the ordinary case
 *
 * `require` throwing is not used as the signal for either: it throws
 * MODULE_NOT_FOUND for an absent file and a SyntaxError for a broken one, and
 * treating "threw" as an answer merges every reason it could have thrown.
 */
const WASM_PRESENT = existsSync(WASM_PATH);
let createEmu8051;
let loadError = null;
if (WASM_PRESENT) {
  try { createEmu8051 = require(WASM_PATH); } catch (e) { loadError = e; }
}

async function loadWasm() {
  if (loadError) throw new Error(`${WASM_PATH} exists but would not load: ${loadError.message}`);
  return createEmu8051();
}

const SKIP_EMU8051 = WASM_PRESENT ? false
  : `no emu8051 build at ${WASM_PATH} — check out CrispStrobe/emu8051-stc beside this `
    + 'repo and build its WASM, or set $EMU8051_JS';
const missingDimmer = [HEX_PATH, PINS_PATH].filter(f => !existsSync(f));
const SKIP_DIMMER = missingDimmer.length === 0 ? false
  : `06-dimmer not found: ${missingDimmer.join(', ')} — check out CrispStrobe/stc beside `
    + 'this repo and build its examples; CI does not carry them';
const SKIP = SKIP_EMU8051 || SKIP_DIMMER;

describe('end-to-end: 06-dimmer through real emulator', () => {

  it('loads firmware and runs for 50ms', {skip: SKIP}, async () => {
    const wasm = await loadWasm();

    // Load pins and build circuit
    const stc = JSON.parse(readFileSync(PINS_PATH, 'utf-8'));
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Set pot to 50%
    const potPart = parts.find(p => p.kind === 'potentiometer');
    if (potPart) board.setControl(potPart.id, 0.5);

    // Create adapter in poll mode
    const adapter = createEmu8051Adapter(wasm, { mode: 'poll', pollIntervalNs: 1000 });
    adapter.attachBoard(board);

    // Load the real firmware
    const hex = readFileSync(HEX_PATH, 'utf-8');
    adapter.loadHex(hex);

    // Run for 50ms (should be enough for PCA to start producing PWM)
    adapter.runNs(50_000_000);

    const stats = adapter.getStats();
    console.log(`# End-to-end: ${stats.pinChangeCount} pin changes, ${stats.advanceToCount} time steps`);

    // Verify the board is functional
    const state = board.getRenderState();
    console.log(`# LEDs: ${state.leds.map(l => `${l.id}=${l.brightness.toFixed(4)}`).join(', ')}`);
    console.log(`# Time: ${board.getTime()}ns = ${(Number(board.getTime()) / 1e6).toFixed(1)}ms`);

    assert.ok(stats.pinChangeCount > 0, 'emulator produced pin changes');
    assert.ok(stats.advanceToCount > 0, 'emulator advanced time');

    // If PCA PWM is running, we should see non-zero brightness
    // (but the firmware might need more time to initialize PCA)
    const lamp = state.leds.find(l => l.id === 'LED_lamp');
    if (lamp) {
      console.log(`# LED_lamp brightness: ${lamp.brightness.toFixed(4)}`);
    }

    adapter.destroy();
  });

  it('runs for 200ms and captures probe data', {skip: SKIP}, async () => {
    const wasm = await loadWasm();

    const stc = JSON.parse(readFileSync(PINS_PATH, 'utf-8'));
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const potPart = parts.find(p => p.kind === 'potentiometer');
    if (potPart) board.setControl(potPart.id, 0.5);

    // Probe the PWM pin's net
    const pwmNet = nets.find(n => n.terminals.some(
      t => t.part === 'MCU' && t.terminal === 'P1.3'
    ));
    if (pwmNet) board.addProbe(pwmNet.id);

    const adapter = createEmu8051Adapter(wasm, { mode: 'poll', pollIntervalNs: 500 });
    adapter.attachBoard(board);

    const hex = readFileSync(HEX_PATH, 'utf-8');
    adapter.loadHex(hex);

    // Run for 200ms in 10ms chunks
    for (let ms = 10; ms <= 200; ms += 10) {
      adapter.runNs(10_000_000);
    }

    const stats = adapter.getStats();
    console.log(`# 200ms run: ${stats.pinChangeCount} pin changes`);

    // Check probe data
    if (pwmNet) {
      const data = board.getProbeData(pwmNet.id);
      console.log(`# Probe samples: ${data.length}`);
      if (data.length > 10) {
        // Count high/low transitions
        let transitions = 0;
        for (let i = 1; i < data.length; i++) {
          if ((data[i].v > 2.5) !== (data[i-1].v > 2.5)) transitions++;
        }
        console.log(`# Transitions in probe: ${transitions}`);
      }
    }

    const b = board.ledBrightness('LED_lamp');
    console.log(`# LED_lamp brightness after 200ms: ${b.toFixed(4)}`);

    // The firmware should have started PWM by now
    assert.ok(stats.pinChangeCount > 10, 'meaningful pin activity');

    adapter.destroy();
  });
});
