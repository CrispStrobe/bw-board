/**
 * The switched-PWM LED average against ngspice's own transient.
 *
 * setPwm() switches the pin for real (see BoardImpl.setPwm), and
 * ledBrightness() is the 20 ms average of the LED current. ngspice is given
 * the identical circuit — the pin's push-pull Thévenin (5 V behind 25 Ω, see
 * pin-model.js R_STRONG), 220 Ω, and the same calibrated LED junction
 * (vf 2.0, n 1.8, rs 10: parts-library's LED defaults, through the shared
 * junctionCard) — driven by a 500 Hz PULSE source, and averages the source
 * current over five whole periods of a settled transient (`meas avg`).
 *
 * Two errors are separated, because they have different causes:
 *
 *  - LINEARITY (the PWM model): the average at duty d, relative to the SAME
 *    engine's full-on current, against the same ratio in ngspice. This is
 *    what switching versus averaging is about; measured < 0.01 %.
 *  - ABSOLUTE (the DC LED model, not PWM): bw-board's full-on current against
 *    ngspice's. It is the same fraction at every duty including 100 %, so it
 *    is not a property of the PWM path; measured ≈ -0.66 %, bounded at 1 %.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { junctionCard, optionsCard } from '../src/ngspice.js';

const NGSPICE = process.env.NGSPICE || 'ngspice';
const HZ = 500;
const PERIOD = 1 / HZ;

function boardAverageMa(percent) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'mcu', kind: 'mcu', params: { pins: ['D9'] }, terminals: ['D9'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
    { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [{ part: 'mcu', terminal: 'D9' }, { part: 'r1', terminal: 'a' }] },
    { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
    { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
  ]);
  board.setPower(true);
  if (percent >= 100) board.setPin('D9', 'pushpull', true);
  else assert.equal(board.setPwm('D9', percent, { hz: HZ }), true);
  board.advanceTo(100_000_000n);
  return board.ledBrightness('led1') * 0.02 * 1000;
}

function ngspiceAverageMa(percent) {
  const j = junctionCard('1', 'b', '0', { vf: 2.0, n: 1.8, rs: 10 });
  const source = percent >= 100
    ? 'V1 p 0 DC 5'
    : `V1 p 0 PULSE(0 5 0 1n 1n ${(percent / 100 * PERIOD).toExponential(9)} ${PERIOD})`;
  const deck = [
    '* bw-board setPwm oracle: 500 Hz PWM into 25R pin + 220R + red LED',
    optionsCard(),
    source,
    'Rpin p a 25',
    'R1 a b 220',
    ...j.lines,
    '.control',
    'set numdgt=12',
    'tran 0.5u 20m 0 0.5u',
    `meas tran iavg avg i(V1) from=${5 * PERIOD} to=${10 * PERIOD}`,
    'print iavg',
    '.endc',
    '.end',
  ].join('\n') + '\n';
  const r = spawnSync(NGSPICE, ['-n', '-b'], { input: deck, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const m = r.stdout.match(/iavg\s*=\s*([-+]?[\d.]+e[-+]?\d+)/i);
  assert.ok(m, `no iavg in ngspice output:\n${r.stdout}`);
  return -Number(m[1]) * 1000; // i(V1) flows into the + terminal: negate
}

test('switched PWM LED average agrees with an ngspice PULSE transient', {
  skip: spawnSync(NGSPICE, ['--version'], { encoding: 'utf8' }).status !== 0,
}, () => {
  const fullOurs = boardAverageMa(100);
  const fullSpice = ngspiceAverageMa(100);
  assert.ok(fullSpice > 10, `ngspice full-on ${fullSpice} mA`);
  const absolute = (fullOurs - fullSpice) / fullSpice;
  assert.ok(Math.abs(absolute) < 0.01,
    `full-on: ours ${fullOurs.toFixed(5)} mA, ngspice ${fullSpice.toFixed(5)} mA (${(absolute * 100).toFixed(3)} %)`);

  const rows = [];
  for (const pct of [10, 25, 50, 75]) {
    const ours = boardAverageMa(pct);
    const spice = ngspiceAverageMa(pct);
    const linearity = ours / fullOurs - spice / fullSpice;
    rows.push(`${pct}%: ours ${ours.toFixed(5)} mA, ngspice ${spice.toFixed(5)} mA, `
      + `abs ${((ours - spice) / spice * 100).toFixed(3)} %, linearity ${(linearity * 100).toFixed(4)} % of full-on`);
    assert.ok(Math.abs(linearity) < 1e-3, rows.join('\n'));
    assert.ok(Math.abs((ours - spice) / spice) < 0.01, rows.join('\n'));
  }
  console.log(rows.join('\n'));
});
