// The PLIC closes the interrupt story: external (device) interrupts. ECHO_O is a
// committed clang object that configures the PLIC (priority/enable/threshold),
// enables MEIE+MIE, and echoes UART input via an external-interrupt handler
// (claim -> read RBR -> echo -> complete). Three pushed keystrokes come back
// echoed, then main prints "OK". Proves core + PLIC (word MMIO) + UART RX line +
// external-interrupt entry together.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32, INTERRUPT} from '../src/riscv32.js';
import {createPlic} from '../src/riscv32-plic.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const ECHO_O = 'f0VMRgEBAQAAAAAAAAAAAAEA8wABAAAAAAAAAAAAAADgAgAAAAAAADQAAAAAACgACgABABMBAf8jJqEAIySxACMiwQAjINEANwUgDIMlRQATBhAAY5DFAjcGABCDRgYAIwDWADcGAACDJgYAk4YWACMg1gAjIrUAAyXBAIMlgQADJkEAgyYBABMBAQFzACAwNwUADJMFEAAjIrUANwUgDCMgBQA3JQAMEwYgACMgxQA3BQAAEwUFAHMQVTCTlbUAc5BFMBMFgABzIAUwNwUAAIMlBQBjSrYAkwUwAHMAUBADJgUA40y2/jcFABCTBaAAIwC1ABMG8AQjAMUAEwawBCMAxQAjALUAkwjQBRMFAABzAAAAZ4AAAABVYnVudHUgY2xhbmcgdmVyc2lvbiAxOC4xLjMgKDF1YnVudHUxKQBBIAAAAHJpc2N2AAEWAAAABBAFcnYzMmkycDFfbTJwMAAAAAAAAAAAAAAAAAAAAAAAAAAAXgAAAAAAAAAAAAAABADx/4QAAAAAAAAAAAAAAAAAAgB/AAAAAAAAAAAAAAAAAAQAegAAAAAAAAAAAAAAAAAFAHUAAAAAAAAAAAAAAAAABwA4AAAAAAAAAFwAAAASAAIAEwAAAAAAAAAEAAAAEQAEAAwAAABcAAAAiAAAABIAAgAwAAAAGgcAAAAAAAA0AAAAGwcAAAAAAAA8AAAAHAcAAAAAAAB8AAAAGgYAAAAAAACAAAAAGwYAAAAAAACYAAAAGgcAAAAAAACcAAAAGwcAAAAAAACsAAAAGwcAAAAAAAAGBwAucmVsYS50ZXh0AF9zdGFydABnb3QALmNvbW1lbnQALnNic3MALnJpc2N2LmF0dHJpYnV0ZXMAaGFuZGxlcgAubm90ZS5HTlUtc3RhY2sALmxsdm1fYWRkcnNpZwBlY2hvLmMALnN0cnRhYgAuc3ltdGFiACRkLjMAJGQuMgAkZC4xACR4LjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABlAAAAAwAAAAAAAAAAAAAAVgIAAIkAAAAAAAAAAAAAAAEAAAAAAAAABgAAAAEAAAAGAAAAAAAAADQAAADkAAAAAAAAAAAAAAAEAAAAAAAAAAEAAAAEAAAAQAAAAAAAAAD0AQAAYAAAAAkAAAACAAAABAAAAAwAAAAgAAAACAAAAAMAAAAAAAAAGAEAAAQAAAAAAAAAAAAAAAQAAAAAAAAAFwAAAAEAAAAwAAAAAAAAABgBAAAoAAAAAAAAAAAAAAABAAAAAQAAAEAAAAABAAAAAAAAAAAAAABAAQAAAAAAAAAAAAAAAAAAAQAAAAAAAAAmAAAAAwAAcAAAAAAAAAAAQAEAACEAAAAAAAAAAAAAAAEAAAAAAAAAUAAAAANM/28AAACAAAAAAFQCAAACAAAACQAAAAAAAAABAAAAAAAAAG0AAAACAAAAAAAAAAAAAABkAQAAkAAAAAEAAAAGAAAABAAAABAAAAA=';

test('clang echoes UART input through an external (PLIC) interrupt', () => {
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); }});
    loadElfInto(m, new Uint8Array(Buffer.from(ECHO_O, 'base64')));
    for (const c of 'ABC') m.uart.rxPush(c.charCodeAt(0));   // three keystrokes
    m.run(5_000_000);
    assert.equal(out, 'ABC\nOK\n', 'each keystroke was delivered by an external interrupt and echoed');
    assert.equal(m.exitCode, 0);
});

test('PLIC gateway is edge-latched: claim clears the latch, complete does not re-pend a still-high line', () => {
    const cpu = new RiscV32(new Uint8Array(0x1000));
    const plic = createPlic(cpu, {});
    const mip = () => cpu.csr[0x344] & INTERRUPT.MEI;
    plic.store32(0x0004, 5);         // priority[source 1] = 5
    plic.store32(0x2000, 1 << 1);    // enable source 1
    plic.store32(0x200000, 0);       // threshold 0
    assert.equal(mip(), 0, 'nothing pending yet');
    plic.setPending(1, true);        // the device signals an event
    assert.ok(mip(), 'MEIP raised');
    assert.equal(plic.load32(0x200004), 1, 'claim returns the source');
    assert.equal(mip(), 0, 'claim cleared the pending latch -> MEIP drops');
    // The device has NOT lowered its line (setPending(1,false) never called) — as
    // e.g. xv6-rv32's virtio_disk_intr, which acks only via claim/complete. On a
    // SiFive/QEMU gateway, complete does not re-derive pending from that still-high
    // line, so MEIP stays low. (A level-re-deriving PLIC would storm the hart here.)
    plic.store32(0x200004, 1);       // complete
    assert.equal(mip(), 0, 'complete does not re-pend a claimed, still-asserted source');
    // A fresh device event re-latches and interrupts again — repeated I/O still works.
    plic.setPending(1, true);        // next used-ring post / next keystroke
    assert.ok(mip(), 'a new setPending(true) event re-raises MEIP');
    assert.equal(plic.load32(0x200004), 1, 'claim returns the source again');
    assert.equal(mip(), 0, 'and clears again');
});

test('a source below the threshold does not interrupt', () => {
    const cpu = new RiscV32(new Uint8Array(0x1000));
    const plic = createPlic(cpu, {});
    plic.store32(0x0004, 3);         // priority 3
    plic.store32(0x2000, 1 << 1);    // enabled
    plic.store32(0x200000, 3);       // threshold 3 — priority must be strictly greater
    plic.setPending(1, true);
    assert.equal(cpu.csr[0x344] & INTERRUPT.MEI, 0, 'priority == threshold is masked');
});
