/**
 * Verify all ~100 circuit.stc15f2k60s2.json gallery benches accept the
 * stc15_mcu part with real terminals (not "unknown kind" rejection).
 *
 * Before registration, every one of these silently fell through as
 * "unknown part kind" and produced a 0-parts board. After: the MCU part
 * loads with all its terminals validated.
 *
 * Note: some benches also use "breadboard" which is a UI-only part not
 * registered in the engine. This test isolates the stc15_mcu question:
 * does the MCU part and its terminals pass validation?
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const EXAMPLES_DIR = '/mnt/volume1/code/lego/brickwright-lite/overlay/scratch-gui/examples';

// Collect all stc15 bench files
const benchFiles = [];
if (existsSync(EXAMPLES_DIR)) {
  for (const dir of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const f = join(EXAMPLES_DIR, dir.name, 'circuit.stc15f2k60s2.json');
    if (existsSync(f)) benchFiles.push({ name: dir.name, path: f });
  }
}

describe(`STC15 device registration`, () => {
  it('stc15_mcu is a registered device kind', () => {
    const model = getDevice('stc15_mcu');
    assert.ok(model, 'stc15_mcu is registered');
    assert.ok(model.terminals.length >= 40, `has >= 40 terminals (got ${model.terminals.length})`);
    assert.ok(model.gpioFollowsPinStates, 'gpioFollowsPinStates is true');
  });

  it('terminal list includes all 40 PDIP pins (uppercase)', () => {
    const model = getDevice('stc15_mcu');
    const terms = model.terminals;
    // Spot-check critical pins from PINOUT-STC15.md
    assert.ok(terms.includes('P0.0'), 'P0.0 (pin 1)');
    assert.ok(terms.includes('P0.7'), 'P0.7 (pin 8)');
    assert.ok(terms.includes('P1.0'), 'P1.0 (pin 9)');
    assert.ok(terms.includes('P1.6'), 'P1.6 (pin 15, XTAL2 shared)');
    assert.ok(terms.includes('P1.7'), 'P1.7 (pin 16, XTAL1 shared)');
    assert.ok(terms.includes('P5.4'), 'P5.4 (pin 17, RST shared)');
    assert.ok(terms.includes('VCC'), 'VCC (pin 18)');
    assert.ok(terms.includes('P5.5'), 'P5.5 (pin 19)');
    assert.ok(terms.includes('GND'), 'GND (pin 20)');
    assert.ok(terms.includes('P3.0'), 'P3.0 (pin 21)');
    assert.ok(terms.includes('P2.0'), 'P2.0 (pin 32)');
    assert.ok(terms.includes('P4.5'), 'P4.5 (pin 40)');
  });

  it('lowercase aliases are registered for mixed-case benches', () => {
    const model = getDevice('stc15_mcu');
    const terms = model.terminals;
    assert.ok(terms.includes('p1.0'), 'p1.0 lowercase');
    assert.ok(terms.includes('p2.0'), 'p2.0 lowercase');
    assert.ok(terms.includes('vcc'), 'vcc lowercase');
    assert.ok(terms.includes('gnd'), 'gnd lowercase');
  });
});

describe(`STC15 bench terminal validation (${benchFiles.length} benches)`, () => {
  it(`found >= 95 stc15 benches`, () => {
    assert.ok(benchFiles.length >= 95,
      `expected >= 95 benches, found ${benchFiles.length}`);
  });

  for (const { name, path } of benchFiles) {
    it(`${name}: all stc15_mcu terminals are valid`, () => {
      const json = JSON.parse(readFileSync(path, 'utf8'));
      const model = getDevice('stc15_mcu');
      const validTerminals = model.terminals;

      // Check every stc15_mcu part's terminals
      for (const p of (json.parts || [])) {
        if (p.kind !== 'stc15_mcu') continue;
        for (const t of (p.terminals || [])) {
          assert.ok(validTerminals.includes(t),
            `terminal "${t}" on part "${p.id}" is valid`);
        }
      }

      // Check wire references to the MCU part
      for (const w of (json.wires || [])) {
        if (w.from === 'board' || w.from === 'MCU' || w.from === 'mcu1') {
          assert.ok(validTerminals.includes(w.fromTerminal),
            `wire fromTerminal "${w.fromTerminal}" is valid`);
        }
        if (w.to === 'board' || w.to === 'MCU' || w.to === 'mcu1') {
          assert.ok(validTerminals.includes(w.toTerminal),
            `wire toTerminal "${w.toTerminal}" is valid`);
        }
      }
    });
  }
});
