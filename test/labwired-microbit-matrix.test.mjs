/**
 * The micro:bit's LED matrix on the labwired tier.
 *
 * The matrix is ON the micro:bit module, wired to internal nRF pins no circuit
 * part reaches, and CODAL drives its columns through GPIOTE (labwired-core
 * `led-matrix-mux`, which reads the pads GPIOTE drives). The bench manifest
 * therefore declares it — the one `external_devices` entry the bridge emits,
 * for a device on labwired's side of the pad — and the adapter copies the
 * engine's picture onto the micro:bit part's device state, where bw-circuit-ui's
 * face reads it.
 *
 * The engine half needs LABWIRED_WASM (a wasm-bindgen NODEJS out-dir) and
 * arm-none-eabi-gcc; without them it skips by name.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { decodeDisplay } from '../src/display-decode.js';
import { binToElf } from '../src/bin-to-elf.js';
import { buildLabwiredSystem } from '../src/labwired-bridge.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { MICROBIT_V2 } from '../src/labwired-chips.js';
import { LABWIRED_BOARDS } from '../src/labwired-catalog.js';

const px = (f, x, y) => [...f.rgba.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)];

describe('the micro:bit matrix, without an engine', () => {
    it('gray8 draws red LEDs by brightness, a dark one as a dim body', () => {
        const f = decodeDisplay({ format: 'gray8', width: 2, height: 1, bytes: [255, 0] });
        assert.deepEqual(px(f, 0, 0), [255, 40, 30, 255]);
        assert.deepEqual(px(f, 1, 0), [40, 0, 0, 255]);
    });

    it('a micro:bit bench declares its on-module matrix; other benches declare no devices', () => {
        const mb = buildLabwiredSystem({
            chipKind: 'microbit_v2',
            netlist: { parts: [{ id: 'mb', kind: 'microbit' }], nets: [] },
        });
        assert.ok(mb.ok, JSON.stringify(mb.refusals));
        assert.match(mb.systemYaml, /^external_devices:\n {2}- id: "led_matrix"\n {4}type: "led-matrix-mux"/m);
        assert.match(mb.systemYaml, /col_pins: \["P0\.28", "P0\.11", "P0\.31", "P1\.05", "P0\.30"\]/);
        const f0 = buildLabwiredSystem({
            chipKind: 'stm32f030',
            netlist: { parts: [{ id: 'u1', kind: 'stm32f030' }], nets: [] },
        });
        assert.doesNotMatch(f0.systemYaml ?? '', /external_devices/,
            'circuit parts stay our board\'s: no second model of them');
    });

    it('binToElf carries extra records (an nRF .hex UICR) as their own PT_LOADs', () => {
        const img = new Uint8Array(16);
        new DataView(img.buffer).setUint32(4, 0x101, true);
        const uicr = Uint8Array.of(0x00, 0x70, 0x07, 0x00, 0x00, 0xe0, 0x07, 0x00);
        const elf = binToElf(img, { loadAddress: 0, extraSegments: [{ address: 0x10001014, bytes: uicr }] });
        const dv = new DataView(elf.buffer, elf.byteOffset);
        assert.equal(dv.getUint16(44, true), 2, 'two program headers');
        const ph2 = 52 + 32;
        assert.equal(dv.getUint32(ph2 + 8, true), 0x10001014, 'p_vaddr of the UICR record');
        assert.equal(dv.getUint32(ph2 + 16, true), 8, 'p_filesz');
        const off = dv.getUint32(ph2 + 4, true);
        assert.deepEqual([...elf.subarray(off, off + 8)], [...uicr]);
        assert.deepEqual([...binToElf(img, { loadAddress: 0 })],
            [...binToElf(img, { loadAddress: 0, extraSegments: [] })], 'no extras: the same bytes as ever');
    });
});

const WASM_DIR = process.env.LABWIRED_WASM;
let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }
const skip = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir'
    : !hasGcc ? 'arm-none-eabi-gcc is not installed' : false;

// Row 1 (P0.21) driven high from the port; column 1 (P0.28) taken by GPIOTE
// channel 1 in Task mode at OUTINIT = 0 (lit), columns 2..5 at OUTINIT = 1.
// That is the shape CODAL's NRF52LedMatrix gives one row slot.
const FIRMWARE = `
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
#define P0_OUTSET 0x50000508u
#define P0_DIRSET 0x50000518u
#define GPIOTE_CONFIG(n) (0x40006510u + 4u * (n))
#define TASK(pin, port, outinit) (3u | ((pin) << 8) | ((port) << 13) | (3u << 16) | ((outinit) << 20))
extern uint32_t _estack;
void reset(void);
__attribute__((section(".vectors"))) const void *vectors[2] = { &_estack, reset };
void reset(void) {
    REG(P0_DIRSET) = 1u << 21;
    REG(P0_OUTSET) = 1u << 21;
    REG(GPIOTE_CONFIG(1)) = TASK(28, 0, 0);
    REG(GPIOTE_CONFIG(2)) = TASK(11, 0, 1);
    REG(GPIOTE_CONFIG(3)) = TASK(31, 0, 1);
    REG(GPIOTE_CONFIG(4)) = TASK(5, 1, 1);
    REG(GPIOTE_CONFIG(5)) = TASK(30, 0, 1);
    for (;;) { __asm volatile ("nop"); }
}
`;
const LD = `
MEMORY { FLASH (rx) : ORIGIN = 0x00000000, LENGTH = 512K
         RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K }
_estack = ORIGIN(RAM) + LENGTH(RAM);
SECTIONS { .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH }
`;

function buildFirmware () {
    const dir = mkdtempSync(join(tmpdir(), 'lw-mbmatrix-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m4', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c')],
    { stdio: 'pipe' });
    return new Uint8Array(readFileSync(join(dir, 'fw.elf')));
}

describe('the micro:bit matrix on the real engine', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    const firmware = skip ? null : buildFirmware();
    const board = LABWIRED_BOARDS['microbit-v2'];

    it('the catalog offers microbit-v2 with its matrix as a drawable display', () => {
        assert.ok(board, 'microbit-v2 is a labwired board at the PIN');
        assert.deepEqual(board.displays, [{ id: 'led_matrix', type: 'led-matrix-mux' }]);
    });

    it('the engine\'s picture reaches the micro:bit part\'s device state', () => {
        const state = {};
        const fakeBoard = {
            getDeviceState: (id) => (id === 'mb' ? state : null),
            setPin () {}, advanceTo () {}, readPin: () => 0, readAnalog: () => 0,
        };
        const adapter = createLabwiredAdapter({
            wasm, chipYaml: MICROBIT_V2.chipYaml, systemYaml: board.systemYaml, firmware,
            firmwareOnly: true, clockHz: MICROBIT_V2.clockHz, name: 'mb-matrix-test',
            boardMatrix: { display: 'led_matrix', partId: 'mb' },
        });
        adapter.attachBoard(fakeBoard);
        adapter.advanceNs(60_000_000n);   // 60 ms: past one 20 ms persistence window
        assert.ok(state.matrix, 'the adapter published a matrix onto the part');
        assert.deepEqual([state.matrix.width, state.matrix.height], [5, 5]);
        assert.equal(state.matrix.levels[0], 9, 'pixel (0,0): row 1 x column 1 is lit');
        assert.deepEqual([...state.matrix.levels.slice(1)], new Array(24).fill(0),
            'nothing else is lit');
    });
});
