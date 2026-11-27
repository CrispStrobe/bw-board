#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {
  microtronicNativeMonitorLayout, microtronicNativeMonitorRom, microtronicNativeMonitorSymbols
} from '../src/microtronic-native-monitor.js';

const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  console.error('Usage: node scripts/build-microtronic-native-rom.mjs <output.rom>');
  process.exitCode = 1;
} else {
  const sha256 = createHash('sha256').update(microtronicNativeMonitorRom).digest('hex');
  const profile = {
    version: 1,
    sha256,
    layout: microtronicNativeMonitorLayout,
    symbols: microtronicNativeMonitorSymbols
  };
  await writeFile(output, microtronicNativeMonitorRom);
  await writeFile(`${output}.symbols.json`, JSON.stringify(profile, null, 2) + '\n');
  console.log(`${sha256}  ${output}`);
}
