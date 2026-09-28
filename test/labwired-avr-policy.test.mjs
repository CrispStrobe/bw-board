import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { ATMEGA328P_CHIP_YAML } from '../src/labwired-chips.js';

describe('LabWired AVR admission', () => {
    it('refuses a raw AVR image instead of wrapping it as an ARM ELF', () => {
        assert.throws(() => createLabwiredAdapter({
            wasm: { WasmSimulator: {} },
            chipYaml: ATMEGA328P_CHIP_YAML,
            firmware: new Uint8Array([0x00, 0xc0]),
            pins: { D13: { peripheral: 'portb', pin: 5 } },
        }), /AVR firmware must be an ELF/);
    });
});
