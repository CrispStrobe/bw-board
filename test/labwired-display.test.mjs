/**
 * Labwired displays reach video(): the engine's own pixel formats decoded to
 * the RGBA frame every video() returns, and labwired boards with a display
 * offered from the pinned engine's own system manifests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDisplay } from '../src/display-decode.js';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { LABWIRED_CATALOG, LABWIRED_BOARDS } from '../src/labwired-catalog.js';
import { CATALOG_CHIPS, DECODABLE_DISPLAY, externalDevices } from '../scripts/gen-labwired-catalog.mjs';

const px = (f, x, y) => [...f.rgba.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)];

describe('decodeDisplay', () => {
    it('page-packed OLED: byte page*w+x, bit k is row page*8+k', () => {
        const bytes = new Uint8Array(8 * 2);   // 8 wide, 16 tall = 2 pages
        bytes[0 * 8 + 3] = 0b0000_0100;        // (3, 2)
        bytes[1 * 8 + 5] = 0b1000_0000;        // (5, 15)
        const f = decodeDisplay({ format: 'ssd1306_page', width: 8, height: 16, bytes });
        assert.deepEqual(px(f, 3, 2), [230, 240, 255, 255]);
        assert.deepEqual(px(f, 5, 15), [230, 240, 255, 255]);
        assert.deepEqual(px(f, 3, 3), [0, 0, 0, 255]);
    });
    it('a PCD8544 LCD draws dark ink on a light panel', () => {
        const f = decodeDisplay({ format: 'pcd8544_bank', width: 1, height: 8, bytes: [1] });
        assert.deepEqual(px(f, 0, 0), [20, 30, 20, 255]);
        assert.deepEqual(px(f, 0, 1), [170, 190, 160, 255]);
    });
    it('RGB565 big-endian', () => {
        const f = decodeDisplay({ format: 'rgb565_be', width: 2, height: 1, bytes: [0xf8, 0x00, 0x07, 0xe0] });
        assert.deepEqual(px(f, 0, 0), [255, 0, 0, 255]);
        assert.deepEqual(px(f, 1, 0), [0, 255, 0, 255]);
    });
    it('RGB888 preserves the engine\'s reported controller-memory channels', () => {
        const f = decodeDisplay({format: 'rgb888', width: 2, height: 1,
            bytes: [255, 138, 48, 0, 48, 170], meta: {unknown_pixels: 0}});
        assert.deepEqual(px(f, 0, 0), [255, 138, 48, 255]);
        assert.deepEqual(px(f, 1, 0), [0, 48, 170, 255]);
    });
    it('RGB888 refuses unknown, incomplete and invalid pixel data', () => {
        const d = {format: 'rgb888', width: 1, height: 1, bytes: [1, 2, 3]};
        assert.match(decodeDisplay({...d, meta: {unknown_pixels: 1}}).refused, /unknown/);
        assert.match(decodeDisplay({...d, bytes: [1, 2]}).refused, /incomplete/);
        assert.match(decodeDisplay({...d, bytes: [1, 2, 300]}).refused, /invalid/);
    });
    it('an undrawable format or missing geometry is refused, never guessed', () => {
        assert.match(decodeDisplay({ format: 'epaper_tricolor_1bpp_planes', width: 8, height: 8, bytes: [0] }).refused, /does not draw/);
        assert.match(decodeDisplay({ format: 'ssd1306_page', width: null, height: 8, bytes: [0] }).refused, /geometry/);
    });
});

describe('video() on a labwired target with a board display', () => {
    const simWith = (state) => ({
        get_pc: () => 0, step_single() {}, step_batch() {},
        get_display: (id, withBytes) => {
            state.calls.push([id, withBytes]);
            return { id, kind: 'framebuffer', format: 'ssd1306_page', width: 8, height: 8,
                bytes: withBytes ? state.bytes : undefined, meta: { generation: String(state.gen) } };
        },
    });
    const make = (state, displays) => createLabwiredDebugTarget({ displays, adapter: {
        sim: simWith(state), clockHz: 160_000_000, timeNs: () => 0n, pump() {} } });

    it('draws the first display and re-decodes only when the engine\'s generation changes', () => {
        const state = { gen: 1, bytes: [1, 0, 0, 0, 0, 0, 0, 0], calls: [] };
        const t = make(state, [{ id: 'oled', type: 'oled-ssd1306' }]);
        const a = t.video();
        assert.deepEqual([a.width, a.height, a.signal], [8, 8, true]);
        assert.deepEqual(px(a, 0, 0), [230, 240, 255, 255]);
        assert.equal(t.video(), a, 'same generation: the cached frame, no pixel pull');
        state.gen = 2; state.bytes = [0, 0, 0, 0, 0, 0, 0, 0];
        const b = t.video();
        assert.notEqual(b, a);
        assert.deepEqual(px(b, 0, 0), [0, 0, 0, 255]);
        assert.equal(b.frame, a.frame + 1);
        assert.equal(state.calls.filter(c => c[1]).length, 2, 'pixels pulled twice, not per call');
    });
    it('no board display: null, not a black frame', () => {
        assert.equal(make({ gen: 1, bytes: [], calls: [] }, undefined).video(), null);
    });
    it('withholds unknown RGB888 pixels until the engine reports them known', () => {
        let unknown = 1;
        const sim = {get_pc: () => 0, get_display: (_id, withBytes) => ({
            format: 'rgb888', width: 1, height: 1,
            bytes: withBytes ? [255, 138, 48] : undefined,
            meta: {generation: String(1 - unknown), unknown_pixels: unknown}
        })};
        const t = createLabwiredDebugTarget({displays: [{id: 'controller_memory'}],
            adapter: {sim, clockHz: 120_000_000, timeNs: () => 0n, pump() {}}});
        assert.equal(t.video(), null);
        unknown = 0;
        assert.deepEqual(px(t.video(), 0, 0), [255, 138, 48, 255]);
    });
});

describe('labwired boards with a display', () => {
    it('come from the pinned engine\'s manifests, on catalog chips, with drawable displays', () => {
        assert.ok(Object.keys(LABWIRED_BOARDS).length >= 1);
        for (const b of Object.values(LABWIRED_BOARDS)) {
            assert.ok(CATALOG_CHIPS.includes(b.chip), b.name);
            assert.deepEqual(externalDevices(b.systemYaml).filter(d => DECODABLE_DISPLAY.test(d.type)), b.displays, b.name);
        }
    });
    it('the factory builds a board on its own chip and refuses a mismatch', async () => {
        // A board that needs no SoftDevice: this stand-in engine has none to
        // attach, and the first catalog entry is now an S110 board.
        const board = Object.values(LABWIRED_BOARDS).find(b => !b.softdevice);
        assert.ok(board, 'the catalog has a board without a SoftDevice');
        const built = [];
        const wasm = { WasmSimulator: { new_from_config: (sys, chip) => { built.push({ sys, chip }); return { get_pc: () => 0 }; } } };
        const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, ...new Array(45).fill(0)]);
        await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG[board.chip], labwiredBoard: board, firmware: elf });
        assert.equal(built[0].sys, board.systemYaml, 'the board\'s own manifest, devices and all');
        const other = board.chip === 'stm32f103' ? 'nrf52840' : 'stm32f103';
        await assert.rejects(createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG[other], labwiredBoard: board, firmware: elf }),
            /is built on/);
    });
});
