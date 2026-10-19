// A real clang supervisor-mode program boots the whole step-4 stack on the
// machine: M-mode start-up enables Sv32 paging + trap delegation and drops to
// S-mode (mret); the S-mode code runs *through* the page table and uses the
// machine's SBI firmware (an OpenSBI-lite) to print and shut down. Proves M->S,
// Sv32 translation on every access, and the SBI console/shutdown together — the
// foundation a real kernel (xv6/Linux) boots on. Built rv32ima (no compressed
// ISA); see test/fixtures/riscv-smode/ for the sources and build.sh.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const elf = new Uint8Array(Buffer.from(
    readFileSync(join(here, 'fixtures/riscv-smode/smode-demo.elf.b64'), 'utf8').trim(), 'base64'));

test('a clang S-mode kernel boots with Sv32 paging and prints via SBI', () => {
    let out = '';
    // RAM at 0x80000000 (supervisor images link there); the machine supplies the
    // SBI firmware, so no ecallTraps — the S-mode ecall goes to the firmware.
    const m = new RiscV32Machine({memSize: 1 << 22, ramBase: 0x80000000}, {onSerial: b => out += String.fromCharCode(b)});
    loadElfInto(m, elf);
    m.run(2_000_000);

    assert.ok(out.includes('Hello from S-mode'), `S-mode code ran and printed via SBI: ${JSON.stringify(out.slice(0, 40))}`);
    assert.ok(out.includes('paging: ON'), 'satp shows Sv32 active — the kernel really is paged in supervisor mode');
    assert.ok(out.includes('DONE'), 'reached the end');
    assert.equal(m.exitCode, 0, 'clean SBI shutdown');
    assert.ok(m.halted, 'the machine stopped via the SBI shutdown call');
});
