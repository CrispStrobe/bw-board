/**
 * Determinism tests — same netlist + same program = bit-identical waveform.
 *
 * From the engineering bar (HANDOVER §8): "Same netlist plus same program
 * must produce a bit-identical waveform, twice in a row."
 *
 * Until this is asserted, no waveform regression test can be trusted —
 * a diff might be the change under test or might be the solver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeLedCircuit() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ],
    nets: [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'net_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ],
  };
}

function makeRCCircuit() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ],
    nets: [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_drive', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ],
  };
}

/**
 * Run a scripted program on a board and collect a waveform.
 * @returns {Array<{tNs: bigint, voltages: Map<string, number>, brightness: number}>}
 */
function runProgram(circuit, script) {
  const board = new BoardImpl(5.0);
  board.setNetlist(circuit.parts, circuit.nets);

  const waveform = [];

  for (const step of script) {
    if (step.setPin) {
      board.setPin(step.setPin.pin, step.setPin.mode, step.setPin.high);
    }
    if (step.advanceTo !== undefined) {
      board.advanceTo(step.advanceTo);
    }

    // Sample all nets
    const voltages = new Map();
    for (const net of circuit.nets) {
      voltages.set(net.id, board.nodeVoltage(net.id));
    }
    const brightness = board.ledBrightness?.('LED1') ?? 0;

    waveform.push({
      tNs: board.timeNs,
      voltages,
      brightness,
    });
  }

  return waveform;
}

describe('determinism: identical runs produce identical results', () => {
  it('LED circuit with PWM — two runs are bit-identical', () => {
    const circuit = makeLedCircuit();
    const script = [];

    // PWM: toggle pin every 500µs for 20ms
    for (let us = 0; us < 20000; us += 500) {
      script.push({ setPin: { pin: 'P1.0', mode: 'pushpull', high: us % 1000 === 0 } });
      script.push({ advanceTo: BigInt(us + 500) * 1000n });
    }

    const run1 = runProgram(circuit, script);
    const run2 = runProgram(circuit, script);

    assert.equal(run1.length, run2.length, 'same number of samples');

    for (let i = 0; i < run1.length; i++) {
      assert.equal(run1[i].tNs, run2[i].tNs, `sample ${i}: same time`);

      for (const [netId, v1] of run1[i].voltages) {
        const v2 = run2[i].voltages.get(netId);
        assert.equal(v1, v2,
          `sample ${i}, net "${netId}": run1=${v1} !== run2=${v2} — NOT bit-identical`);
      }

      assert.equal(run1[i].brightness, run2[i].brightness,
        `sample ${i}: brightness run1=${run1[i].brightness} !== run2=${run2[i].brightness}`);
    }
  });

  it('RC circuit charge/discharge — two runs are bit-identical', () => {
    const circuit = makeRCCircuit();
    const script = [];

    // Charge: drive high for 10ms
    script.push({ setPin: { pin: 'P1.0', mode: 'pushpull', high: true } });
    for (let ms = 1; ms <= 10; ms++) {
      script.push({ advanceTo: BigInt(ms) * 1_000_000n });
    }

    // Discharge: drive low for 10ms
    script.push({ setPin: { pin: 'P1.0', mode: 'pushpull', high: false } });
    for (let ms = 11; ms <= 20; ms++) {
      script.push({ advanceTo: BigInt(ms) * 1_000_000n });
    }

    const run1 = runProgram(circuit, script);
    const run2 = runProgram(circuit, script);

    assert.equal(run1.length, run2.length);

    for (let i = 0; i < run1.length; i++) {
      for (const [netId, v1] of run1[i].voltages) {
        const v2 = run2[i].voltages.get(netId);
        assert.equal(v1, v2,
          `sample ${i}, net "${netId}": NOT bit-identical (${v1} vs ${v2})`);
      }
    }
  });

  it('same circuit on two independent BoardImpl instances — bit-identical', () => {
    const circuit = makeLedCircuit();
    const script = [
      { setPin: { pin: 'P1.0', mode: 'quasi', high: false } },
      { advanceTo: 5_000_000n },
      { setPin: { pin: 'P1.0', mode: 'quasi', high: true } },
      { advanceTo: 10_000_000n },
      { setPin: { pin: 'P1.0', mode: 'pushpull', high: false } },
      { advanceTo: 20_000_000n },
    ];

    const run1 = runProgram(circuit, script);
    const run2 = runProgram(circuit, script);

    for (let i = 0; i < run1.length; i++) {
      for (const [netId, v1] of run1[i].voltages) {
        const v2 = run2[i].voltages.get(netId);
        assert.equal(v1, v2, `step ${i}, net "${netId}": not identical`);
      }
    }
  });
});
