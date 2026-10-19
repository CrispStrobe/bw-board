// A real FreeRTOS image boots and multitasks on the emulated RISC-V SoC.
//
// freertos-demo.elf.b64 is FreeRTOS-Kernel V11.1.0 (MIT), cross-built with
// clang+lld for our RV32IMA + SiFive-CLINT + NS16550-UART memory map (see
// test/fixtures/riscv-freertos/ for the sources, linker script and build.sh).
// It is committed as a stripped, base64 ELF so this test needs no toolchain —
// the same "fixture, not toolchain" pattern as the clang cross-checks.
//
// The demo runs two tasks: "hi" (priority 2) prints 'H' then vTaskDelay()s five
// times and prints DONE; "lo" (priority 1) never blocks and prints 'L'. The
// output is the proof of preemptive multitasking on this machine:
//   - the scheduler starts (BOOT -> task output),
//   - the CLINT timer tick drives vTaskDelay (the five delays resolve),
//   - ecall-based yield reaches FreeRTOS's own mtvec trap handler (needs the
//     machine's ecallTraps mode),
//   - "lo" runs while "hi" is blocked (L between the H's), and "hi" PREEMPTS
//     "lo" the instant its delay expires (each H interrupts the L stream).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const elf = new Uint8Array(Buffer.from(
    readFileSync(join(here, 'fixtures/riscv-freertos/freertos-demo.elf.b64'), 'utf8').trim(), 'base64'));

function boot(maxInstr) {
    let out = '';
    // ecallTraps: FreeRTOS yields via ecall and installs its own trap handler,
    // so ECALL must be a real M-mode exception rather than the Linux write/exit ABI.
    const m = new RiscV32Machine({memSize: 1 << 20, ecallTraps: true}, {onSerial: b => out += String.fromCharCode(b)});
    loadElfInto(m, elf);
    m.run(maxInstr);
    return {out, m};
}

test('FreeRTOS boots the scheduler and both tasks run', () => {
    const {out} = boot(600_000);
    assert.ok(out.startsWith('BOOT\n'), `expected a BOOT banner, got ${JSON.stringify(out.slice(0, 16))}`);
    assert.equal((out.match(/H/g) || []).length, 5, 'the high task ran its five iterations');
    assert.ok(out.includes('DONE'), 'the high task reached DONE (its five vTaskDelay()s all resolved -> the timer tick works)');
    assert.ok((out.match(/L/g) || []).length > 5, 'the low task ran too');
});

test('preemptive scheduling: the low task runs between the high task\'s delays', () => {
    const {out} = boot(600_000);
    const firstH = out.indexOf('H'), lastH = out.lastIndexOf('H');
    // An 'L' between the first and last 'H' means "lo" got the CPU while "hi" was
    // blocked in vTaskDelay, and "hi" then preempted it (higher priority) on wake.
    assert.ok(out.slice(firstH, lastH).includes('L'),
        `expected interleaved H/L (preemption), got ${JSON.stringify(out.slice(0, 24))}`);
});

test('after the high task suspends itself, the low task keeps running', () => {
    const {out} = boot(600_000);
    const afterDone = out.slice(out.indexOf('DONE') + 4);
    assert.ok(!afterDone.includes('H'), 'no more H after DONE (hi suspended itself)');
    assert.ok(afterDone.includes('L'), 'lo continues to run');
});
