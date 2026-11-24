import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';

registerAllDevices();

// The 54-motor-driver bench as Lite's circuit designer hands it to the
// engine (an STC12 on a breadboard: P1.4 through 1 kΩ into an NPN whose
// collector drives a DC motor with a flyback diode; P1.0 sinks an LED),
// armed the way the designer arms a run. Switching the motor on again at
// 2 ms put the trapezoidal step at the 1e-15 s floor with Newton unable to
// converge — fatal ("transient Newton solve failed at minimum step") — or
// not, depending on the last bit of one exp(): green with V8's arm64
// Math.exp, red with its x64 one. A trapezoidal step that cannot converge at
// the floor now restarts its history with an L-stable backward-Euler step
// (what a fresh discontinuity gets anyway) before the failure is final.
const PARTS = [{"id": "VCC", "kind": "vcc", "params": {}, "terminals": ["vcc"]}, {"id": "GND", "kind": "gnd", "params": {}, "terminals": ["gnd"]}, {"id": "MCU", "kind": "mcu", "params": {}, "terminals": ["P1.0", "P1.4", "P1.1", "P1.2", "P1.3", "P1.5", "P1.6", "P1.7", "RST", "P3.0", "P3.1", "P3.2", "P3.3", "P3.4", "P3.5", "P3.6", "P3.7", "XTAL2", "XTAL1", "GND", "P2.0", "P2.1", "P2.2", "P2.3", "P2.4", "P2.5", "P2.6", "P2.7", "P4.4", "P4.5", "P4.6", "P0.7", "P0.6", "P0.5", "P0.4", "P0.3", "P0.2", "P0.1", "P0.0", "VCC"]}, {"id": "R_led", "kind": "resistor", "params": {"ohms": 1000}, "terminals": ["a", "b"]}, {"id": "LED_led", "kind": "led", "params": {"vf": 2, "color": "red"}, "terminals": ["anode", "cathode"]}, {"id": "R_motor", "kind": "resistor", "params": {"ohms": 1000}, "terminals": ["a", "b"]}, {"id": "Q_motor", "kind": "npn", "params": {}, "terminals": ["base", "collector", "emitter"]}, {"id": "MOTOR_motor", "kind": "dc_motor", "params": {}, "terminals": ["a", "b"]}, {"id": "D_motor", "kind": "diode", "params": {"vf": 0.7}, "terminals": ["anode", "cathode"]}];
const NETS = [{"id": "bb1:n-col-b10", "terminals": [{"part": "MCU", "terminal": "P1.7"}]}, {"id": "bb1:n-col-b11", "terminals": [{"part": "MCU", "terminal": "RST"}]}, {"id": "bb1:n-col-b12", "terminals": [{"part": "MCU", "terminal": "P3.0"}]}, {"id": "bb1:n-col-b13", "terminals": [{"part": "MCU", "terminal": "P3.1"}]}, {"id": "bb1:n-col-b14", "terminals": [{"part": "MCU", "terminal": "P3.2"}]}, {"id": "bb1:n-col-b15", "terminals": [{"part": "MCU", "terminal": "P3.3"}]}, {"id": "bb1:n-col-b16", "terminals": [{"part": "MCU", "terminal": "P3.4"}]}, {"id": "bb1:n-col-b17", "terminals": [{"part": "MCU", "terminal": "P3.5"}]}, {"id": "bb1:n-col-b18", "terminals": [{"part": "MCU", "terminal": "P3.6"}]}, {"id": "bb1:n-col-b19", "terminals": [{"part": "MCU", "terminal": "P3.7"}]}, {"id": "bb1:n-col-b20", "terminals": [{"part": "MCU", "terminal": "XTAL2"}]}, {"id": "bb1:n-col-b21", "terminals": [{"part": "MCU", "terminal": "XTAL1"}]}, {"id": "bb1:n-col-b3", "terminals": [{"part": "LED_led", "terminal": "cathode"}, {"part": "MCU", "terminal": "P1.0"}]}, {"id": "bb1:n-col-b4", "terminals": [{"part": "MCU", "terminal": "P1.1"}]}, {"id": "bb1:n-col-b5", "terminals": [{"part": "MCU", "terminal": "P1.2"}]}, {"id": "bb1:n-col-b6", "terminals": [{"part": "MCU", "terminal": "P1.3"}]}, {"id": "bb1:n-col-b7", "terminals": [{"part": "MCU", "terminal": "P1.4"}, {"part": "R_motor", "terminal": "a"}]}, {"id": "bb1:n-col-b8", "terminals": [{"part": "MCU", "terminal": "P1.5"}]}, {"id": "bb1:n-col-b9", "terminals": [{"part": "MCU", "terminal": "P1.6"}]}, {"id": "bb1:n-col-t10", "terminals": [{"part": "MCU", "terminal": "P0.6"}]}, {"id": "bb1:n-col-t11", "terminals": [{"part": "MCU", "terminal": "P0.7"}]}, {"id": "bb1:n-col-t12", "terminals": [{"part": "MCU", "terminal": "P4.6"}]}, {"id": "bb1:n-col-t13", "terminals": [{"part": "MCU", "terminal": "P4.5"}]}, {"id": "bb1:n-col-t14", "terminals": [{"part": "MCU", "terminal": "P4.4"}]}, {"id": "bb1:n-col-t15", "terminals": [{"part": "MCU", "terminal": "P2.7"}]}, {"id": "bb1:n-col-t16", "terminals": [{"part": "MCU", "terminal": "P2.6"}]}, {"id": "bb1:n-col-t17", "terminals": [{"part": "MCU", "terminal": "P2.5"}]}, {"id": "bb1:n-col-t18", "terminals": [{"part": "MCU", "terminal": "P2.4"}]}, {"id": "bb1:n-col-t19", "terminals": [{"part": "MCU", "terminal": "P2.3"}]}, {"id": "bb1:n-col-t20", "terminals": [{"part": "MCU", "terminal": "P2.2"}]}, {"id": "bb1:n-col-t21", "terminals": [{"part": "MCU", "terminal": "P2.1"}]}, {"id": "bb1:n-col-t22", "terminals": [{"part": "MCU", "terminal": "P2.0"}]}, {"id": "bb1:n-col-t31", "terminals": [{"part": "LED_led", "terminal": "anode"}, {"part": "R_led", "terminal": "b"}]}, {"id": "bb1:n-col-t37", "terminals": [{"part": "Q_motor", "terminal": "base"}, {"part": "R_motor", "terminal": "b"}]}, {"id": "bb1:n-col-t4", "terminals": [{"part": "MCU", "terminal": "P0.0"}]}, {"id": "bb1:n-col-t41", "terminals": [{"part": "D_motor", "terminal": "anode"}, {"part": "MOTOR_motor", "terminal": "b"}, {"part": "Q_motor", "terminal": "collector"}]}, {"id": "bb1:n-col-t5", "terminals": [{"part": "MCU", "terminal": "P0.1"}]}, {"id": "bb1:n-col-t6", "terminals": [{"part": "MCU", "terminal": "P0.2"}]}, {"id": "bb1:n-col-t7", "terminals": [{"part": "MCU", "terminal": "P0.3"}]}, {"id": "bb1:n-col-t8", "terminals": [{"part": "MCU", "terminal": "P0.4"}]}, {"id": "bb1:n-col-t9", "terminals": [{"part": "MCU", "terminal": "P0.5"}]}, {"id": "bb1:rail-b-", "terminals": [{"part": "GND", "terminal": "gnd"}, {"part": "MCU", "terminal": "GND"}, {"part": "Q_motor", "terminal": "emitter"}]}, {"id": "bb1:rail-t+", "terminals": [{"part": "D_motor", "terminal": "cathode"}, {"part": "MCU", "terminal": "VCC"}, {"part": "MOTOR_motor", "terminal": "a"}, {"part": "R_led", "terminal": "a"}, {"part": "VCC", "terminal": "vcc"}]}];
const ARM = [["reset"], ["setPin", "P1.0", "quasi", true], ["setPin", "P1.4", "quasi", true], ["setPin", "P1.1", "quasi", true], ["setPin", "P1.2", "quasi", true], ["setPin", "P1.3", "quasi", true], ["setPin", "P1.5", "quasi", true], ["setPin", "P1.6", "quasi", true], ["setPin", "P1.7", "quasi", true], ["setPin", "RST", "quasi", true], ["setPin", "P3.0", "quasi", true], ["setPin", "P3.1", "quasi", true], ["setPin", "P3.2", "quasi", true], ["setPin", "P3.3", "quasi", true], ["setPin", "P3.4", "quasi", true], ["setPin", "P3.5", "quasi", true], ["setPin", "P3.6", "quasi", true], ["setPin", "P3.7", "quasi", true], ["setPin", "XTAL2", "quasi", true], ["setPin", "XTAL1", "quasi", true], ["setPin", "GND", "quasi", true], ["setPin", "P2.0", "quasi", true], ["setPin", "P2.1", "quasi", true], ["setPin", "P2.2", "quasi", true], ["setPin", "P2.3", "quasi", true], ["setPin", "P2.4", "quasi", true], ["setPin", "P2.5", "quasi", true], ["setPin", "P2.6", "quasi", true], ["setPin", "P2.7", "quasi", true], ["setPin", "P4.4", "quasi", true], ["setPin", "P4.5", "quasi", true], ["setPin", "P4.6", "quasi", true], ["setPin", "P0.7", "quasi", true], ["setPin", "P0.6", "quasi", true], ["setPin", "P0.5", "quasi", true], ["setPin", "P0.4", "quasi", true], ["setPin", "P0.3", "quasi", true], ["setPin", "P0.2", "quasi", true], ["setPin", "P0.1", "quasi", true], ["setPin", "P0.0", "quasi", true], ["setPin", "VCC", "quasi", true]];

function bench() {
  const b = new BoardImpl(5);
  b.setNetlist(PARTS, NETS);
  b.setPower(true);
  for (const [m, ...args] of ARM) b[m](...args);
  b.setPin('P1.0', 'pushpull', false);
  return b;
}

test('a motor switched off and on again does not end the transient at the step floor', () => {
  const b = bench();
  for (const [end, on] of [[1000000n, true], [2000000n, false], [3000000n, true], [10000000n, true]]) {
    b.setPin('P1.4', 'quasi', on);
    let receipt;
    for (let calls = 0; calls < 100; calls++) {
      receipt = b.advanceToLive(end, {maxSteps: 16});
      if (receipt.completed) break;
    }
    assert.equal(receipt.completed, true, `motor reaches ${end} ns`);
    assert.equal(b.getTime(), end);
    assert.equal(b.transientAnalysisStatus().failure, null);
    assert.equal(b.transientAnalysisStatus().accuracyMet, true);
  }
  assert.ok(b.getDeviceState('MOTOR_motor').omega > 0, 'the motor turns at the end');
});
