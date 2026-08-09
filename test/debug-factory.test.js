/**
 * Debug target factory tests: one construction path, two targets.
 *
 * Whatever the factory returns satisfies the same interface and
 * reports capabilities matching its own row of the matrix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { buildFrame, CMD } from '../src/serial-debug.js';
import { BoardImpl } from '../src/board.js';

// ─── Mock serial transport ───────────────────────────────────────────────

function makeMockTransport() {
  let dataCallback = null;
  let closeCallback = null;

  return {
    write: async (data) => {
      const cmd = data[2];
      const replies = {
        [CMD.HELLO]: [0x01],
        [CMD.RUN]: [],
        [CMD.HALT]: [],
        [CMD.STEP]: [],
        [CMD.RESET]: [],
      };
      if (replies[cmd] !== undefined) {
        setTimeout(() => {
          const reply = buildFrame(cmd | 0x80, replies[cmd]);
          if (dataCallback) dataCallback(reply);
        }, 1);
      }
    },
    onData: (cb) => { dataCallback = cb; },
    onClose: (cb) => { closeCallback = cb; },
    _disconnect: () => { if (closeCallback) closeCallback(); },
  };
}

// ─── Factory tests ───────────────────────────────────────────────────────

describe('createDebugTarget: serial', () => {
  it('returns a target with capabilities', async () => {
    const transport = makeMockTransport();
    const { target } = await createDebugTarget('serial', { transport });

    assert.ok(target, 'factory returns a target');
    const caps = target.capabilities();
    assert.ok(Array.isArray(caps.steps));
    assert.ok(Array.isArray(caps.breakpoints));
    assert.equal(caps.detachable, true);
  });

  it('serial target reports the serial capability row', async () => {
    const transport = makeMockTransport();
    const { target } = await createDebugTarget('serial', { transport });

    const caps = target.capabilities();
    assert.deepEqual(caps.steps, ['block']);
    assert.deepEqual(caps.breakpoints, ['yield']);
    assert.equal(caps.timeFreezes, true);
    assert.deepEqual(caps.consumes, ['timer0', 'timer1', 'uart1', 'brt']);
  });

  it('no adapter returned for serial target', async () => {
    const transport = makeMockTransport();
    const result = await createDebugTarget('serial', { transport });

    assert.equal(result.adapter, undefined, 'serial has no adapter');
  });
});

describe('createDebugTarget: unknown kind', () => {
  it('throws with a reason', async () => {
    await assert.rejects(
      () => createDebugTarget('bluetooth', {}),
      /Unknown debug target kind/
    );
  });
});

describe('createDebugTarget: missing options', () => {
  it('serial without transport throws', async () => {
    await assert.rejects(
      () => createDebugTarget('serial', {}),
      /requires opts.transport/
    );
  });

  it('emulator without wasm throws', async () => {
    await assert.rejects(
      () => createDebugTarget('emulator', { board: new BoardImpl(5.0) }),
      /requires opts.wasm/
    );
  });

  it('emulator without board throws', async () => {
    await assert.rejects(
      () => createDebugTarget('emulator', { wasm: {} }),
      /requires opts.board/
    );
  });
});

describe('getTargetKinds', () => {
  it('returns emulator and serial', () => {
    const kinds = getTargetKinds();
    assert.equal(kinds.length, 2);
    assert.ok(kinds.find(k => k.kind === 'emulator'));
    assert.ok(kinds.find(k => k.kind === 'serial'));
  });

  it('each kind has label and description', () => {
    for (const k of getTargetKinds()) {
      assert.equal(typeof k.label, 'string');
      assert.equal(typeof k.description, 'string');
      assert.ok(k.label.length > 0);
    }
  });
});

describe('factory → conformance: both targets satisfy the interface', () => {
  it('serial target from factory has all required methods', async () => {
    const transport = makeMockTransport();
    const { target } = await createDebugTarget('serial', { transport });

    const methods = ['capabilities', 'state', 'run', 'halt', 'step',
                     'setBreakpoint', 'readMemory', 'writeMemory', 'onHalt'];
    for (const m of methods) {
      assert.equal(typeof target[m], 'function', `has method: ${m}`);
    }
  });

  it('capabilities from factory match the §1 matrix', async () => {
    const transport = makeMockTransport();
    const { target } = await createDebugTarget('serial', { transport });

    const caps = target.capabilities();

    // Serial row: block stepping, yield breakpoints, curated SFRs
    assert.ok(caps.steps.includes('block'));
    assert.ok(!caps.steps.includes('insn'), 'no insn on serial');
    assert.ok(caps.breakpoints.includes('yield'));
    assert.ok(!caps.breakpoints.includes('code'), 'no code BP on serial');
    assert.equal(caps.detachable, true);
    assert.equal(caps.timeFreezes, true);
  });
});
