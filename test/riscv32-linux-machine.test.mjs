// The machine pieces a Linux kernel relies on, checked without a kernel: the
// in-emulator SBI (BASE probe, TIME forwarding MTIP -> STIP, IPI, SRST), the
// WFI idle skip, the NS16550A registers the 8250 driver uses, and the device
// tree written by src/fdt.js + src/riscv32-linux.js. The full boot is
// test/linux-riscv/boot.mjs (workflow linux-riscv.yml).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {createUart} from '../src/riscv32-uart.js';
import {buildFdt} from '../src/fdt.js';
import {linuxDeviceTree, bootLinux} from '../src/riscv32-linux.js';

const STIP = 1 << 5, SSIP = 1 << 1;
const sbi = (m, eid, fid, a0 = 0, a1 = 0) => {
    const c = m.cpu;
    c.x[17] = eid; c.x[16] = fid; c.x[10] = a0; c.x[11] = a1;
    m._sbi(c);
    return [c.x[10], c.x[11]];
};
const newMachine = () => new RiscV32Machine({memSize: 1 << 22, ramBase: 0x80000000, uartIrq: 10});

test('SBI BASE: spec v0.3, and probe_extension answers truthfully', () => {
    const m = newMachine();
    assert.deepEqual(sbi(m, 0x10, 0), [0, 0x3]);
    for (const [eid, want] of [[0x54494D45, 1], [0x735049, 1], [0x52464E43, 1], [0x48534D, 1], [0x53525354, 1],
        [0x4442434E, 1], [0x504D55 /* PMU */, 0], [0x535553 /* SUSP */, 0], [0x12345678, 0]])
        assert.deepEqual(sbi(m, 0x10, 3, eid), [0, want], `probe 0x${eid.toString(16)}`);
    assert.equal(sbi(m, 0x504D55, 0)[0], -2, 'an unimplemented extension is SBI_ERR_NOT_SUPPORTED');
});

test('SBI TIME set_timer: STIP clears at once and rises exactly when mtime reaches the compare', () => {
    const m = newMachine();
    const c = m.cpu;
    new Uint32Array(c.mem.buffer, 0, 4096).fill(0x00000013);   // nops (addi x0,x0,0)
    c.pc = 0x80000000; c.priv = 1;
    c.setInterruptPending(STIP, true);
    const t = m.clint.mtime;
    sbi(m, 0x54494D45, 0, t + 100, 0);
    assert.equal(c.csr[0x344] & STIP, 0, 'set_timer lowers STIP');
    for (let i = 0; i < 99; i++) m.step();
    assert.equal(c.csr[0x344] & STIP, 0, 'not yet at mtime = compare - 1');
    m.step();
    assert.ok(c.csr[0x344] & STIP, 'STIP up when mtime reaches the compare');
    sbi(m, 0x54494D45, 0, t, 0);                         // a compare already in the past
    assert.ok(c.csr[0x344] & STIP, 'a past compare raises STIP immediately');
});

test('WFI with nothing pending jumps mtime to the timer deadline (idle skip)', () => {
    const m = newMachine();
    const c = m.cpu;
    const WFI = 0x10500073;
    for (let i = 0; i < 16; i++) new DataView(c.mem.buffer).setUint32(i * 4, i === 0 ? WFI : 0x13, true);
    c.pc = 0x80000000; c.priv = 1;
    const t = m.clint.mtime;
    sbi(m, 0x54494D45, 0, t + 1_000_000, 0);
    m.step();                                             // the WFI
    assert.ok(m.clint.mtime >= t + 1_000_000, `mtime ${m.clint.mtime - t} ticks later`);
    assert.ok(c.csr[0x344] & STIP, 'the timer fired');
    assert.ok(m.idleSkipped > 900_000);
});

test('SBI IPI to hart 0 raises SSIP; SRST halts with the reason', () => {
    const m = newMachine();
    sbi(m, 0x735049, 0, 1, 0);
    assert.ok(m.cpu.csr[0x344] & SSIP);
    sbi(m, 0x53525354, 0, 0, 0);
    assert.equal(m.cpu.halted, true);
    assert.equal(m.exitCode, 0);
});

test('16550A: DLAB latches the divisor (no byte sent), IIR reports THRE then RDA by priority, FIFO bits', () => {
    const sent = [], irq = [];
    const u = createUart({onSerial: b => sent.push(b), onRx: l => irq.push(l)});
    u.store8(3, 0x80);                                    // LCR.DLAB
    u.store8(0, 0x0c); u.store8(1, 0x00);                 // divisor 12
    assert.deepEqual(sent, [], 'a divisor write is not transmitted');
    assert.equal(u.load8(0), 0x0c);
    u.store8(3, 0x03);                                    // 8N1, DLAB off
    u.store8(2, 0x01);                                    // FCR: FIFO on
    assert.equal(u.load8(2), 0xc1, 'no interrupt pending, FIFO bits set');
    u.store8(1, 0x02);                                    // IER.THRI on an empty THR
    assert.equal(irq.at(-1), true, 'THRE interrupt raised');
    assert.equal(u.load8(2), 0xc2, 'IIR = THRE');
    assert.equal(u.load8(2), 0xc1, 'reading IIR cleared THRE');
    u.store8(0, 0x41);
    assert.deepEqual(sent, [0x41]);
    assert.equal(u.load8(2) & 0x0f, 0x02, 'THRE again after the byte went out');
    u.store8(1, 0x03);                                    // + RDI
    u.rxPush(0x5a);
    assert.equal(u.load8(2) & 0x0f, 0x04, 'received data outranks THRE');
    assert.equal(u.load8(5) & 1, 1, 'LSR.DR');
    assert.equal(u.load8(0), 0x5a);
    u.store8(7, 0x99);
    assert.equal(u.load8(7), 0x99, 'scratch register');
});

// A minimal FDT reader: enough to check the structure buildFdt writes.
function readFdt(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    assert.equal(dv.getUint32(0), 0xd00dfeed, 'magic');
    assert.equal(dv.getUint32(4), b.length, 'totalsize');
    const structOff = dv.getUint32(8), strOff = dv.getUint32(12);
    const str = o => { let s = ''; while (b[strOff + o]) s += String.fromCharCode(b[strOff + o++]); return s; };
    let p = structOff;
    const root = {children: {}, props: {}};
    const stack = [];
    let cur = null;
    for (;;) {
        const tok = dv.getUint32(p); p += 4;
        if (tok === 1) {
            let name = ''; while (b[p]) name += String.fromCharCode(b[p++]); p = (p + 4) & ~3;
            const n = {children: {}, props: {}};
            if (cur) cur.children[name] = n; else Object.assign(root, n);
            stack.push(cur); cur = cur ? n : root;
        } else if (tok === 3) {
            const len = dv.getUint32(p), nameoff = dv.getUint32(p + 4); p += 8;
            cur.props[str(nameoff)] = b.slice(p, p + len); p = (p + len + 3) & ~3;
        } else if (tok === 2) { cur = stack.pop(); }
        else if (tok === 9) break;
        else throw new Error('bad token ' + tok);
    }
    return root;
}
const cells = u8 => Array.from({length: u8.length / 4}, (_, i) => new DataView(u8.buffer, u8.byteOffset).getUint32(i * 4));
const text = u8 => new TextDecoder().decode(u8).replace(/\0$/, '');

test('the Linux device tree describes this machine: RAM, Sv32 hart, PLIC contexts, 16550A, initrd', () => {
    const m = new RiscV32Machine({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10});
    const t = readFdt(buildFdt(linuxDeviceTree(m, {initrd: {start: 0x83000000, size: 0x1000}})));
    assert.deepEqual(cells(t.children['memory@80000000'].props.reg), [0x80000000, 1 << 26]);
    const cpu = t.children.cpus.children['cpu@0'];
    assert.equal(text(cpu.props['mmu-type']), 'riscv,sv32');
    assert.equal(text(cpu.props['riscv,isa']), 'rv32imac');
    const soc = t.children.soc.children;
    assert.deepEqual(cells(soc['interrupt-controller@c000000'].props['interrupts-extended']), [1, 11, 1, 9]);
    assert.equal(text(soc['serial@10000000'].props.compatible), 'ns16550a');
    assert.deepEqual(cells(soc['serial@10000000'].props.interrupts), [10]);
    assert.deepEqual(cells(t.children.chosen.props['linux,initrd-start']), [0x83000000]);
    assert.deepEqual(cells(t.children.chosen.props['linux,initrd-end']), [0x83001000]);
});

test('bootLinux hands off as firmware would: S-mode, a0 = hart 0, a1 = DTB, delegation, counters, ADUE', () => {
    const m = new RiscV32Machine({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10});
    const kernel = new Uint8Array(new Uint32Array(1024).fill(0x00000013).buffer);
    const l = bootLinux(m, {kernel, initrd: new Uint8Array(8192)});
    const c = m.cpu;
    assert.equal(c.priv, 1);
    assert.equal(c.pc >>> 0, 0x80000000);
    assert.equal(c.x[10], 0);
    assert.equal(c.x[11] >>> 0, l.dtbAddr);
    assert.equal(new DataView(c.mem.buffer).getUint32(l.dtbAddr - 0x80000000), 0xd00dfeed, 'DTB in RAM');
    assert.ok(c.csr[0x302] & (1 << 13) && c.csr[0x302] & (1 << 8), 'page faults and U-ecall delegated');
    assert.equal(c.csr[0x303], (1 << 1) | (1 << 5) | (1 << 9), 'S interrupts delegated');
    assert.ok(c.csr[0x31a] & (1 << 29), 'hardware A/D');
    assert.ok(l.initrd.start + l.initrd.size <= l.dtbAddr);
});
