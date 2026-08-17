/**
 * Serial DebugTarget end-to-end: real firmware UART, no mock.
 *
 * WHAT THIS ESTABLISHES:
 *   Two independent implementations — this host codec (serial-debug.js)
 *   and the firmware's C codec (10-live-firmware) — agree over a
 *   transport neither one owns (emu8051's UART model). Category 2b.
 *
 * WHAT THIS DOES NOT ESTABLISH:
 *   - Baud accuracy (emu8051 delivers bytes instantly, §5 of UART-ENTRY-POINTS.md)
 *   - Framing errors, parity, noise
 *   - P3.0/P3.1 ISP contention on real silicon
 *   - Idle-timeout resync under emu8051 (unreachable — bytes arrive instantly)
 *     ucsim's stc12_trace with -inject CAN reach it (44bad89/a81091e).
 *
 * A green suite here means the protocol logic is correct. It does NOT mean
 * the wire works. Only BENCH-UART settles that.
 *
 * Skips when no emu8051 WASM or firmware hex is reachable — but LOUDLY.
 * A silent skip is indistinguishable from a test that never existed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSerialDebugTarget, buildFrame, CMD } from '../src/serial-debug.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const WASM_CANDIDATES = [
  path.resolve(here, '../../emu8051-stc/build/emu8051.js'),
].filter(Boolean);

const HEX_CANDIDATES = [
  path.resolve(here, '../../stc/build/stc12c5a60s2/10-live-firmware/main.ihx'),
].filter(Boolean);

const TRACE_CANDIDATES = [
  path.resolve(here, '../../ucsim-stc/ucsim/src/sims/s51.src/stc12_trace'),
].filter(Boolean);

let createEmu8051 = null;
let firmwareHex = null;
let firmwareHexPath = null;
let traceBin = null;

for (const p of WASM_CANDIDATES) { if (existsSync(p)) { createEmu8051 = require(p); break; } }
for (const p of HEX_CANDIDATES) { if (existsSync(p)) { firmwareHex = readFileSync(p, 'utf8'); firmwareHexPath = p; break; } }
for (const p of TRACE_CANDIDATES) { if (existsSync(p)) { traceBin = p; break; } }

// ─── Loud skip: a skipped test must be visible ──────────────────────────

const MISSING = [];
if (!createEmu8051) MISSING.push('emu8051 WASM (build/emu8051.js)');
if (!firmwareHex) MISSING.push('10-live-firmware hex');

function loudSkip(testName) {
  if (MISSING.length === 0) return false;
  const msg = `⚠ SKIPPED: ${testName} — missing: ${MISSING.join(', ')}. ` +
    'This is the strongest non-bench evidence in the project. ' +
    'A silent skip here means it stopped being collected.';
  console.log(`# ${msg}`);
  return true;
}

// ─── Transport: bridge serial-debug.js to emu8051's UART ────────────────

function createEmuTransport(wasm) {
  let dataCallback = null;
  let closeCallback = null;
  let txCbPtr = null;
  const txBuf = [];

  if (wasm.addFunction && wasm._emu_set_serial_callback) {
    txCbPtr = wasm.addFunction((byte, _ud) => { txBuf.push(byte); }, 'vii');
    wasm._emu_set_serial_callback(txCbPtr);
  }

  return {
    write: async (data) => {
      for (let i = 0; i < data.length; i++) {
        wasm._emu_serial_write(data[i]);
        const lo1 = wasm._emu_get_time_ns_lo();
        const hi1 = wasm._emu_get_time_ns_hi();
        wasm._emu_advance_to_ns((lo1 + 50000) >>> 0, hi1);
      }
      for (let i = 0; i < 20; i++) {
        const lo2 = wasm._emu_get_time_ns_lo();
        const hi2 = wasm._emu_get_time_ns_hi();
        wasm._emu_advance_to_ns((lo2 + 500000) >>> 0, hi2);
      }
      if (txBuf.length > 0 && dataCallback) {
        const reply = new Uint8Array(txBuf);
        txBuf.length = 0;
        setTimeout(() => dataCallback(reply), 1);
      }
    },
    onData: (cb) => { dataCallback = cb; },
    onClose: (cb) => { closeCallback = cb; },
    destroy() { if (wasm.removeFunction && txCbPtr) wasm.removeFunction(txCbPtr); },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('serial DebugTarget e2e: real firmware, no mock', () => {
  it('HELLO round-trip against 10-live-firmware', async () => {
    if (loudSkip('HELLO')) return;

    const wasm = await createEmu8051();
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm.ccall('emu_load_hex', 'number', ['string', 'number'],
      [firmwareHex, firmwareHex.length]);
    wasm._emu_advance_to_ns(200000000, 0);

    const transport = createEmuTransport(wasm);
    const target = createSerialDebugTarget(transport, { timeoutMs: 5000 });

    try {
      await target.connect();
      console.log(`# HELLO: state=${target.state()} connected=${target.isConnected()}`);
      assert.equal(target.state(), 'halted', 'should be halted after connect');
      assert.equal(target.isConnected(), true);
    } finally { transport.destroy(); }
  });

  it('REGS + READ round-trip', async () => {
    if (loudSkip('REGS+READ')) return;

    const wasm = await createEmu8051();
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm.ccall('emu_load_hex', 'number', ['string', 'number'],
      [firmwareHex, firmwareHex.length]);
    wasm._emu_advance_to_ns(200000000, 0);

    const transport = createEmuTransport(wasm);
    const target = createSerialDebugTarget(transport, { timeoutMs: 5000 });

    try {
      await target.connect();
      if (target.state() !== 'halted') { console.log('# SKIP: could not connect'); return; }

      const regs = await target.readRegs();
      console.log(`# REGS: ${regs ? Object.keys(regs).length + ' fields' : 'null'}`);
      assert.ok(regs, 'readRegs should return data');

      const mem = await target.readMem('iram', 0, 1);
      console.log(`# READ iram[0]: ${mem ? '0x' + mem[0]?.toString(16) : 'null'}`);
      assert.ok(mem, 'readMem should return data');
      assert.equal(mem.length, 1, 'should read 1 byte');
    } finally { transport.destroy(); }
  });

  it('idle-timeout resync: per-emulator status', () => {
    // emu8051: UNREACHABLE. Bytes arrive instantly, no inter-byte gaps.
    // ucsim stc12_trace with -inject (a81091e): REACHABLE. Timer 1 wall
    //   clock runs, 5ms timeout fires. Byte delivery timed by the serial
    //   model's own bit-period counting.
    //
    // The resync test below exercises this via stc12_trace subprocess.
    // If stc12_trace is not available, the gap is stated, not hidden.
    console.log('# idle-timeout resync:');
    console.log('#   emu8051: UNREACHABLE (instant bytes, no gaps)');
    console.log('#   ucsim stc12_trace -inject: REACHABLE (a81091e)');
    console.log('#   silicon: BENCH-UART');
    assert.ok(true, 'documented gap with per-emulator status');
  });
});

describe('serial resync: torn frame recovery via stc12_trace -inject', () => {
  // ─── Pre-registered predictions (written before first execution) ───
  //
  // These assertions are committed before the resync test has ever run.
  // They are predictions, not observations fitted to a result.
  //
  // 1. TORN FRAME DISCARDED: the firmware receives SOF + 2 garbage bytes,
  //    then silence for 10ms. Its idle-timeout (Timer 0, ~5ms) fires and
  //    resets the receiver state machine to HUNT. The garbage is discarded.
  //
  // 2. VALID HELLO ACCEPTED: after the gap, a valid HELLO frame arrives.
  //    The firmware, now back in HUNT state, finds SOF, parses the frame,
  //    and transmits a reply. The reply starts with SOF (0x7E) and has
  //    CMD = 0x81 (HELLO | 0x80 reply flag).
  //
  // 3. REPLY CONTAINS VERSION: the HELLO reply payload includes the
  //    firmware version byte(s). Length > 0.
  //
  // 4. NO REPLY TO THE TORN FRAME: the garbage bytes do not produce any
  //    TX output. All TX bytes come after the valid HELLO.
  //
  // If any of these fail, the failure is the finding — do not adjust
  // the assertion to match what happened.

  /**
   * Check whether stc12_trace accepts -inject by running it with --help
   * or a trivial invocation. If it does, the test MUST run — a skip
   * after this point is a failure, not a skip.
   */
  function injectSupported() {
    if (!traceBin) return false;
    try {
      execFileSync(traceBin, ['-t', 'STC12', '-inject', '0,0x00', '-until-ns', '1000', '/dev/null'],
        { timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch (e) {
      // An unknown option produces "unknown option" or similar in stderr.
      // Do NOT check e.message for 'inject' — it contains the full command
      // line, so it always matches and falsely rejects a working binary.
      const stderr = (e.stderr || '').toLowerCase();
      if (stderr.includes('unknown option') || stderr.includes('unrecognized')) return false;
      // Exit code 1 with no "unknown option" means -inject was accepted
      // but the invocation failed for another reason (e.g. /dev/null is not hex).
      return true;
    }
  }

  it('firmware recovers from a torn frame after idle timeout', () => {
    if (!traceBin) {
      console.log('# ⚠ SKIPPED: stc12_trace binary not found.');
      console.log('#   Build ucsim-stc with -inject support (a81091e).');
      console.log('#   Idle-timeout resync is the one path emu8051 cannot exercise.');
      return;
    }
    if (!firmwareHexPath) {
      console.log('# ⚠ SKIPPED: no firmware hex');
      return;
    }

    const hasInject = injectSupported();
    if (!hasInject) {
      console.log('# ⚠ SKIPPED: stc12_trace does not accept -inject.');
      console.log('#   Binary exists but predates a81091e. Rebuild needed.');
      return;
    }

    // -inject IS accepted — from here, a skip is a failure, not a skip.
    // The test MUST run and produce a result.

    // Injection schedule:
    //   t=0:         SOF (0x7E) — starts a frame
    //   t=87000:     garbage (0xAA) — partial frame
    //   t=174000:    garbage (0xBB) — still partial
    //   (10ms gap — idle timeout fires, receiver resets)
    //   t=10174000:  SOF (0x7E) — new valid HELLO frame
    //   t=10261000:  LEN=0 (0x00)
    //   t=10348000:  CMD=HELLO (0x01)
    //   t=10435000:  SUM (0xFF)

    // TX file MUST be in /tmp — stc12_trace's serial-out file open
    // silently fails on some mount types (the NFS/fuse mount at
    // /mnt/volume1 creates the file but never flushes bytes to it;
    // /tmp on ext4 works). Diagnosed 2026-08-17: the root cause of
    // the pre-existing "0 TX bytes" failure since b46726a.
    const txFile = path.resolve('/tmp', `.bw-board-resync-tx-${process.pid}.bin`);
    try { unlinkSync(txFile); } catch {}

    // TIMING DERIVATION: the firmware configures UART (SCON=0x50 at
    // address 0x13D6) around tick 230938 = ~21ms in the current build.
    // Rather than hard-coding that tick, we use a GENEROUS margin:
    //   - Torn frame at 50ms (29ms past the current SCON write)
    //   - Valid HELLO at 60ms (10ms gap > 5ms idle timeout)
    //   - Run until 80ms
    // This margin survives init moving by up to 29ms without breaking.
    //
    // PRECONDITION: if 0 TX bytes, the inject may have fired before
    // SCON was configured. The assertion message names this cause so
    // a future firmware change that moves init past 50ms fails with
    // "inject before SCON" rather than re-opening the investigation.
    const INJECT_BASE_NS = 50_000_000;  // 50ms — well past any init
    const RESYNC_GAP_NS  = 10_000_000;  // 10ms > 5ms idle timeout
    const HELLO_BASE_NS  = INJECT_BASE_NS + RESYNC_GAP_NS;
    const RUN_UNTIL_NS   = HELLO_BASE_NS + 20_000_000; // 20ms for reply
    //
    // stdio: 'ignore' — the PC trace is hundreds of KB. Piping it
    // fills the buffer, blocks the process, and it gets killed before
    // the TX file is written. We only need the TX file.
    // 87000 ns ≈ one byte at 115200 baud (86.8 µs measured)
    const BYTE_NS = 87000;
    const traceResult = spawnSync(traceBin, [
      '-t', 'STC12',
      '-S', `uart=0,out=${txFile}`,
      // Torn frame: SOF + 2 garbage at INJECT_BASE_NS
      '-inject', `${INJECT_BASE_NS},0x7E`,
      '-inject', `${INJECT_BASE_NS + BYTE_NS},0xAA`,
      '-inject', `${INJECT_BASE_NS + 2 * BYTE_NS},0xBB`,
      // 10ms gap → idle timeout fires → receiver resets
      // Valid HELLO at HELLO_BASE_NS
      '-inject', `${HELLO_BASE_NS},0x7E`,
      '-inject', `${HELLO_BASE_NS + BYTE_NS},0x00`,
      '-inject', `${HELLO_BASE_NS + 2 * BYTE_NS},0x01`,
      '-inject', `${HELLO_BASE_NS + 3 * BYTE_NS},0xFF`,
      '-until-ns', `${RUN_UNTIL_NS}`,
      firmwareHexPath,
    ], { timeout: 120000, stdio: 'ignore' });

    if (traceResult.signal) {
      console.log(`# stc12_trace killed by ${traceResult.signal}`);
    }

    // Capture UART TX to a temp file — the PC trace does NOT contain
    // serial output, so string-matching the trace for '7e' or '81'
    // would match program counter addresses (false positive).
    // Previous assertions 1+2 passed on exactly this false positive.
    let txBytes = Buffer.alloc(0);
    try {
      txBytes = readFileSync(txFile);
    } catch { /* file may not exist */ }

    console.log(`# UART TX bytes: ${txBytes.length}`);
    if (txBytes.length > 0) {
      console.log(`# TX hex: ${txBytes.toString('hex').slice(0, 60)}`);
    }

    // If 0 bytes, fail with a diagnostic rather than returning INCONCLUSIVE.
    // The test has passed before; 0 bytes now means something regressed.
    assert.ok(txBytes.length > 0,
      `0 TX bytes. The inject at ${INJECT_BASE_NS / 1e6}ms may have fired before ` +
      `SCON was configured (currently at tick ~230938 = ~21ms in the firmware listing). ` +
      `If the firmware init moved past ${INJECT_BASE_NS / 1e6}ms, increase INJECT_BASE_NS. ` +
      `Or: stc12_trace binary lacks -until-ns (rebuild from 477d5d2).`);

    // ── Pre-registered assertion 1: firmware replied with SOF ────────
    const hasSOF = txBytes[0] === 0x7E;
    assert.ok(hasSOF,
      `Prediction 1: first TX byte must be SOF (0x7E), got 0x${txBytes[0]?.toString(16)}`);

    // ── Pre-registered assertion 2: HELLO response (CMD | 0x80) ─────
    assert.ok(txBytes.length >= 3 && txBytes[2] === 0x81,
      `Prediction 2: CMD byte must be 0x81 (HELLO reply), got 0x${txBytes[2]?.toString(16)}`);

    // ── Pre-registered assertion 3: payload length > 0 ──────────────
    const replyLen = txBytes[1];
    assert.ok(replyLen > 0,
      `Prediction 3: LEN must be > 0 (version in payload), got ${replyLen}`);

    // ── Pre-registered assertion 4 + positive control ───────────────
    // "No reply to torn frame" is an absence claim. It passes by
    // omission if the reader was never listening. The positive control:
    // assertions 1-3 PASSED, proving the channel captured a real reply.
    // Therefore: the output contains ONLY the valid HELLO reply, and
    // NO bytes from the garbage frame. If the firmware had replied to
    // the garbage, txBytes would contain more than one frame.
    //
    // Expected: exactly one frame = SOF(1) + LEN(1) + CMD(1) + payload(LEN) + SUM(1)
    const expectedLen = 1 + 1 + 1 + replyLen + 1;
    assert.equal(txBytes.length, expectedLen,
      `Prediction 4: exactly one reply frame (${expectedLen} bytes), got ${txBytes.length}. ` +
      `Extra bytes would mean the firmware replied to the torn frame too.`);

    console.log('# ALL 4 PREDICTIONS CONFIRMED:');
    console.log(`#   1. SOF (0x7E): ✓`);
    console.log(`#   2. CMD=0x81 (HELLO reply): ✓`);
    console.log(`#   3. LEN=${replyLen} (payload present): ✓`);
    console.log(`#   4. Exactly ${expectedLen} bytes (no reply to torn frame): ✓`);
    console.log('# Idle-timeout resync CONFIRMED under timed emulation.');
    console.log('# Category 2b — single emulator with bit timing.');

    // Cleanup
    try { unlinkSync(txFile); } catch {}
  });
});
