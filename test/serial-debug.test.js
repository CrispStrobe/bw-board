/**
 * Serial debug target tests with mock transport.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialDebugTarget, buildFrame, FrameReceiver, CMD, PROTECTED_SFRS } from '../src/serial-debug.js';

// ─── Mock transport ──────────────────────────────────────────────────────

function createMockTransport(autoReply = {}) {
  let dataCallback = null;
  let closeCallback = null;
  const sent = [];

  const mock = {
    write: async (data) => {
      sent.push(data);
      // Auto-reply: when a command is sent, reply after a microtask
      // (simulates async transport delay)
      const cmd = data[2]; // CMD byte
      if (autoReply[cmd] !== undefined) {
        const payload = autoReply[cmd];
        // Use setTimeout(0) to ensure reply arrives after the promise
        // from sendCommand has been created and is waiting
        setTimeout(() => mock.injectReply(cmd, payload), 1);
      }
    },
    onData: (cb) => { dataCallback = cb; },
    onClose: (cb) => { closeCallback = cb; },

    sent,
    injectReply(cmd, payload = []) {
      const reply = buildFrame(cmd | 0x80, payload);
      if (dataCallback) dataCallback(reply);
    },
    injectEvent(cmd, payload = []) {
      const frame = buildFrame(cmd, payload);
      if (dataCallback) dataCallback(frame);
    },
    disconnect() { if (closeCallback) closeCallback(); },
  };
  return mock;
}

// ─── Frame codec ─────────────────────────────────────────────────────────

describe('frame codec', () => {
  it('buildFrame produces valid frame', () => {
    const f = buildFrame(0x01, [0x42]);
    assert.equal(f[0], 0x7E, 'SOF');
    assert.equal(f[1], 1, 'LEN');
    assert.equal(f[2], 0x01, 'CMD');
    assert.equal(f[3], 0x42, 'payload');
    // SUM: (1 + 1 + 0x42 + SUM) & 0xFF === 0
    assert.equal((f[1] + f[2] + f[3] + f[4]) & 0xFF, 0, 'checksum');
  });

  it('FrameReceiver parses valid frame', () => {
    const rx = new FrameReceiver();
    const f = buildFrame(0x04, [0xAA, 0xBB]);
    rx.feed(f);
    assert.equal(rx.frames.length, 1);
    assert.equal(rx.frames[0].cmd, 0x04);
    assert.equal(rx.frames[0].data[0], 0xAA);
    assert.equal(rx.frames[0].data[1], 0xBB);
  });

  it('FrameReceiver rejects bad checksum', () => {
    const f = buildFrame(0x01, []);
    f[f.length - 1] ^= 0xFF; // corrupt checksum
    const rx = new FrameReceiver();
    rx.feed(f);
    assert.equal(rx.frames.length, 0, 'bad checksum rejected');
  });

  it('FrameReceiver handles back-to-back frames', () => {
    const f1 = buildFrame(0x01, [0x11]);
    const f2 = buildFrame(0x02, [0x22]);
    const combined = new Uint8Array(f1.length + f2.length);
    combined.set(f1, 0);
    combined.set(f2, f1.length);
    const rx = new FrameReceiver();
    rx.feed(combined);
    assert.equal(rx.frames.length, 2);
    assert.equal(rx.frames[0].cmd, 0x01);
    assert.equal(rx.frames[1].cmd, 0x02);
  });
});

// ─── Capabilities ────────────────────────────────────────────────────────

describe('serial target: capabilities', () => {
  it('steps: block only', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    const caps = target.capabilities();
    assert.deepEqual(caps.steps, ['block']);
  });

  it('breakpoints: yield only', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.deepEqual(target.capabilities().breakpoints, ['yield']);
  });

  it('consumes timer0, timer1, uart1, brt', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.deepEqual(target.capabilities().consumes,
      ['timer0', 'timer1', 'uart1', 'brt']);
  });

  it('timeFreezes: true', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.equal(target.capabilities().timeFreezes, true);
  });

  it('detachable: true', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.equal(target.capabilities().detachable, true);
  });
});

// ─── Refusals ────────────────────────────────────────────────────────────

describe('serial target: refusals', () => {
  it('step(insn) → unsupported', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    const result = await target.step('insn');
    assert.ok(result.unsupported, 'insn refused');
  });

  it('step(line) → unsupported', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.WRITE]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    const result = await target.step('line');
    assert.ok(result.unsupported);
  });

  it('write SCON → refused with reason', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.WRITE]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    const result = await target.writeMem('sfr', 0x98, [0x50]);
    assert.ok(result.refused, 'SCON write refused');
    assert.ok(result.refused.includes('UART'), `reason mentions UART: ${result.refused}`);
  });

  it('write SBUF → refused', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.WRITE]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    const result = await target.writeMem('sfr', 0x99, [0x41]);
    assert.ok(result.refused);
  });

  it('write BRT → refused', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.WRITE]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    const result = await target.writeMem('sfr', 0x9C, [0x00]);
    assert.ok(result.refused);
  });

  it('write normal SFR → allowed', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.WRITE]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    // Writing P1 (0x90) should be allowed (auto-reply handles the response)
    const result = await target.writeMem('sfr', 0x90, [0xFF]);
    assert.equal(result, undefined, 'P1 write allowed');
  });
});

// ─── Detached state ──────────────────────────────────────────────────────

describe('serial target: detached', () => {
  it('starts detached', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.equal(target.state(), 'detached');
    assert.equal(target.isConnected(), false);
  });

  it('connect → halted', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [0x01] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    assert.equal(target.state(), 'halted');
    assert.equal(target.isConnected(), true);
  });

  it('transport close → detached', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();
    assert.equal(target.isConnected(), true);

    t.disconnect();
    assert.equal(target.state(), 'detached');
    assert.equal(target.isConnected(), false);
  });
});

describe('serial target: detach reasons', () => {
  it('no connection attempted → reason is null', () => {
    const t = createMockTransport();
    const target = createSerialDebugTarget(t);
    assert.equal(target.getDetachReason(), null, '"choose a port"');
  });

  it('connection succeeded → reason cleared', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();
    assert.equal(target.getDetachReason(), null);
  });

  it('link lost mid-session → reason is "link-lost"', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    t.disconnect();
    assert.equal(target.state(), 'detached');
    assert.equal(target.getDetachReason(), 'link-lost',
      'UI shows: "Connection lost. The board kept running."');
  });
});

// ─── Halt event ──────────────────────────────────────────────────────────

describe('serial target: halt event', () => {
  it('unsolicited EVT_HALT → state becomes halted', async () => {
    const t = createMockTransport({ [CMD.HELLO]: [], [CMD.RUN]: [] });
    const target = createSerialDebugTarget(t);
    await target.connect();

    await target.run();
    assert.equal(target.state(), 'running');

    // Unsolicited halt
    let haltSeen = false;
    target.onHalt(() => { haltSeen = true; });
    t.injectEvent(0xF0, [0x01]); // EVT_HALT with cause=1

    assert.equal(target.state(), 'halted');
    assert.ok(haltSeen, 'onHalt callback fired');
  });
});
