import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { avrBinToElf } from '../src/bin-to-elf.js';
import { ATMEGA328P_CHIP_YAML } from '../src/labwired-chips.js';

describe('LabWired AVR admission', () => {
    it('wraps raw AVR bytes as AVR ELF, never ARM ELF', () => {
        const elf = avrBinToElf(new Uint8Array([0x00, 0xc0]));
        const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
        assert.equal(view.getUint16(18, true), 83, 'ELF e_machine is EM_AVR');
        assert.equal(view.getUint32(24, true), 0, 'AVR reset entry is flash byte zero');
        assert.deepEqual([...elf.slice(84)], [0x00, 0xc0]);
    });

    it('hands the architecture-correct wrapper to LabWired', () => {
        let firmware;
        const sim = {
            recommended_tick_interval: () => 1,
            set_peripheral_tick_interval: () => {},
            watch_logic_signals: () => [],
        };
        createLabwiredAdapter({
            wasm: { WasmSimulator: { new_from_config: (_system, _chip, bytes) => {
                firmware = bytes;
                return sim;
            } } },
            chipYaml: ATMEGA328P_CHIP_YAML,
            firmware: new Uint8Array([0x00, 0xc0]),
            pins: { D13: { peripheral: 'portb', pin: 5 } },
        });
        assert.equal(new DataView(firmware.buffer, firmware.byteOffset).getUint16(18, true), 83);
    });
});

describe('LabWired raw ARM placement', () => {
    it('preserves a PyBadge application offset in the generated ELF segment', () => {
        let firmware;
        const sim = {
            recommended_tick_interval: () => 1,
            set_peripheral_tick_interval: () => {},
            watch_logic_signals: () => [],
        };
        const raw = new Uint8Array(8);
        new DataView(raw.buffer).setUint32(4, 0x00004101, true);
        createLabwiredAdapter({
            wasm: { WasmSimulator: { new_from_config: (_system, _chip, bytes) => {
                firmware = bytes;
                return sim;
            } } },
            chipYaml: 'name: samd51\narch: arm\n',
            firmware: raw,
            firmwareAddress: 0x4000,
            pins: { d13: { peripheral: 'porta', pin: 23 } },
        });
        const view = new DataView(firmware.buffer, firmware.byteOffset);
        assert.equal(view.getUint32(24, true), 0x00004101, 'ELF entry comes from app vector');
        assert.equal(view.getUint32(52 + 8, true), 0x4000, 'PT_LOAD address preserves UF2 base');
    });
});
