import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {ancestorCandidates} from './helpers/sibling-checkout.mjs';
import {createEmu8051Adapter} from '../src/emu8051-adapter.js';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';

const wasmPath = process.env.EMU8051_JS || ancestorCandidates(import.meta.dirname,
  ['emu8051-stc', 'build', 'emu8051.js']).find(existsSync);
if (!wasmPath && process.env.BW8051_REQUIRE_EMULATOR === '1') throw new Error('emu8051 WASM is required');

test('destroy detaches native callbacks before released function slots can run again',
  {skip: wasmPath ? false : 'emu8051 WASM build not present'}, async () => {
    const create = createRequire(import.meta.url)(wasmPath);
    const wasm = await (create.default || create)();
    const adapter = createEmu8051Adapter(wasm, {part: 'stc15w408as', mode: 'push'});
    adapter.attachBoard({setPin () {}, advanceTo () {}, readPin: () => 1, readAnalog: () => 5});
    const transmit = (byte, portValue = 0) => {
      // MOV P1,#portValue; MOV SBUF,#byte; SJMP $. Both callbacks are driven
      // by executed instructions, including when a fresh adapter owns them.
      const record = [8, 0, 0, 0, 0x75, 0x90, portValue, 0x75, 0x99, byte, 0x80, 0xfe];
      record.push((-record.reduce((sum, value) => sum + value, 0)) & 255);
      const hex = ':' + record.map(value => value.toString(16).padStart(2, '0')).join('') + '\n:00000001FF\n';
      assert.equal(wasm.ccall('emu_load_hex', 'number', ['string', 'number'], [hex, hex.length]), 0);
      wasm._emu_set_pc(0);
      wasm._emu_run(16);
    };
    const sent = [];
    adapter.onSerial(byte => sent.push(byte));
    transmit(65);
    assert.deepEqual(sent, [65], 'exercise a live native-to-JS serial callback first');
    const target = createEmu8051DebugTarget(wasm);
    target.destroy();
    target.destroy();
    adapter.destroy();
    adapter.destroy();
    // Both reset APIs intentionally preserve external bindings. No stale
    // table slot may remain registered by a destroyed consumer.
    wasm._emu_reset(0);
    transmit(66);
    wasm._emu_set_sfr(0x90, 0);
    wasm._emu_dbg_run();
    wasm._emu_dbg_halt();
    wasm._emu_dbg_reset();
    transmit(67);
    assert.deepEqual(sent, [65], 'destroyed listeners do not receive later transmissions');

    const replacement = createEmu8051Adapter(wasm, {part: 'stc15w408as', mode: 'push'});
    const replacementPins = [];
    const replacementSent = [];
    try {
      replacement.attachBoard({
        setPin: (pin, mode, driveHigh) => replacementPins.push({pin, mode, driveHigh}),
        advanceTo () {}, readPin: () => 1, readAnalog: () => 5,
      });
      assert.equal(replacement.getStats().mode, 'push');
      replacement.onSerial(byte => replacementSent.push(byte));
      replacementPins.length = 0; // Discard the initial pin-state publication.
      adapter.destroy();
      transmit(68);
      assert.deepEqual(replacementSent, [68], 'late cleanup by the former owner preserves the new serial callback');
      assert.ok(replacementPins.some(({pin, driveHigh}) => pin === 'P1.0' && !driveHigh),
        'late cleanup by the former owner preserves the new board callbacks');
      assert.deepEqual(sent, [65], 'the former serial listener stays detached after module reuse');
    } finally {
      replacement.destroy();
    }
  });
