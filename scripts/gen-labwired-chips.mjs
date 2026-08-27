#!/usr/bin/env node
/**
 * Regenerate src/labwired-chips.js from the oracle's chip fixture.
 *
 * The machine definition has to exist twice: as a FILE the labwired CLI reads
 * (the differential oracle passes it a path) and as a STRING the browser tier
 * constructs with (a browser cannot read a fixture off disk). Two copies that
 * can drift is how the two tiers end up disagreeing about the silicon while
 * both look healthy — so the fixture is the source, this generates the module,
 * and test/labwired-chips.test.mjs fails if they differ.
 *
 *   node scripts/gen-labwired-chips.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'test/fixtures/labwired/stm32f0-chip.yaml');
const target = join(root, 'src/labwired-chips.js');
const check = process.argv.includes('--check');

const yaml = readFileSync(fixture, 'utf8');
// Backslash first, or the escapes we add get escaped again.
const esc = yaml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const current = readFileSync(target, 'utf8');
const marker = 'export const STM32F0_CHIP_YAML = `';
const start = current.indexOf(marker);
if (start === -1) throw new Error(`${target}: no STM32F0_CHIP_YAML literal to replace`);
const from = start + marker.length;
const to = current.indexOf('`;', from);
if (to === -1) throw new Error(`${target}: unterminated STM32F0_CHIP_YAML literal`);

const next = current.slice(0, from) + esc + current.slice(to);
if (next === current) {
    console.log('labwired-chips: up to date.');
    process.exit(0);
}
if (check) {
    console.error('labwired-chips: src/labwired-chips.js is STALE — run: node scripts/gen-labwired-chips.mjs');
    process.exit(1);
}
writeFileSync(target, next);
console.log(`labwired-chips: regenerated from ${fixture.replace(root, '.')}`);
