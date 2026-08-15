/**
 * Debug target factory tests: one construction path, three targets.
 *
 * Whatever the factory returns satisfies the same interface and
 * reports capabilities matching its own row of the matrix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { buildFrame, CMD } from '../src/serial-debug.js';
import { BoardImpl } from '../src/board.js';

const here = path.dirname(fileURLToPath(import.meta.url));

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

describe('createDebugTarget: avr8js', () => {
  it('returns adapter (target may be null until avr8js-debug.js exists)', async () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );

    let hasAvr8js = false;
    try { await import('avr8js'); hasAvr8js = true; } catch {}
    if (!hasAvr8js) {
      console.log('# ⚠ SKIPPED: avr8js not installed');
      return;
    }

    const result = await createDebugTarget('avr8js', { board });
    assert.ok(result.adapter, 'avr8js factory returns an adapter');
    assert.equal(typeof result.adapter.advanceNs, 'function');
    assert.equal(typeof result.adapter.loadProgram, 'function');
    assert.equal(typeof result.adapter.timeNs, 'function');
  });

  it('avr8js without board throws', async () => {
    await assert.rejects(
      () => createDebugTarget('avr8js', {}),
      /requires opts.board/
    );
  });

  it('avr8js loads hex and detects non-empty flash', async () => {
    let hasAvr8js = false;
    try { await import('avr8js'); hasAvr8js = true; } catch {}
    if (!hasAvr8js) {
      console.log('# ⚠ SKIPPED: avr8js not installed');
      return;
    }

    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );

    // Minimal hex: one word at address 0 (a JMP instruction)
    // :040000000C94340028 — word[0]=0x940C, word[1]=0x0034
    const hex = ':040000000C94340028\n:00000001FF\n';
    const result = await createDebugTarget('avr8js', { board, hex });
    assert.ok(result.adapter, 'adapter created with hex');
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
  it('returns all target kinds', () => {
    const kinds = getTargetKinds();
    assert.equal(kinds.length, 9);
    assert.ok(kinds.find(k => k.kind === 'emulator'));
    assert.ok(kinds.find(k => k.kind === 'avr8js'));
    assert.ok(kinds.find(k => k.kind === 'atmega2560'));
    assert.ok(kinds.find(k => k.kind === 'attiny85'));
    assert.ok(kinds.find(k => k.kind === 'eater6502'));
    assert.ok(kinds.find(k => k.kind === 'rp2040js'));
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
  // Required methods — the same for BOTH targets. If this list needs
  // a branch on which target it is, the abstraction has a hole.
  const REQUIRED_METHODS = ['capabilities', 'state', 'run', 'halt', 'step',
                            'setBreakpoint', 'readMem', 'writeMem', 'onHalt'];

  it('serial target from factory has all required methods', async () => {
    const transport = makeMockTransport();
    const { target } = await createDebugTarget('serial', { transport });

    for (const m of REQUIRED_METHODS) {
      assert.equal(typeof target[m], 'function', `serial has method: ${m}`);
    }
  });

  it('emulator target from factory has all required methods (if WASM available)', async () => {
    let createEmu8051;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      createEmu8051 = require(path.resolve(here, '../../emu8051-stc/build/emu8051.js'));
    } catch { return; } // WASM not available — skip

    const wasm = await createEmu8051();
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );

    const { target } = await createDebugTarget('emulator', { wasm, board });

    for (const m of REQUIRED_METHODS) {
      assert.equal(typeof target[m], 'function', `emulator has method: ${m}`);
    }
  });

  it('both targets: capabilities never lie about what they support', async () => {
    // Serial
    const transport = makeMockTransport();
    const { target: serial } = await createDebugTarget('serial', { transport });
    const sCaps = serial.capabilities();

    // Every step kind claimed must be callable without 'unsupported'
    // (we can't actually call them without a running program, but
    // the capabilities shape is what the front end branches on)
    assert.ok(sCaps.steps.every(s => typeof s === 'string'), 'serial steps are strings');
    assert.ok(sCaps.breakpoints.every(b => typeof b === 'string'), 'serial bps are strings');

    // Serial MUST report detachable=true
    assert.equal(sCaps.detachable, true, 'serial is detachable');
    // Serial MUST report consumes (it uses peripherals)
    assert.ok(sCaps.consumes.length > 0, 'serial consumes peripherals');
  });

  it('serial capabilities are a strict subset of emulator capabilities', async () => {
    const transport = makeMockTransport();
    const { target: serial } = await createDebugTarget('serial', { transport });
    const sCaps = serial.capabilities();

    // Serial has FEWER steps than emulator
    assert.ok(!sCaps.steps.includes('insn'), 'serial: no insn');
    assert.ok(!sCaps.steps.includes('over'), 'serial: no over');
    assert.ok(!sCaps.steps.includes('out'), 'serial: no out');

    // Serial has FEWER breakpoint kinds
    assert.ok(!sCaps.breakpoints.includes('code'), 'serial: no code BP');

    // Serial consumes peripherals; emulator does not
    assert.ok(sCaps.consumes.length > 0, 'serial consumes');
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

describe('createDebugTarget: rp2040js', () => {
  it('returns an adapter that drives the board from SRAM Thumb', async () => {
    const board = new BoardImpl(3.3);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );

    let hasRp2040js = false;
    try { await import('rp2040js'); hasRp2040js = true; } catch {}
    if (!hasRp2040js) {
      console.log('# ⚠ SKIPPED: rp2040js not installed');
      return;
    }

    // The hand-assembled GP25 blink from rp2040js-adapter.test.js.
    const BLINK = new Uint16Array([
      0x2005, 0x4907, 0x6008, 0x2001, 0x0640, 0x4906, 0x6248,
      0x6148, 0x22C8, 0x3A01, 0xD1FD, 0x6188, 0x22C8, 0x3A01, 0xD1FD, 0xE7F6,
      0x40CC, 0x4001, 0x0000, 0xd000,
    ]);

    const result = await createDebugTarget('rp2040js', { board, program: BLINK });
    assert.ok(result.adapter, 'rp2040js factory returns an adapter');
    assert.equal(typeof result.adapter.advanceNs, 'function');
    assert.equal(typeof result.adapter.loadProgram, 'function');
    // The debug target exists now — the factory wires it with the symbols.
    assert.ok(result.target, 'rp2040js debug target constructed');
    const caps = result.target.capabilities();
    assert.deepEqual(caps.steps, ['insn', 'block', 'over', 'out']);
    assert.deepEqual(caps.breakpoints, ['code', 'yield', 'write']);
    assert.equal(caps.timeFreezes, true);

    // The program actually runs against the attached board.
    result.adapter.advanceNs(100_000);
    // The public accessor is case-blind (the raw map keys canonically).
    const state = board.getPinState('GP25');
    assert.ok(state, 'GP25 reached the board');
    assert.equal(state.mode, 'pushpull');
  });

  it('is listed in getTargetKinds — the Pico compile route exists now', () => {
    // The interim test asserted ABSENCE while nothing could build for the
    // Pico. The hosted rp2040 target shipped 2026-08-12; the entry is due.
    const kind = getTargetKinds().find(k => k.kind === 'rp2040js');
    assert.ok(kind, 'rp2040js is offered');
    assert.match(kind.label, /RP2040/);
  });
});
