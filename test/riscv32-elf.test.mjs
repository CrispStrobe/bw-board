// End-to-end: a real clang-compiled RISC-V program runs on the core through the
// tiny ELF loader/relocator (scripts/riscv-elf.mjs) and the RiscV32Machine ecall
// ABI. HELLO_O is the committed `clang --target=riscv32 -march=rv32im -O2
// -nostdlib -ffreestanding -fno-pic -mno-relax` object of:
//
//   static long sys_write(int fd,const char*b,unsigned n){ ...ecall a7=64... }
//   static void sys_exit(int c){ ...ecall a7=93... }
//   void _start(void){ sys_write(1,"Hello from clang on RISC-V!\n",28); sys_exit(0); }
//
// so the test needs no toolchain, yet proves the whole pipeline: clang -> our
// relocator (HI20/LO12 absolute addressing) -> the core -> write/exit syscalls.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {linkElf, loadElfInto} from '../scripts/riscv-elf.mjs';

const HELLO_O = 'f0VMRgEBAQAAAAAAAAAAAAEA8wABAAAAAAAAAAAAAADsAQAAAAAAADQAAAAAACgACgABADcFAACTBQUAEwbAAZMIAAQTBRAAcwAAAJMI0AUTBQAAcwAAAGeAAABIZWxsbyBmcm9tIGNsYW5nIG9uIFJJU0MtViEKAABVYnVudHUgY2xhbmcgdmVyc2lvbiAxOC4xLjMgKDF1YnVudHUxKQBBIAAAAHJpc2N2AAEWAAAABBAFcnYzMmkycDFfbTJwMAAAAAAAAAAAAAAAAAAAAAAAAABTAAAAAAAAAAAAAAAEAPH/iQAAAAAAAAAAAAAAAAACAC4AAAAAAAAAHQAAAAEABAB1AAAAAAAAAAAAAAAAAAQAcAAAAAAAAAAAAAAAAAAFAGsAAAAAAAAAAAAAAAAABwAMAAAAAAAAACgAAAASAAIAAAAAABoDAAAAAAAABAAAABsDAAAAAAAAAC5yZWxhLnRleHQAX3N0YXJ0AC5jb21tZW50AC5yaXNjdi5hdHRyaWJ1dGVzAC5MLnN0cgAubm90ZS5HTlUtc3RhY2sALmxsdm1fYWRkcnNpZwBoZWxsby5jAC5zdHJ0YWIALnN5bXRhYgAkZC4zACRkLjIAJGQuMQAucm9kYXRhLnN0cjEuMQAkeC4wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFsAAAADAAAAAAAAAAAAAABcAQAAjgAAAAAAAAAAAAAAAQAAAAAAAAAGAAAAAQAAAAYAAAAAAAAANAAAACgAAAAAAAAAAAAAAAQAAAAAAAAAAQAAAAQAAABAAAAAAAAAAEQBAAAYAAAACQAAAAIAAAAEAAAADAAAAHoAAAABAAAAMgAAAAAAAABcAAAAHQAAAAAAAAAAAAAAAQAAAAEAAAATAAAAAQAAADAAAAAAAAAAeQAAACgAAAAAAAAAAAAAAAEAAAABAAAANQAAAAEAAAAAAAAAAAAAAKEAAAAAAAAAAAAAAAAAAAABAAAAAAAAABwAAAADAABwAAAAAAAAAAChAAAAIQAAAAAAAAAAAAAAAQAAAAAAAABFAAAAA0z/bwAAAIAAAAAAXAEAAAAAAAAJAAAAAAAAAAEAAAAAAAAAYwAAAAIAAAAAAAAAAAAAAMQAAACAAAAAAQAAAAcAAAAEAAAAEAAAAA==';

test('a real clang-compiled RISC-V program prints via the ecall ABI', () => {
    const obj = new Uint8Array(Buffer.from(HELLO_O, 'base64'));
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); }});
    loadElfInto(m, obj);
    m.run(1_000_000);
    assert.equal(out, 'Hello from clang on RISC-V!\n');
    assert.equal(m.exitCode, 0, 'the program exited cleanly');
    assert.ok(m.halted);
});

test('linkElf places .text and .rodata and resolves the entry symbol', () => {
    const obj = new Uint8Array(Buffer.from(HELLO_O, 'base64'));
    const {segments, entry, symbols} = linkElf(obj, {textBase: 0x1000, dataBase: 0x8000});
    assert.ok(symbols.has('_start'), 'the entry symbol resolved');
    assert.equal(entry, symbols.get('_start'));
    // .text is executable → placed at textBase; the string → the data run.
    assert.ok(segments.some(s => s.addr === 0x1000), '.text at textBase');
    assert.ok(segments.some(s => s.addr >= 0x8000), '.rodata in the data run');
});
