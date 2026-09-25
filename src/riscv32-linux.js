/**
 * Boot an RV32 Linux kernel on RiscV32Machine — the machine's in-emulator SBI
 * (RiscV32Machine._sbi) stands in for OpenSBI, so there is no firmware image:
 * this module does what OpenSBI's fw_jump does before jumping to the kernel.
 *
 *   - place the kernel Image at the start of RAM, the initramfs and the device
 *     tree near the top;
 *   - describe OUR machine in the device tree: one rv32imac hart with Sv32,
 *     RAM, the PLIC (M and S contexts), the NS16550A UART, and the timebase
 *     (mtime counts retired instructions, `timebaseHz` per second nominal);
 *   - leave the hart as firmware would: S-mode, satp = 0, a0 = hartid,
 *     a1 = the DTB's physical address; the standard exceptions and the
 *     supervisor interrupts delegated; counters enabled for S; hardware A/D.
 *
 * The kernel must be built for this: rv32ima(c), MMU (Sv32), no FPU, SBI
 * (legacy or v0.2) timer and console, SIFIVE_PLIC, SERIAL_8250 + OF_PLATFORM,
 * BLK_DEV_INITRD. rv32emu's Linux image (Linux 6.1, Buildroot) is one.
 *
 * @module
 */
import {buildFdt} from './fdt.js';

const PLIC_BASE = 0x0c000000, UART_BASE = 0x10000000;

/** The device tree for `machine` (a RiscV32Machine). */
export function linuxDeviceTree(machine, {bootargs, initrd, timebaseHz = 10_000_000, uartIrq = 10} = {}) {
    const ram = machine.ramBase, size = machine.memSize;
    const CPU_INTC = 1, PLIC = 2;
    const chosen = {bootargs: bootargs ?? 'earlycon=sbi console=ttyS0', 'stdout-path': '/soc/serial@10000000'};
    if (initrd) {
        chosen['linux,initrd-start'] = initrd.start >>> 0;
        chosen['linux,initrd-end'] = (initrd.start + initrd.size) >>> 0;
    }
    return {
        name: '', props: {'#address-cells': 1, '#size-cells': 1, compatible: 'bw-board,riscv32', model: 'bw-board RiscV32Machine'},
        children: [
            {name: 'chosen', props: chosen},
            {name: `memory@${ram.toString(16)}`, props: {device_type: 'memory', reg: [ram, size]}},
            {name: 'cpus', props: {'#address-cells': 1, '#size-cells': 0, 'timebase-frequency': timebaseHz}, children: [
                {name: 'cpu@0', props: {device_type: 'cpu', reg: 0, status: 'okay', compatible: 'riscv',
                    'riscv,isa': 'rv32imac', 'mmu-type': 'riscv,sv32'}, children: [
                    {name: 'interrupt-controller', props: {'#interrupt-cells': 1, 'interrupt-controller': true,
                        compatible: 'riscv,cpu-intc', phandle: CPU_INTC}},
                ]},
            ]},
            {name: 'soc', props: {'#address-cells': 1, '#size-cells': 1, compatible: 'simple-bus', ranges: true}, children: [
                {name: `interrupt-controller@${PLIC_BASE.toString(16)}`, props: {
                    compatible: ['sifive,plic-1.0.0', 'riscv,plic0'], reg: [PLIC_BASE, 0x4000000],
                    '#interrupt-cells': 1, '#address-cells': 0, 'interrupt-controller': true,
                    // context 0 = machine external (11), context 1 = supervisor external (9)
                    'interrupts-extended': [CPU_INTC, 11, CPU_INTC, 9], 'riscv,ndev': 31, phandle: PLIC}},
                {name: `serial@${UART_BASE.toString(16)}`, props: {
                    compatible: 'ns16550a', reg: [UART_BASE, 0x100], 'clock-frequency': 3686400,
                    'reg-shift': 0, 'reg-io-width': 1, 'interrupt-parent': PLIC, interrupts: uartIrq}},
            ]},
        ],
    };
}

/**
 * Load and hand off. `machine` must have RAM at a base (e.g. 0x80000000) and a
 * PLIC whose UART source matches `uartIrq`. Returns the layout used.
 * @param {import('./riscv32-machine.js').RiscV32Machine} machine
 * @param {{kernel: Uint8Array, initrd?: Uint8Array, bootargs?: string, timebaseHz?: number, uartIrq?: number}} opts
 */
export function bootLinux(machine, opts) {
    const {kernel, initrd} = opts;
    const ram = machine.ramBase, top = ram + machine.memSize;
    const align = (v, a) => Math.floor(v / a) * a;
    machine.load(kernel, ram);
    const dtbAddr = align(top - 0x10000, 0x1000);                   // top 64 KiB: device tree
    let initrdInfo;
    if (initrd) {
        const start = align(dtbAddr - initrd.length - 0x1000, 0x1000);
        if (start < ram + kernel.length + 0x400000) throw new Error('RAM too small for kernel + initramfs');
        machine.load(initrd, start);
        initrdInfo = {start, size: initrd.length};
    }
    const dtb = buildFdt(linuxDeviceTree(machine, {...opts, initrd: initrdInfo}));
    if (dtb.length > 0x10000) throw new Error('device tree too large');
    machine.load(dtb, dtbAddr);

    const c = machine.cpu;
    // What OpenSBI leaves for the kernel: exceptions a supervisor handles
    // (misaligned fetch, access faults, illegal instruction, breakpoint,
    // misaligned load/store, U-ecall, page faults) and the S interrupts.
    c._writeCsr(0x302, (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) |
        (1 << 8) | (1 << 12) | (1 << 13) | (1 << 15));
    c._writeCsr(0x303, (1 << 1) | (1 << 5) | (1 << 9));                 // mideleg: SSI, STI, SEI
    c._writeCsr(0x306, 0xffffffff);                                      // mcounteren: cycle/time/instret for S
    c.csr[0x31a] |= 1 << 29;                                             // menvcfgh.ADUE (hardware A/D)
    c.priv = 1;                                                          // S-mode
    c.pc = ram >>> 0;
    c.x[10] = 0;                                                         // a0 = hartid
    c.x[11] = dtbAddr | 0;                                               // a1 = DTB
    return {kernelAt: ram, dtbAddr, dtbSize: dtb.length, initrd: initrdInfo};
}

export default bootLinux;
