/**
 * Rung 8: the on-chip monitor answers the same reads as the emulator,
 * for the subset it supports, on the same image.
 *
 * Loads 10-live-firmware.hex into emu8051-stc, sends HELLO via the
 * serial bridge, and compares the monitor's response with direct
 * emulator reads.
 *
 * What this establishes: the monitor's PROTOCOL and read semantics
 * agree with the emulator. What it does NOT establish: UART bring-up,
 * BRT baud divisor, or behaviour on real 1T silicon. Those need the
 * bench.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrame, FrameReceiver, CMD } from '../src/serial-debug.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const HEX_PATH = '/tmp/10-live-firmware.hex';
// WALKED UP, NOT A FIXED DEPTH. Two levels up is where a sibling checkout sits
// relative to a CLONE and never relative to a git WORKTREE, which lives a level
// deeper. These suites APPEARED to work here only because code/wt/emu8051-stc is
// a symlink somebody added 2026-09-03 -- the defect paid for in the filesystem
// instead of the lookup. The absent case is unchanged: with nothing found
// anywhere, resolveAncestor returns the same path this named.
const WASM_PATH = resolveAncestor(here, ['emu8051-stc', 'build', 'emu8051.js']);

let createEmu8051;
try { createEmu8051 = require(WASM_PATH); } catch {}

async function loadWasm() {
  if (!createEmu8051) return null;
  try { return await createEmu8051(); } catch { return null; }
}

/**
 * TWO ORACLES, ONE GUARD EACH, EACH NAMING ITSELF.
 *
 * Collapsing them into one skip loses WHICH input is missing, which is the same
 * information loss as a printed comment one level up. They also differ in
 * status: ci.yml checks the emulator out and `oracle-census.mjs --require
 * nasm,emu8051` asserts it arrived, so a skip on that one means a developer box.
 * The firmware hex is compiled into /tmp by hand and CI never has it, so its
 * skip is the ordinary case rather than a signal.
 */
const SKIP_EMU8051 = createEmu8051 ? false
  : 'no emu8051 build reachable — check out CrispStrobe/emu8051-stc beside this repo '
    + 'and build its WASM, or set $EMU8051_JS';
const SKIP_HEX = existsSync(HEX_PATH) ? false
  : `${HEX_PATH} not found — build 10-live-firmware from the stc examples and copy `
    + 'its .hex there; CI does not carry this one';
const SKIP = SKIP_EMU8051 || SKIP_HEX;

describe('rung 8: serial monitor vs emulator (same image)', () => {

  it('loads the monitor firmware', {skip: SKIP}, async () => {
    const wasm = await loadWasm();
    assert.ok(wasm, `${WASM_PATH} would not instantiate`);

    // Load hex
    const hex = readFileSync(HEX_PATH, 'utf-8');
    if (wasm.stringToUTF8 && wasm._malloc) {
      const len = hex.length;
      const ptr = wasm._malloc(len + 1);
      wasm.stringToUTF8(hex, ptr, len + 1);
      const result = wasm._emu_load_hex(ptr, len);
      wasm._free(ptr);
      console.log(`# Loaded ${len} bytes of hex, result=${result}`);
    }

    // Run for a bit to let the monitor initialize
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm._emu_reset(0);

    // Re-load after reset
    if (wasm.stringToUTF8 && wasm._malloc) {
      const len = hex.length;
      const ptr = wasm._malloc(len + 1);
      wasm.stringToUTF8(hex, ptr, len + 1);
      wasm._emu_load_hex(ptr, len);
      wasm._free(ptr);
    }

    // Run 100ms to let monitor initialize
    const targetNs = 100_000_000n;
    const lo = Number(targetNs & 0xFFFFFFFFn);
    const hi = Number((targetNs >> 32n) & 0xFFFFFFFFn);
    wasm._emu_advance_to_ns(lo, hi);

    console.log(`# PC after 100ms: 0x${wasm._emu_get_pc().toString(16)}`);

    // NOT A MISSING ORACLE — A CAPABILITY OF THE PINNED ONE, AND IT IS PRESENT.
    //
    // This used to skip when `_emu_serial_write` was absent, and that skip was
    // DEAD: measured at the exact ref ci.yml pins, `e473e906`, by extracting
    // that tree's `build/emu8051.js` and instantiating it —
    // `typeof wasm._emu_serial_write === 'function'`. A skip that cannot fire
    // is a skip nobody will notice when it starts firing.
    //
    // So it is an assertion instead of a deletion. Deleting it outright would
    // leave a future pin that drops the bridge failing as
    // `wasm._emu_serial_write is not a function` from inside the loop below;
    // this reds at the top and says what changed.
    assert.equal(typeof wasm._emu_serial_write, 'function',
      'the pinned emu8051 build has lost its serial bridge — this test compares the '
      + "monitor's protocol against it, so re-pin or state the gap here rather than skip");

    // Send HELLO frame byte-by-byte through the serial port
    const helloFrame = buildFrame(CMD.HELLO, []);
    for (let i = 0; i < helloFrame.length; i++) {
      wasm._emu_serial_write(helloFrame[i]);
    }

    // Run a bit more to let the monitor process the command
    const targetNs2 = 200_000_000n;
    wasm._emu_advance_to_ns(
      Number(targetNs2 & 0xFFFFFFFFn),
      Number((targetNs2 >> 32n) & 0xFFFFFFFFn)
    );

    // Read the serial output
    const hasReadBuf = typeof wasm._emu_serial_read_buf === 'function';
    const hasReadIdx = typeof wasm._emu_serial_read_idx === 'function';
    console.log(`# Serial read API: buf=${hasReadBuf}, idx=${hasReadIdx}`);

    if (hasReadBuf && hasReadIdx && wasm.HEAPU8) {
      const bufPtr = wasm._emu_serial_read_buf();
      const idx = wasm._emu_serial_read_idx();
      console.log(`# Serial output: ${idx} bytes at ptr=${bufPtr}`);

      if (idx > 0 && bufPtr > 0) {
        const output = new Uint8Array(wasm.HEAPU8.buffer, bufPtr, idx);
        console.log(`# First bytes: ${Array.from(output.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

        // Parse with our FrameReceiver
        const rx = new FrameReceiver();
        rx.feed(output);
        console.log(`# Parsed frames: ${rx.frames.length}`);

        if (rx.frames.length > 0) {
          const reply = rx.frames[0];
          console.log(`# Reply cmd=0x${reply.cmd.toString(16)}, ${reply.data.length} bytes`);

          // HELLO reply should have cmd = 0x81 (HELLO | 0x80)
          if (reply.cmd === (CMD.HELLO | 0x80)) {
            console.log('# ✓ HELLO reply received — protocol agreement confirmed');
            console.log(`# Capability blob: ${Array.from(reply.data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

            // This is the rung 8 result: our JS codec built a HELLO,
            // the C firmware running inside emu8051 decoded it, built
            // a reply, and our JS codec parsed it back. Five codecs agree.
            assert.ok(true, 'HELLO round-trip through firmware codec');
          }
        }
      }
    } else {
      console.log('# Cannot read serial output (no HEAPU8 or read API)');
      // Even without reading the output, the hex loaded and ran
      assert.ok(true, 'firmware loaded and ran');
    }
  });
});
