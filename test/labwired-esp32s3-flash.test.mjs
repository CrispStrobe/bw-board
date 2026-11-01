import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { LABWIRED_CATALOG, LABWIRED_CATALOG_PIN } from '../src/labwired-catalog.js';
import {
  ESP32S3_FLASH_BOOT_KIND, ESP32S3_FLASH_BOOT_ROM_SOURCE, ESP32S3_FLASH_BOOT_ROMS,
  ESP32S3_FLASH_CAPACITY, validateEsp32S3MergedFlash,
} from '../src/labwired-firmware-boot.js';
import { fixtureAssets, fixtureManifest, fetchPinned } from '../scripts/fetch-esp32s3-firmware-fixtures.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ELF = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, ...new Array(44).fill(0)]);

// Small structural images, not executable guests. The real-engine suite below
// uses independent retained compiler outputs, admitted by digest before import.
function image (bytes, offset) {
  bytes.fill(0, offset, offset + 32);
  bytes.set([0xe9, 1, 2, 0x20], offset);
  const view = new DataView(bytes.buffer);
  view.setUint16(offset + 12, 9, true);
  view.setUint32(offset + 24, 0x40370000, true);
  view.setUint32(offset + 28, 4, true);
  bytes.set([0x12, 0x34, 0x56, 0x78], offset + 32);
  bytes[offset + 47] = 0xef ^ 0x12 ^ 0x34 ^ 0x56 ^ 0x78;
}
function flash ({ appOffset = 0x20000, tableOffset = 0x8000 } = {}) {
  const bytes = new Uint8Array(appOffset + 48).fill(0xff);
  image(bytes, 0);
  image(bytes, appOffset);
  const v = new DataView(bytes.buffer);
  v.setUint16(tableOffset, 0x50aa, true);
  bytes[tableOffset + 2] = 0;
  bytes[tableOffset + 3] = 0;
  v.setUint32(tableOffset + 4, appOffset, true);
  v.setUint32(tableOffset + 8, 0x10000, true);
  return bytes;
}
function profile (console = 'uart0') {
  return { kind: ESP32S3_FLASH_BOOT_KIND, console,
    irom: new Uint8Array(ESP32S3_FLASH_BOOT_ROMS.irom.bytes).fill(17),
    drom: new Uint8Array(ESP32S3_FLASH_BOOT_ROMS.drom.bytes).fill(23) };
}
function stub () {
  const calls = [];
  let freed = 0;
  const wasm = { WasmSimulator: { new_from_config: (systemYaml, chipYaml, firmware, blobs) => {
    calls.push({ systemYaml, chipYaml, firmware, blobs });
    return { get_pc: () => 0x40000400, get_register_names: () => [],
      get_fault: () => null, read_logic_edges: () => ({ nowCycle: 0, cursor: 0, edges: [] }),
      free: () => { freed++; } };
  } } };
  return { wasm, calls, freed: () => freed };
}

describe('ESP32-S3 merged-flash structural admission', () => {
  it('derives the app offset from the table and accepts an explicit table offset', () => {
    assert.deepEqual(validateEsp32S3MergedFlash(flash()).appOffsets, [0x20000]);
    const meta = validateEsp32S3MergedFlash(flash({ tableOffset: 0x9000 }), { partitionTableOffset: 0x9000 });
    assert.equal(meta.partitionTableOffset, 0x9000);
    assert.equal(meta.flashCapacity, 16 * 1024 * 1024);
  });
  for (const [name, mutate, error] of [
    ['wrong boot chip', b => { b[12] = 0; }, /bootloader.*chip id 9/],
    ['wrong app chip', b => { b[0x20000 + 12] = 0; }, /application.*chip id 9/],
    ['bad table signature', b => { b[0x8000] = 0; }, /entry signature/],
    ['oversized partition', b => { new DataView(b.buffer).setUint32(0x8008, 0xffffffff, true); }, /partition.*bounds/],
    ['misaligned app', b => { new DataView(b.buffer).setUint32(0x8004, 0x21000, true); }, /64 KiB/],
    ['partition overlaps table', b => { new DataView(b.buffer).setUint32(0x8004, 0x8000, true); }, /overlaps boot data/],
    ['overlapping partitions', b => { b.copyWithin(0x8020, 0x8000, 0x8020); }, /partitions overlap/],
    ['absent app', b => { b[0x20000] = 0xff; }, /no populated/],
    ['app segment exceeds partition', b => { new DataView(b.buffer).setUint32(0x20000 + 28, 0xffffffff, true); }, /segment.*bounds/],
    ['boot segment exceeds partition table', b => { new DataView(b.buffer).setUint32(28, 0x10000, true); }, /segment.*bounds/],
    ['corrupt app checksum', b => { b[0x20000 + 32] ^= 1; }, /checksum does not match/],
    ['larger flash header', b => { b[3] = 0x50; }, /beyond the 16 MiB/],
  ]) {
    it(`rejects ${name}`, () => {
      const bytes = flash(); mutate(bytes);
      assert.throws(() => validateEsp32S3MergedFlash(bytes), error);
    });
  }
  it('refuses app-only, empty, truncated, oversized and guessed-layout inputs', () => {
    assert.throws(() => validateEsp32S3MergedFlash(flash().subarray(0x20000)), /app-only/);
    assert.throws(() => validateEsp32S3MergedFlash(new Uint8Array()), /non-empty/);
    assert.throws(() => validateEsp32S3MergedFlash(flash().subarray(0, 0x20000 + 34)), /segment.*bounds/);
    assert.throws(() => validateEsp32S3MergedFlash(new Uint8Array(ESP32S3_FLASH_CAPACITY + 1)), /exceeds/);
    for (const partitionTableOffset of [-1, 0, 0x8001, 1.5, null, NaN, ESP32S3_FLASH_CAPACITY]) {
      assert.throws(() => validateEsp32S3MergedFlash(flash(), { partitionTableOffset }), /partitionTableOffset/);
    }
  });
});

describe('explicit ESP32-S3 boot through the public factory', () => {
  it('passes an empty ELF slot and named copied bytes; reset preserves them', async () => {
    const s = stub(), firmware = flash(), firmwareBoot = profile();
    const { adapter, target, refusals } = await createDebugTarget('labwired', { wasm: s.wasm, firmware, firmwareBoot });
    assert.deepEqual(refusals, []);
    assert.equal(adapter.arch, 'xtensa-lx7');
    assert.equal(adapter.clockHz, 240_000_000);
    assert.equal(adapter.firmwareOnly, true);
    assert.deepEqual(adapter.firmwareBoot.appOffsets, [0x20000]);
    assert.equal(s.calls[0].chipYaml, LABWIRED_CATALOG.esp32s3.chipYaml);
    assert.equal(s.calls[0].firmware.length, 0);
    assert.match(s.calls[0].systemYaml, /debug_uart: "uart0"/);
    assert.match(s.calls[0].systemYaml, /external_devices: \[\]/);
    assert.deepEqual(Object.keys(s.calls[0].blobs).sort(), ['esp32s3_drom', 'esp32s3_flash', 'esp32s3_irom']);
    const expected = Object.fromEntries(Object.entries(s.calls[0].blobs).map(([key, bytes]) => [key, sha256(bytes)]));
    firmware.fill(0); firmwareBoot.irom.fill(0); firmwareBoot.drom.fill(0); firmwareBoot.console = 'usb_serial_jtag';
    target.reset();
    assert.equal(s.calls.length, 2);
    assert.equal(s.freed(), 1);
    assert.equal(s.calls[1].systemYaml, s.calls[0].systemYaml);
    for (const [key, digest] of Object.entries(expected)) assert.equal(sha256(s.calls[1].blobs[key]), digest);
    assert.equal(adapter.firmwareBoot.console, 'uart0');
  });
  it('selects named UART/USB consoles and labels the combined diagnostic choice', async () => {
    for (const console of ['uart0', 'usb_serial_jtag', 'both']) {
      const s = stub();
      const { adapter } = await createDebugTarget('labwired', { wasm: s.wasm, firmware: flash(), firmwareBoot: profile(console) });
      assert.equal(adapter.firmwareBoot.console, console);
      if (console === 'both') assert.doesNotMatch(s.calls[0].systemYaml, /debug_uart:/);
      else assert.match(s.calls[0].systemYaml, new RegExp(`debug_uart: "${console}"`));
    }
  });
  it('rejects absent ROMs, invalid profile/console and competing target definitions before creating a machine', async () => {
    const s = stub();
    const args = () => ({ wasm: s.wasm, firmware: flash(), firmwareBoot: profile() });
    for (const firmwareBoot of [null, {}, { ...profile(), kind: 'esp32-flash' },
      { ...profile(), console: 'auto' }, { ...profile(), irom: undefined },
      { ...profile(), drom: new Uint8Array(1) }, { ...profile(), arbitrary: true }]) {
      await assert.rejects(createDebugTarget('labwired', { ...args(), firmwareBoot }), /ESP32-S3 merged flash/);
    }
    for (const competing of [{ board: {} }, { chip: LABWIRED_CATALOG.esp32s3 }, { chipKind: 'esp32_devkit' },
      { softwareProfile: {} }, { labwiredBoard: {} }, { boardVariant: 'other' }, { pins: {} },
      { clockHz: 1 }, { chipYaml: 'arch: arm' }, { systemYaml: 'name: other' },
      { blobs: {} }, { firmwareAddress: 0 }, { extraSegments: [] }, { arduinoEsp32: true }]) {
      await assert.rejects(createDebugTarget('labwired', { ...args(), ...competing }), /competing configuration/);
    }
    assert.equal(s.calls.length, 0);
  });
  it('keeps the ordinary raw-bin refusal and the addressed ELF route', async () => {
    const s = stub();
    await assert.rejects(createDebugTarget('labwired', { wasm: s.wasm,
      chip: LABWIRED_CATALOG.esp32s3, firmware: flash() }), /needs an ELF or UF2/);
    await createDebugTarget('labwired', { wasm: s.wasm, chip: LABWIRED_CATALOG.esp32s3, firmware: ELF });
    assert.deepEqual(s.calls[0].firmware, ELF);
    assert.equal(s.calls[0].blobs, undefined);
    assert.throws(() => createLabwiredAdapter({ wasm: s.wasm, firmware: flash(), firmwareBoot: profile() }), /requires firmwareOnly/);
  });
});

describe('ESP32-S3 fixture and ROM admission', () => {
  it('binds fixtures, ROM identities and engine to the catalog source; no firmware is embedded', () => {
    assert.equal(fixtureManifest.engine.sourceCommit, LABWIRED_CATALOG_PIN);
    assert.equal(fixtureManifest.sourceCommit, ESP32S3_FLASH_BOOT_ROM_SOURCE.commit);
    const assets = fixtureAssets();
    assert.equal(assets.length, 6);
    for (const asset of assets) {
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
      assert.ok(asset.bytes > 0);
      assert.match(asset.url, /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\//);
    }
    assert.ok(Object.isFrozen(ESP32S3_FLASH_BOOT_ROMS.irom));
  });
  it('download admission refuses wrong length, digest, HTTP failure and oversized streams', async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const asset = { file: 'fixture', url: 'https://example.invalid/fixture', bytes: bytes.length, sha256: sha256(bytes) };
    assert.deepEqual(await fetchPinned(asset, async () => new Response(bytes)), Buffer.from(bytes));
    await assert.rejects(fetchPinned(asset, async () => new Response(bytes.subarray(0, 3))), /wrong byte length/);
    await assert.rejects(fetchPinned(asset, async () => new Response(Uint8Array.of(1, 2, 3, 5))), /SHA-256/);
    await assert.rejects(fetchPinned(asset, async () => new Response(new Uint8Array(5))), /exceeds pinned/);
    await assert.rejects(fetchPinned(asset, async () => new Response('', { status: 404 })), /HTTP 404/);
  });
});

const inputs = process.env.LABWIRED_ESP32S3_INPUTS ? resolve(process.env.LABWIRED_ESP32S3_INPUTS) : null;
if (process.env.LABWIRED_REQUIRE_ESP32S3 === '1' && !inputs) {
  throw new Error('LABWIRED_REQUIRE_ESP32S3=1 requires LABWIRED_ESP32S3_INPUTS; real firmware proof cannot skip');
}

describe('ESP32-S3 real retained firmware through the public factory', { skip: !inputs, timeout: 90_000 }, () => {
  let admitted, wasm;
  function assets () {
    if (admitted) return admitted;
    const all = {};
    for (const asset of fixtureAssets()) {
      const bytes = new Uint8Array(readFileSync(join(inputs, asset.file)));
      assert.equal(bytes.length, asset.bytes, asset.file);
      assert.equal(sha256(bytes), asset.sha256, asset.file);
      all[asset.file] = bytes;
    }
    // Only load executable JS/WASM after EVERY source/ROM/fixture digest agrees.
    wasm = createRequire(import.meta.url)(join(inputs, 'engine/labwired_wasm.js'));
    admitted = all;
    return all;
  }
  function realProfile (console) {
    const all = assets();
    return { kind: ESP32S3_FLASH_BOOT_KIND, console,
      irom: Uint8Array.from(all[`roms/${ESP32S3_FLASH_BOOT_ROMS.irom.filename}`]),
      drom: Uint8Array.from(all[`roms/${ESP32S3_FLASH_BOOT_ROMS.drom.filename}`]) };
  }
  function runUntil (target, adapter, marker, maxMs = 500) {
    let transcript = '';
    adapter.onSerial(byte => { transcript += String.fromCharCode(byte); });
    target.run();
    for (let ms = 0; ms < maxMs && !transcript.includes(marker); ms++) {
      const state = target.runFor(1_000_000);
      assert.equal(state, 'running', JSON.stringify(target.diagnostics()));
      assert.ok(transcript.length < 100_000, 'console output is bounded');
    }
    assert.ok(transcript.includes(marker), `missing ${marker}; PC=${target.regs().pc.toString(16)}; ${transcript}`);
    return transcript;
  }
  for (const fixture of fixtureManifest.firmware) {
    it(`${fixture.id}: ROM boot reaches real application markers; reset keeps copied inputs`, async () => {
      const firmwareBoot = realProfile(fixture.console);
      const firmware = Uint8Array.from(assets()[fixture.file]);
      const { target, adapter } = await createDebugTarget('labwired', { wasm, firmware, firmwareBoot });
      try {
        const transcript = runUntil(target, adapter, fixture.markers.at(-1));
        for (const marker of fixture.markers) assert.ok(transcript.includes(marker), marker);
        firmware.fill(0); firmwareBoot.irom.fill(0); firmwareBoot.drom.fill(0);
        target.reset();
        const after = runUntil(target, adapter, fixture.markers.at(-1));
        for (const marker of fixture.markers) assert.ok(after.includes(marker), `after reset: ${marker}`);
      } finally { target.destroy(); adapter.sim.free(); }
    });
  }
  it('Arduino UART output is absent from a USB-only console and reported as a mismatch', async () => {
    const firmwareBoot = realProfile('usb_serial_jtag');
    const { target, adapter } = await createDebugTarget('labwired', { wasm,
      firmware: assets()['firmware/esp32s3-arduino-flash.bin'], firmwareBoot });
    let heard = '';
    adapter.onSerial(byte => { heard += String.fromCharCode(byte); });
    try {
      target.run();
      let unheard = '';
      for (let ms = 0; ms < 500 && !unheard.includes('SMOKE_OK'); ms++) {
        assert.equal(target.runFor(1_000_000), 'running');
        unheard = new TextDecoder().decode(adapter.sim.unheard_console_output());
      }
      assert.ok(unheard.includes('SMOKE_OK'), 'the sketch actually printed on the other console');
      assert.ok(heard.includes('ESP-ROM:esp32s3'), 'the selected USB console carries its real ROM traffic');
      assert.ok(!heard.includes('SMOKE_OK'), 'UART application output must not leak into the USB console');
      assert.ok(target.diagnostics().consoleMismatch, 'unheard output is diagnosed');
    } finally { target.destroy(); adapter.sim.free(); }
  });
});
