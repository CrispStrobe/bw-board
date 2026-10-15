/**
 * The F030 heavy tier runs the generated clock bring-up (RM0360 §6.2.3):
 * FLASH_ACR = LATENCY 1 | PRFTBE, CFGR PLLSRC = HSI/2 + PLLMUL ×12, CR.PLLON,
 * wait CR.PLLRDY, CFGR.SW = PLL, wait CFGR.SWS = PLL — then drives PA0.
 *
 * Before the chip description carried the engine's RCC and FLASH models, the
 * FLASH_ACR store hit unmapped memory and RCC answered 0 forever, so a
 * generated program never got past its clock init. Real engine, assembled
 * guest; not a silicon clock-tree or timing claim.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildLabwiredSystem} from '../src/labwired-bridge.js';
import {createLabwiredAdapter, plain} from '../src/labwired-adapter.js';
import {STM32F0_CHIP_YAML} from '../src/labwired-chips.js';

const nodeDir = process.env.LABWIRED_WASM;
let toolchain = true;
try { execFileSync('arm-none-eabi-gcc', ['--version'], {stdio: 'pipe'}); } catch { toolchain = false; }
const skip = !nodeDir ? 'F0 clock requires a verified LABWIRED_WASM artifact'
    : !toolchain ? 'F0 clock requires arm-none-eabi-gcc' : false;
if (skip && process.env.LABWIRED_F0_REQUIRED === '1') throw Error(skip);
const wasm = skip ? null : createRequire(import.meta.url)(join(nodeDir, 'labwired_wasm.js'));
const fixture = fileURLToPath(new URL('./fixtures/labwired/f0-clock/', import.meta.url));

test('the F030 chip description maps RCC and FLASH to engine models, not a stub', () => {
    assert.match(STM32F0_CHIP_YAML, /- id: rcc\n(?:\s*#.*\n)*\s*type: rcc\n/);
    assert.match(STM32F0_CHIP_YAML, /- id: flash_ctrl\n(?:\s*#.*\n)*\s*type: flash\n\s*base_address: 1073881088\n/);
    assert.doesNotMatch(STM32F0_CHIP_YAML, /id: rcc\n\s*type: pythonperipheral/);
});

test('generated PLL bring-up completes and PA0 toggles on the real engine', {skip}, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bw-f0-clock-'));
    const output = join(directory, 'clock.elf');
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-nostdlib',
        '-Wl,--build-id=none,-T,clock.ld', 'clock.S', '-o', output], {cwd: fixture, stdio: 'pipe'});
    const built = buildLabwiredSystem({chipKind: 'stm32f030',
        netlist: {parts: [{id: 'f0', kind: 'stm32f030'}], nets: []}});
    assert.equal(built.ok, true);
    const adapter = createLabwiredAdapter({wasm, chipYaml: built.chipYaml, systemYaml: built.systemYaml,
        firmware: new Uint8Array(readFileSync(output)), firmwareOnly: true, clockHz: built.clockHz});
    const word = (address) => {
        const b = adapter.sim.read_memory(address, 4);
        return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
    };
    let toggles = 0;
    for (let i = 0; i < 20 && toggles < 10; i++) {
        adapter.sim.step_batch(10_000);
        toggles = word(0x20000004);
    }
    assert.equal(word(0x20000000), 4, 'guest passed PLLRDY and SWS waits (stage 4)');
    assert.ok(toggles >= 10, `PA0 loop running, ${toggles} toggles`);
    const cr = word(0x40021000), cfgr = word(0x40021004);
    assert.notEqual(cr & (1 << 24), 0, 'PLLON set');
    assert.notEqual(cr & (1 << 25), 0, 'PLLRDY follows PLLON');
    assert.equal((cfgr >> 2) & 3, 2, 'SWS = PLL');
    assert.equal((cfgr >> 18) & 0xF, 10, 'PLLMUL ×12 kept');
    assert.equal(word(0x40022000) & 0x17, 0x11, 'FLASH_ACR LATENCY 1 | PRFTBE read back');
    const odr = plain(adapter.sim.get_peripheral_snapshot('gpioPortA')).odr;
    assert.ok(Number.isInteger(odr), 'actual GPIO snapshot');
});
