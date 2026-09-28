import { it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToSegments, s110AppRegionElf } from '../src/hex-app-region.js';

/** One Intel HEX record with its checksum. */
const rec = (type, addr, data) => {
    const b = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
    const cs = (-b.reduce((s, x) => s + x, 0)) & 0xff;
    return ':' + [...b, cs].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
};
// SoftDevice bytes at 0x0, the app at 0x18000 (vector table: SP, reset 0x18101),
// a UICR record at 0x1000_1014 via an extended linear record.
const HEX = [
    rec(0x00, 0x0000, [0xAA, 0xBB, 0xCC, 0xDD]),                      // SoftDevice: must be dropped
    rec(0x04, 0x0000, [0x00, 0x01]),                                  // base 0x10000
    rec(0x00, 0x8000, [0x00, 0x40, 0x00, 0x20, 0x01, 0x81, 0x01, 0x00]),  // 0x18000: SP, reset
    rec(0x00, 0x8008, [0x70, 0x47]),                                  // 0x18008: bx lr
    rec(0x04, 0x0000, [0x10, 0x00]),                                  // base 0x1000_0000
    rec(0x00, 0x1014, [0x00, 0x00, 0x03, 0x00]),                      // UICR: dropped
    rec(0x01, 0x0000, []),
].join('\n');

it('parses extended linear records into address-ordered segments', () => {
    const segs = hexToSegments(HEX);
    assert.deepEqual(segs.map(s => [s.addr, s.data.length]), [[0x0, 4], [0x18000, 10], [0x10001014, 4]]);
});

it('keeps only the application window; the entry is the app\'s own reset vector', () => {
    const { elf, dropped } = s110AppRegionElf(HEX);
    const dv = new DataView(elf.buffer);
    assert.equal(dv.getUint16(18, true), 40, 'EM_ARM');
    assert.equal(dv.getUint32(24, true), 0x00018101, 'entry = word 1 at 0x18000');
    assert.equal(dv.getUint16(44, true), 1, 'one segment: the app');
    assert.equal(dv.getUint32(52 + 8, true), 0x18000);
    assert.equal(dropped, 8, 'the SoftDevice and UICR bytes never reach the engine');
    const payload = elf.subarray(dv.getUint32(52 + 4, true), dv.getUint32(52 + 4, true) + dv.getUint32(52 + 16, true));
    assert.ok(!payload.includes(0xAA), 'no SoftDevice byte in the image');
});

it('a V2 universal hex (block records) or a hex with no app is refused by name', () => {
    assert.throws(() => hexToSegments(rec(0x0a, 0, [0x99, 0x01, 0xc0, 0xde])), /universal hex/);
    assert.throws(() => s110AppRegionElf(rec(0x00, 0x0000, [1, 2, 3, 4]) + '\n' + rec(0x01, 0, [])), /no S110 application/);
    assert.throws(() => hexToSegments(':0400000001020304FF'), /checksum/);
});

import { createDebugTarget } from '../src/debug-target-factory.js';
import { LABWIRED_CATALOG } from '../src/labwired-catalog.js';

it('an S110 board: the hex becomes the app ELF and the SoftDevice is attached on every build', async () => {
    const built = [];
    const attached = [];
    const sim = {
        get_pc: () => 0x18100,
        attach_softdevice_s110: node => attached.push(node),
        read_logic_edges: () => ({ cursor: 0, dropped: 0, nowCycle: 0, edges: [] }),
    };
    const wasm = { WasmSimulator: { new_from_config: (sys, chip, fw) => { built.push(fw); return sim; } } };
    // The engine's nRF51 chip joins the catalog with the pin bump; any catalog
    // chip stands in for it here -- the S110 path is the board's, not the chip's.
    const chip = LABWIRED_CATALOG.nrf52840;
    const board = { name: 'microbit-v1', chip: chip.name, softdevice: 's110', displays: [], systemYaml: 'name: "microbit-v1"\n' };
    const { adapter } = await createDebugTarget('labwired', { wasm, chip, labwiredBoard: board, firmware: HEX });
    assert.deepEqual([...built[0].subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], 'the engine gets an ELF, not the hex');
    assert.deepEqual(attached, ['microbit-v1']);
    adapter.resetToProgram();
    assert.deepEqual(attached, ['microbit-v1', 'microbit-v1'], 'a reset rebuilds and re-attaches');
});

it('an engine without the SoftDevice emulation is refused by name', async () => {
    const wasm = { WasmSimulator: { new_from_config: () => ({ get_pc: () => 0 }) } };
    const chip = LABWIRED_CATALOG.nrf52840;
    const board = { name: 'microbit-v1', chip: chip.name, softdevice: 's110', displays: [], systemYaml: 'name: "m"\n' };
    await assert.rejects(createDebugTarget('labwired', { wasm, chip, labwiredBoard: board, firmware: HEX }),
        /cannot emulate the S110 SoftDevice/);
});
