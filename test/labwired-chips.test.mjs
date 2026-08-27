/**
 * The two copies of the F0 machine definition must not drift.
 *
 * The labwired CLI reads a chip descriptor as a FILE (the differential oracle
 * hands it a path); a browser constructs with it as a STRING. So the same
 * silicon is described twice, and if those two ever disagree the oracle and the
 * shipping tier are comparing different machines — while both look healthy,
 * which is the failure mode worth spending a test on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STM32F0_CHIP_YAML, STM32F0_LABWIRED_PINS, STM32F0 } from '../src/labwired-chips.js';
import { STM32F0_PINS } from '../src/stm32-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('labwired chip descriptors', () => {
    it('the embedded YAML is byte-identical to the oracle fixture', () => {
        const fixture = readFileSync(join(root, 'test/fixtures/labwired/stm32f0-chip.yaml'), 'utf8');
        assert.equal(STM32F0_CHIP_YAML, fixture,
            'src/labwired-chips.js has drifted from the fixture. Regenerate it: '
            + 'node scripts/gen-labwired-chips.mjs');
    });

    it('every GPIO port keeps the V2 profile', () => {
        // Losing this is silent and total: stm32_gpioport routes to the STM32F1
        // register map, so every output write lands on a different register and
        // every pad reads low forever while the firmware runs and the UART talks.
        const ports = (STM32F0_CHIP_YAML.match(/type: stm32_gpioport/g) || []).length;
        const profiles = (STM32F0_CHIP_YAML.match(/profile: stm32v2/g) || []).length;
        assert.ok(ports > 0, 'no GPIO ports in the descriptor at all');
        assert.equal(profiles, ports,
            `${ports} GPIO ports but ${profiles} carry profile: stm32v2`);
    });

    it('both tiers offer a project the same pins', () => {
        // A design that runs on the light tier must not silently lose I/O on
        // the heavy one, so the header maps have to name the same pads.
        assert.deepEqual(
            Object.keys(STM32F0_LABWIRED_PINS).sort(),
            Object.keys(STM32F0_PINS).sort(),
            'the labwired and CortexM0Machine pin maps disagree');
    });

    it('the pin map addresses the ports the descriptor declares', () => {
        for (const [name, def] of Object.entries(STM32F0_LABWIRED_PINS)) {
            assert.match(STM32F0_CHIP_YAML, new RegExp(`id: ${def.peripheral}\\b`),
                `${name} names peripheral '${def.peripheral}', which the chip descriptor does not declare`);
        }
    });

    it('STM32F0 bundles what a caller needs', () => {
        assert.equal(STM32F0.chipYaml, STM32F0_CHIP_YAML);
        assert.equal(STM32F0.clockHz, 48_000_000);
        assert.ok(Object.keys(STM32F0.pins).length > 0);
    });
});
