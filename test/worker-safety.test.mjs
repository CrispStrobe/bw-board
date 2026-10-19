/**
 * E1.5 — worker-safety audit. The Monte-Carlo / sweep runners construct
 * offline BoardImpls in Web Workers; the engine must therefore be
 * importable with no window/DOM on any code path (device modules
 * included), and (parts, nets) must survive structured clone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

test('the engine solves a bench inside a worker thread', async () => {
  const parts = [
    { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'U1', kind: 'timer_555', params: {},
      terminals: ['vcc', 'gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge'] },
  ];
  const nets = [
    { id: 'n_vcc', terminals: [
      { part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' },
      { part: 'U1', terminal: 'vcc' }, { part: 'U1', terminal: 'reset' },
    ] },
    { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'n_gnd', terminals: [
      { part: 'G1', terminal: 'gnd' }, { part: 'R2', terminal: 'b' },
      { part: 'U1', terminal: 'gnd' },
    ] },
  ];

  const workerSrc = `
    import { parentPort, workerData } from 'node:worker_threads';
    const { BoardImpl } = await import(workerData.boardUrl);
    const { registerAllDevices } = await import(workerData.registerUrl);
    registerAllDevices();
    const board = new BoardImpl(5.0);
    board.setNetlist(workerData.parts, workerData.nets);
    board.advanceTo(1_000_000n);
    parentPort.postMessage({
      vMid: board.nodeVoltage('n_mid'),
      hasWindow: typeof globalThis.window !== 'undefined',
    });
  `;

  const result = await new Promise((resolve, reject) => {
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSrc)}`), {
      workerData: {
        boardUrl: new URL('../src/board.js', import.meta.url).href,
        registerUrl: new URL('../src/register-all.js', import.meta.url).href,
        // Structured clone is the transport — the exact contract the
        // browser-side runners rely on.
        parts, nets,
      },
    });
    w.once('message', resolve);
    w.once('error', reject);
    setTimeout(() => reject(new Error('worker timed out')), 20000).unref();
  });

  assert.equal(result.hasWindow, false, 'no window in the worker — and none needed');
  assert.ok(Math.abs(result.vMid - 2.5) < 1e-6,
    `the divider solves in the worker: ${result.vMid}`);
});
