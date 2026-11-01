#!/usr/bin/env node
/** Fetch only hash- and size-pinned M1 evidence; no toolchain or engine build. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESP32S3_FLASH_BOOT_ROMS, ESP32S3_FLASH_BOOT_ROM_SOURCE } from '../src/labwired-firmware-boot.js';
import { LABWIRED_CATALOG_PIN } from '../src/labwired-catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const fixtureManifest = JSON.parse(await readFile(
  join(root, 'test/fixtures/labwired/esp32s3-flash/manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function fixtureAssets () {
  const m = fixtureManifest;
  if (m.sourceCommit !== ESP32S3_FLASH_BOOT_ROM_SOURCE.commit ||
      m.sourceRepository !== ESP32S3_FLASH_BOOT_ROM_SOURCE.repository ||
      m.engine.sourceCommit !== LABWIRED_CATALOG_PIN) {
    throw new Error('ESP32-S3 fixture, ROM and catalog source identities disagree');
  }
  return [
    ...Object.values(ESP32S3_FLASH_BOOT_ROMS).map(rom => ({ ...rom, file: `roms/${rom.filename}` })),
    ...m.firmware.map(fw => ({ ...fw,
      url: `https://raw.githubusercontent.com/${m.sourceRepository}/${m.sourceCommit}/${fw.sourcePath}` })),
    ...m.engine.assets.map(asset => ({ ...asset,
      url: `https://github.com/${m.engine.releaseRepository}/releases/download/${m.engine.releaseTag}/${asset.asset}` })),
  ];
}

/** Size bounds apply while streaming, before allocating a complete response. */
export async function fetchPinned (asset, fetchImpl = fetch) {
  const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${asset.file}: HTTP ${response.status}`);
  if (!response.body) throw new Error(`${asset.file}: response has no body`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > asset.bytes) throw new Error(`${asset.file}: response exceeds pinned byte length`);
    chunks.push(chunk);
  }
  if (length !== asset.bytes) throw new Error(`${asset.file}: response has the wrong byte length`);
  const bytes = Buffer.concat(chunks, length);
  if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.file}: SHA-256 mismatch`);
  return bytes;
}

async function main () {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) {
    throw new Error('usage: node scripts/fetch-esp32s3-firmware-fixtures.mjs --out <directory>');
  }
  const out = resolve(args[1]);
  for (const asset of fixtureAssets()) {
    const destination = join(out, asset.file);
    const current = await readFile(destination).catch(() => null);
    if (current && current.length === asset.bytes && sha256(current) === asset.sha256) {
      console.log(`verified ${asset.file}`);
      continue;
    }
    const bytes = await fetchPinned(asset);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    console.log(`fetched and verified ${asset.file}`);
  }
  // The retained glue is the wasm-bindgen Node/CommonJS target even when
  // the caller keeps these inputs underneath an ESM package directory.
  await writeFile(join(out, 'engine/package.json'), '{"type":"commonjs"}\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
