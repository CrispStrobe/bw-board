// The memory-mapped UART: a clang program prints by storing bytes to the NS16550
// THR at 0x10000000 (what an RTOS driver does), NOT via the ecall ABI. UART_O is
// the committed clang object of:
//   static void uputc(char c){ *((volatile char*)0x10000000) = c; }
//   void _start(void){ const char*m="UART hi from clang!\n"; while(*m) uputc(*m++); exit(0); }

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {createUart} from '../src/riscv32-uart.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const UART_O = 'f0VMRgEBAQAAAAAAAAAAAAEA8wABAAAAAAAAAAAAAAD8AQAAAAAAADQAAAAAACgACAABADcFABCTBVAFIwC1AJMFEAQjALUAkwUgBSMAtQCTBUAFIwC1AJMFAAIjALUAEwaABiMAxQATBpAGIwDFACMAtQATBmAGIwDFABMGIAcjAMUAEwbwBiMAxQATBtAGIwDFACMAtQCTBTAGIwC1AJMFwAYjALUAkwUQBiMAtQCTBeAGIwC1AJMFcAYjALUAkwUQAiMAtQCTBaAAIwC1AJMI0AUTBQAAcwAAAGeAAAAAVWJ1bnR1IGNsYW5nIHZlcnNpb24gMTguMS4zICgxdWJ1bnR1MSkAQSAAAAByaXNjdgABFgAAAAQQBXJ2MzJpMnAxX20ycDAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAAAAAAAAAAAAAAAQA8f9oAAAAAAAAAAAAAAAAAAIAYwAAAAAAAAAAAAAAAAADAF4AAAAAAAAAAAAAAAAABQAHAAAAAAAAAKwAAAASAAIAAC50ZXh0AF9zdGFydAAuY29tbWVudAAucmlzY3YuYXR0cmlidXRlcwAubm90ZS5HTlUtc3RhY2sALmxsdm1fYWRkcnNpZwB1YXJ0LmMALnN0cnRhYgAuc3ltdGFiACRkLjIAJGQuMQAkeC4wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOAAAAAwAAAAAAAAAAAAAAjAEAAG0AAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAEAAAAGAAAAAAAAADQAAACsAAAAAAAAAAAAAAAEAAAAAAAAAA4AAAABAAAAMAAAAAAAAADgAAAAKAAAAAAAAAAAAAAAAQAAAAEAAAApAAAAAQAAAAAAAAAAAAAACAEAAAAAAAAAAAAAAAAAAAEAAAAAAAAAFwAAAAMAAHAAAAAAAAAAAAgBAAAhAAAAAAAAAAAAAAABAAAAAAAAADkAAAADTP9vAAAAgAAAAACMAQAAAAAAAAcAAAAAAAAAAQAAAAAAAABWAAAAAgAAAAAAAAAAAAAALAEAAGAAAAABAAAABQAAAAQAAAAQAAAA';

test('a clang program prints through the memory-mapped UART (not ecall)', () => {
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); }});
    loadElfInto(m, new Uint8Array(Buffer.from(UART_O, 'base64')));
    m.run(1_000_000);
    assert.equal(out, 'UART hi from clang!\n');
    assert.equal(m.exitCode, 0);
});

test('the UART: THR transmits, LSR reports the transmitter empty, RBR/DR receive', () => {
    let out = '';
    const u = createUart({base: 0x10000000, onSerial: b => { out += String.fromCharCode(b); }});
    u.store8(0, 0x41);                 // THR <- 'A'
    u.store8(0, 0x42);                 // THR <- 'B'
    assert.equal(out, 'AB');
    assert.equal(u.load8(5) & 0x20, 0x20, 'LSR.THRE is always set (polled driver spins pass)');
    assert.equal(u.load8(5) & 0x01, 0, 'LSR.DR clear with no rx');
    u.rxPush(0x7a);                    // host pushes 'z'
    assert.equal(u.load8(5) & 0x01, 0x01, 'LSR.DR set once a byte is queued');
    assert.equal(u.load8(0), 0x7a, 'RBR reads the received byte');
    assert.equal(u.load8(5) & 0x01, 0, 'DR clears after the read');
});
