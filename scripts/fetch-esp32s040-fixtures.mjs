#!/usr/bin/env node
/** Admit exact S040 evidence. Remote fetching requires a qualified release. */
import {readFile, writeFile, mkdir, rename, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LABWIRED_BOARDS, LABWIRED_CATALOG, LABWIRED_CATALOG_PIN} from '../src/labwired-catalog.js';
import {fetchPinned, fixtureManifest as esp32S3Manifest} from './fetch-esp32s3-firmware-fixtures.mjs';
import {ESP32S3_FLASH_BOOT_KIND, ESP32S3_FLASH_BOOT_ROMS} from '../src/labwired-firmware-boot.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const esp32S040Manifest = JSON.parse(await readFile(
  join(root, 'test/fixtures/labwired/esp32s040/manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** A local functional result must never make an unqualified release fetchable. */
export function requireEsp32S040Release (manifest = esp32S040Manifest, pin = LABWIRED_CATALOG_PIN) {
  if (manifest.schema !== 1 || manifest.qualification !== 'release' ||
      manifest.engine.independentBuildsQualified !== true || manifest.engine.siliconDriftAcknowledged !== true) {
    throw new Error('ESP32-4848S040 qualified immutable release is pending; candidate evidence cannot satisfy hosted qualification');
  }
  const releaseTag = manifest.engine.releaseTag ?? '';
  const prefix = `labwired-wasm-${String(pin).slice(0, 8)}`;
  if (!/^[0-9a-f]{40}$/.test(manifest.source.commit ?? '') ||
      manifest.source.commit !== pin || manifest.engine.sourceCommit !== pin ||
      manifest.source.repository !== 'CrispStrobe/labwired-core' ||
      manifest.engine.releaseRepository !== 'CrispStrobe/bw-board' ||
      !(releaseTag === prefix || releaseTag.startsWith(`${prefix}-`) && /^[a-z0-9-]+$/.test(releaseTag))) {
    throw new Error('ESP32-4848S040 source, immutable release and production catalog identities disagree');
  }
}

export function esp32S040FixtureAssets () {
  requireEsp32S040Release();
  const manifest = esp32S040Manifest;
  return [
    ...manifest.engine.assets.map(asset => ({...asset,
      url: `https://github.com/${manifest.engine.releaseRepository}/releases/download/${manifest.engine.releaseTag}/${asset.asset}`})),
    {...manifest.firmware,
      url: `https://raw.githubusercontent.com/${manifest.source.repository}/${manifest.source.commit}/${manifest.firmware.sourcePath}`},
    ...retainedFlashAssets(),
  ];
}

/** Reuse the exact M1 artifact provenance and ROM identities; no rebuilt sketch. */
function retainedFlashAssets () {
  const retained = esp32S040Manifest.flashBoot;
  const original = esp32S3Manifest.firmware.find(fixture => fixture.id === 'arduino');
  if (retained.sourceRepository !== esp32S3Manifest.sourceRepository ||
      retained.sourceCommit !== esp32S3Manifest.sourceCommit ||
      JSON.stringify(retained.firmware) !== JSON.stringify(original)) {
    throw new Error('S040 retained flash fixture must preserve the original M1 bytes and provenance');
  }
  return [
    ...Object.values(ESP32S3_FLASH_BOOT_ROMS).map(rom => ({...rom, file:`roms/${rom.filename}`})),
    {...retained.firmware,
      url:`https://raw.githubusercontent.com/${retained.sourceRepository}/${retained.sourceCommit}/${retained.firmware.sourcePath}`},
  ];
}

export function verifyEsp32S040Bytes (bytes, asset) {
  if (bytes.length !== asset.bytes) throw new Error(`${asset.file}: wrong pinned byte length`);
  if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.file}: SHA-256 mismatch`);
  return bytes;
}

/** This also checks a test-only preview catalog; it does not grant runtime YAML overrides. */
export function verifyEsp32S040Catalog () {
  const expected = esp32S040Manifest.catalog;
  const board = LABWIRED_BOARDS[expected.boardId];
  const system = Buffer.from(board?.systemYaml ?? '');
  if (board?.chip !== 'esp32s3' || system.length !== expected.bytes || sha256(system) !== expected.sha256 ||
      sha256(LABWIRED_CATALOG.esp32s3.chipYaml) !== expected.chipSha256) {
    throw new Error('ESP32-4848S040 exact producer system/chip catalog is absent or changed');
  }
}

/** Hash every executable input before the caller imports the Node glue. */
export async function admitEsp32S040Inputs (directory, {requireRelease = false} = {}) {
  if (requireRelease) requireEsp32S040Release();
  verifyEsp32S040Catalog();
  const files = [...esp32S040Manifest.engine.assets, esp32S040Manifest.firmware, ...retainedFlashAssets()];
  const admitted = new Map();
  for (const asset of files) {
    const file = join(directory, asset.file);
    if ((await stat(file)).size !== asset.bytes) throw new Error(`${asset.file}: wrong pinned byte length`);
    admitted.set(asset.file, verifyEsp32S040Bytes(await readFile(file), asset));
  }
  return {enginePath: resolve(directory, 'engine/labwired_wasm.js'),
    firmware: new Uint8Array(admitted.get(esp32S040Manifest.firmware.file)),
    mergedFlash: new Uint8Array(admitted.get(esp32S040Manifest.flashBoot.firmware.file)),
    firmwareBoot: {kind:ESP32S3_FLASH_BOOT_KIND,
      console:esp32S040Manifest.flashBoot.firmware.console,
      irom:new Uint8Array(admitted.get(`roms/${ESP32S3_FLASH_BOOT_ROMS.irom.filename}`)),
      drom:new Uint8Array(admitted.get(`roms/${ESP32S3_FLASH_BOOT_ROMS.drom.filename}`))},
    identity: {qualification: esp32S040Manifest.qualification,
      source: esp32S040Manifest.source, engineVersion: esp32S040Manifest.engine.version,
      files: files.map(({file, bytes, sha256}) => ({file, bytes, sha256}))}};
}

async function main () {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) {
    throw new Error('usage: node scripts/fetch-esp32s040-fixtures.mjs --out <directory>');
  }
  // Refuse before filesystem/network work while the manifest is provisional.
  const assets = esp32S040FixtureAssets();
  verifyEsp32S040Catalog();
  const out = resolve(args[1]);
  for (const asset of assets) {
    const destination = join(out, asset.file);
    const current = await readFile(destination).catch(() => null);
    if (current?.length === asset.bytes && sha256(current) === asset.sha256) {
      console.log(`verified ${asset.file}`);
      continue;
    }
    const bytes = await fetchPinned(asset);
    await mkdir(dirname(destination), {recursive: true});
    const temporary = `${destination}.tmp-${process.pid}`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    console.log(`fetched and verified ${asset.file}`);
  }
  await writeFile(join(out, 'engine/package.json'), '{"type":"commonjs"}\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
