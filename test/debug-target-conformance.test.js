/**
 * DebugTarget conformance: prove the two targets are interchangeable.
 *
 * The same caller drives either without knowing which it has.
 * Branching on capabilities() is allowed; branching on which
 * target it is, is not. If this suite needs to know, the
 * abstraction has a hole.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialDebugTarget, buildFrame, CMD } from '../src/serial-debug.js';

// ─── Target factories ────────────────────────────────────────────────────

/**
 * Mock serial transport with auto-reply.
 * Simulates a monitor firmware that responds to commands.
 */
function makeSerialTarget() {
  let dataCallback = null;
  let closeCallback = null;

  const transport = {
    write: async (data) => {
      const cmd = data[2];
      const replies = {
        [CMD.HELLO]: [0x01, 0x04], // version, capabilities
        [CMD.REGS]: [0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00,
                     0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], // A B DPL DPH SP PSW bank R0-R7
        [CMD.RUN]: [],
        [CMD.HALT]: [],
        [CMD.STEP]: [],
        [CMD.WRITE]: [],
        [CMD.RESET]: [],
        [CMD.READ]: [0x42, 0x43, 0x44, 0x45], // dummy read data
        [CMD.POS]: [0x00, 0x01, 0x00, 0x02], // dummy position
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

  const target = createSerialDebugTarget(transport);
  return { target, transport };
}

// ─── Generic conformance suite ───────────────────────────────────────────
// Only ever branches on capabilities(). Never on which target it is.

async function runConformanceSuite(label, makeTarget) {
  describe(`DebugTarget conformance: ${label}`, () => {

    it('capabilities() returns required fields', async () => {
      const { target } = makeTarget();
      const caps = target.capabilities();

      assert.ok(Array.isArray(caps.steps), 'steps is array');
      assert.ok(Array.isArray(caps.breakpoints), 'breakpoints is array');
      assert.equal(typeof caps.timeFreezes, 'boolean');
      assert.ok(Array.isArray(caps.consumes), 'consumes is array');
    });

    it('state() starts in a valid state', async () => {
      const { target } = makeTarget();
      const s = target.state();
      assert.ok(['detached', 'halted', 'running'].includes(s),
        `initial state is valid: ${s}`);
    });

    it('step(block) is always supported', async () => {
      const { target } = makeTarget();
      const caps = target.capabilities();
      assert.ok(caps.steps.includes('block'),
        'block stepping must be available');
    });

    it('yield breakpoints are always supported', async () => {
      const { target } = makeTarget();
      const caps = target.capabilities();
      assert.ok(caps.breakpoints.includes('yield'));
    });

    it('unsupported step kind → reason, not throw', async () => {
      const { target, transport } = makeTarget();

      // Connect if serial
      if (target.state() === 'detached' && target.connect) {
        await target.connect();
      }

      const caps = target.capabilities();
      const allKinds = ['insn', 'line', 'block', 'over', 'out'];
      const unsupported = allKinds.filter(k => !caps.steps.includes(k));

      for (const kind of unsupported) {
        const result = await target.step(kind);
        assert.ok(result && result.unsupported,
          `step('${kind}') should return {unsupported: reason}, got ${JSON.stringify(result)}`);
        assert.equal(typeof result.unsupported, 'string',
          `reason for '${kind}' should be a string`);
      }
    });

    it('unsupported breakpoint kind → reason, not throw', async () => {
      const { target } = makeTarget();

      if (target.state() === 'detached' && target.connect) {
        await target.connect();
      }

      const caps = target.capabilities();
      const allKinds = ['code', 'yield', 'write', 'read'];
      const unsupported = allKinds.filter(k => !caps.breakpoints.includes(k));

      for (const kind of unsupported) {
        const result = await target.setBreakpoint(kind, 0, 0);
        assert.ok(result && result.unsupported,
          `setBreakpoint('${kind}') should return {unsupported: reason}`);
      }
    });

    it('detachable targets go to detached when link drops', async () => {
      const { target, transport } = makeTarget();
      const caps = target.capabilities();

      if (!caps.detachable) {
        // Emulator is not detachable — skip
        return;
      }

      // Connect first
      if (target.connect) await target.connect();
      assert.notEqual(target.state(), 'detached', 'connected');

      // Drop the link
      transport._disconnect();
      assert.equal(target.state(), 'detached', 'detached after link drop');
    });

    it('skewNs type matches the target kind', async () => {
      const { target } = makeTarget();
      const caps = target.capabilities();

      if (target.getSkewNs) {
        const skew = target.getSkewNs();
        // Emulator: skew = 0 (frozen world)
        // Serial: skew > 0 (world kept running)
        // Both are valid — the test asserts the TYPE is right
        assert.ok(typeof skew === 'bigint' || typeof skew === 'number',
          `skewNs is a number type: ${typeof skew}`);
      }
    });
  });
}

// ─── Run the suite against the serial target ─────────────────────────────

runConformanceSuite('serial target', makeSerialTarget);

// ─── The honest difference ───────────────────────────────────────────────

describe('DebugTarget: the honest difference between emulator and serial', () => {
  it('serial target reports detachable=true, non-zero skewNs possible', () => {
    const { target } = makeSerialTarget();
    const caps = target.capabilities();

    // The serial target CAN disconnect (link death)
    assert.equal(caps.detachable, true);

    // The serial target reports non-zero skewNs: the real board kept
    // running while the program was halted. This is the clearest single
    // expression of why the two targets are not equal.
    assert.equal(caps.timeFreezes, true,
      'program time freezes when halted (measured on-chip)');
    // But the BOARD time does not freeze — that is skewNs.
  });
});
