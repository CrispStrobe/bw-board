// Reset -> power-off: boot the kernel with an initramfs whose /init powers off
// at once (SBI SRST), and report instructions and wall time. The same kernel
// and initramfs run on TinyEMU (with OpenSBI) for the reference timing.
//   node test/linux-riscv/poweroff.mjs <Image> <initramfs-poweroff.cpio>
import {readFileSync} from 'node:fs';
import {RiscV32Machine} from '../../src/riscv32-machine.js';
import {bootLinux} from '../../src/riscv32-linux.js';

const [kernelPath, initrdPath] = process.argv.slice(2);
let out = '';
const m = new RiscV32Machine({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10},
    {onSerial: b => { out += String.fromCharCode(b); }});
bootLinux(m, {kernel: new Uint8Array(readFileSync(kernelPath)), initrd: new Uint8Array(readFileSync(initrdPath)),
    bootargs: 'earlycon=sbi console=ttyS0 keep_bootcon'});
const t0 = performance.now();
while (!m.cpu.halted && m.cpu.retired < 1e9) m.run(2_000_000);
const s = (performance.now() - t0) / 1000;
const ok = m.cpu.halted && /reboot: Power down/.test(out) && /BWB-LINUX-USERSPACE-UP/.test(out);
console.log(`poweroff: ${ok ? 'OK' : 'FAIL'} ${m.cpu.retired} instructions in ${s.toFixed(2)} s = ${(m.cpu.retired / s / 1e6).toFixed(2)} MIPS (node ${process.version})`);
process.exit(ok ? 0 : 1);
