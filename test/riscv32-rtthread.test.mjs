// A real RT-Thread Nano image boots and multitasks on the emulated RISC-V SoC —
// a second, independent RTOS on the same RV32IMA + SiFive-CLINT + NS16550-UART
// map, proving the SoC is not FreeRTOS-specific.
//
// Notably RT-Thread needs NO ecallTraps: its cooperative switch (rt_hw_context_
// switch) is a direct save/restore + mret, and preemption happens in trap_entry
// off the CLINT timer interrupt. So this boots on the plain machine, exercising
// a different context-switch design than the FreeRTOS demo.
//
// rtthread-demo.elf.b64 is RT-Thread Nano (Apache-2.0), cross-built with
// clang+lld for our map (sources + build.sh in test/fixtures/riscv-rtthread/),
// committed as a stripped base64 ELF so the test needs no toolchain.
//
// The demo: main() (priority 10) prints 'H' then rt_thread_mdelay(5); a "wrk"
// thread (priority 12) prints 'L' every tick while main is blocked, and main
// PREEMPTS it (higher priority) when its delay expires. Output is the RT-Thread
// banner, then interleaved H/L, then DONE, then L forever.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const elf = new Uint8Array(Buffer.from(
    readFileSync(join(here, 'fixtures/riscv-rtthread/rtthread-demo.elf.b64'), 'utf8').trim(), 'base64'));

function boot(maxInstr) {
    let out = '';
    const m = new RiscV32Machine({memSize: 1 << 20}, {onSerial: b => out += String.fromCharCode(b)});
    loadElfInto(m, elf);
    m.run(maxInstr);
    return out;
}

test('RT-Thread Nano boots the kernel and runs main() + a worker thread', () => {
    const out = boot(2_000_000);
    assert.ok(out.includes('RT-Thread'), `expected the RT-Thread banner, got ${JSON.stringify(out.slice(0, 40))}`);
    assert.equal((out.match(/H/g) || []).length, 5, 'main() ran its five iterations');
    assert.ok(out.includes('DONE'), 'main() reached DONE (its five rt_thread_mdelay()s resolved -> the CLINT tick works)');
    assert.ok((out.match(/L/g) || []).length > 5, 'the worker thread ran too');
});

test('preemptive scheduling: the worker runs between main\'s delays, main preempts it', () => {
    const out = boot(2_000_000);
    const firstH = out.indexOf('H'), lastH = out.lastIndexOf('H');
    assert.ok(out.slice(firstH, lastH).includes('L'),
        `expected interleaved H/L (preemption), got ${JSON.stringify(out.slice(firstH, lastH + 1))}`);
});

test('after main() exits, the worker thread keeps running', () => {
    const out = boot(2_000_000);
    const afterDone = out.slice(out.indexOf('DONE') + 4);
    assert.ok(!afterDone.includes('H'), 'no more H after DONE (main exited)');
    assert.ok(afterDone.includes('L'), 'the worker continues');
});
