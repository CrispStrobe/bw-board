// The whole SoC, end to end, in real clang code: a machine-mode timer interrupt
// handler (clang's __attribute__((interrupt("machine")))) reschedules the CLINT
// and prints a '.' through the UART on every tick; after five ticks main prints
// "OK" and exits. This exercises core + Zicsr + trap/MRET + CLINT (word MMIO) +
// UART (byte MMIO) together — the pattern a preemptive RTOS scheduler runs.
//
// TICK_O is the committed clang object of tick.c:
//   __attribute__((interrupt("machine"))) void handler(void){
//       MTIMECMP[0] = MTIME[0] + 300; *UART = '.'; ticks++; }
//   void _start(void){ set up mtvec/mie/mstatus; while(ticks<5) wfi; print "\nOK\n"; exit(0); }

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const TICK_O = 'f0VMRgEBAQAAAAAAAAAAAAEA8wABAAAAAAAAAAAAAADIAgAAAAAAADQAAAAAACgACgABABMBAf8jJqEAIySxADfFAAIDJYX/EwXFErdFAAIjoKUANwUAEJMF4AIjALUANwUAAIMlBQCThRUAIyC1AAMlwQCDJYEAEwEBAXMAIDA3RQACkwXAEiMgtQAjIgUANwUAABMFBQBzEFUwEwUACHMQRTATBYAAcyAFMDcFAACDJQUAEwZAAGNKtgCTBVAAcwBQEAMmBQDjTLb+NwUAEJMFoAAjALUAEwbwBCMAxQATBrAEIwDFACMAtQCTCNAFEwUAAHMAAABngAAAAFVidW50dSBjbGFuZyB2ZXJzaW9uIDE4LjEuMyAoMXVidW50dTEpAEEgAAAAcmlzY3YAARYAAAAEEAVydjMyaTJwMV9tMnAwAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAEAPH/hgAAAAAAAAAAAAAAAAACAIEAAAAAAAAAAAAAAAAABAB8AAAAAAAAAAAAAAAAAAUAdwAAAAAAAAAAAAAAAAAHADoAAAAAAAAATAAAABIAAgAiAAAAAAAAAAQAAAARAAQADAAAAEwAAAB8AAAAEgACACwAAAAaBwAAAAAAADAAAAAbBwAAAAAAADgAAAAcBwAAAAAAAFwAAAAaBgAAAAAAAGAAAAAbBgAAAAAAAHgAAAAaBwAAAAAAAHwAAAAbBwAAAAAAAJAAAAAbBwAAAAAAAAYHAC5yZWxhLnRleHQAX3N0YXJ0AC5jb21tZW50AC5zYnNzAHRpY2tzAC5yaXNjdi5hdHRyaWJ1dGVzAGhhbmRsZXIALm5vdGUuR05VLXN0YWNrAC5sbHZtX2FkZHJzaWcAdGljay5jAC5zdHJ0YWIALnN5bXRhYgAkZC4zACRkLjIAJGQuMQAkeC4wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABnAAAAAwAAAAAAAAAAAAAAOgIAAIsAAAAAAAAAAAAAAAEAAAAAAAAABgAAAAEAAAAGAAAAAAAAADQAAADIAAAAAAAAAAAAAAAEAAAAAAAAAAEAAAAEAAAAQAAAAAAAAADYAQAAYAAAAAkAAAACAAAABAAAAAwAAAAcAAAACAAAAAMAAAAAAAAA/AAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAEwAAAAEAAAAwAAAAAAAAAPwAAAAoAAAAAAAAAAAAAAABAAAAAQAAAEIAAAABAAAAAAAAAAAAAAAkAQAAAAAAAAAAAAAAAAAAAQAAAAAAAAAoAAAAAwAAcAAAAAAAAAAAJAEAACEAAAAAAAAAAAAAAAEAAAAAAAAAUgAAAANM/28AAACAAAAAADgCAAACAAAACQAAAAAAAAABAAAAAAAAAG8AAAACAAAAAAAAAAAAAABIAQAAkAAAAAEAAAAGAAAABAAAABAAAAA=';

test('the full SoC: a clang timer ISR ticks the CLINT and prints via the UART', () => {
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); }});
    loadElfInto(m, new Uint8Array(Buffer.from(TICK_O, 'base64')));
    m.run(10_000_000);
    assert.equal(out, '.....\nOK\n', 'five timer interrupts each printed a dot, then main printed OK');
    assert.equal(m.exitCode, 0);
    assert.ok(m.cpu.instret > 0);
});
