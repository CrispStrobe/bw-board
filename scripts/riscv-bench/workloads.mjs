// The RISC-V bench workloads as pure functions of their input bytes: no fs, no
// process, so Node (scripts/bench-riscv32.mjs) and a browser page
// (scripts/bench-riscv32-browser.mjs) run exactly the same code. Each takes the
// machine class to use (so a caller can time another tree's core) and returns
// {instructions, seconds} for the timed part.

// Retired instructions. A core older than the Zicntr work has no `retired`;
// fall back to its step counter (which also counts trap entries).
const retired = cpu => cpu.retired ?? cpu.instret;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

function loadSegments(m, elf) {
    const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    const phoff = dv.getUint32(0x1c, true), phnum = dv.getUint16(0x2c, true), phentsize = dv.getUint16(0x2a, true);
    for (let i = 0; i < phnum; i++) {
        const p = phoff + i * phentsize;
        if (dv.getUint32(p, true) !== 1) continue;
        const off = dv.getUint32(p + 4, true), paddr = dv.getUint32(p + 12, true), filesz = dv.getUint32(p + 16, true);
        m.load(elf.subarray(off, off + filesz), paddr);
    }
    return dv.getUint32(0x18, true) >>> 0;
}

/** CoreMark / Dhrystone, *-ecall.elf from scripts/riscv-bench/build.sh, to completion. */
export function runBareElf(RiscV32Machine, elf) {
    const m = new RiscV32Machine({memSize: 1 << 22, ramBase: 0x80000000});
    m.cpu.pc = loadSegments(m, elf);
    const cpu = m.cpu;
    const t0 = now();
    while (!cpu.halted) m.run(1_000_000);
    return {instructions: retired(cpu), seconds: now() - t0, exit: m.exitCode, output: m.output};
}

/** The mixed ALU/load/store/mul loop: 30 M instructions after a 2 M warm-up. */
export function runAlu(RiscV32Machine, assembleRiscv, {clint = true, n = 30_000_000} = {}) {
    const img = assembleRiscv(`
      li t0, 0
      li t1, 0x8000
      li t2, 3
    loop:
      addi t0, t0, 1
      sw t0, 0(t1)
      lw a1, 0(t1)
      mul a2, a1, t2
      xor a3, a2, t0
      andi a4, a3, 255
      add a5, a4, a1
      j loop
    `, {textBase: 0, dataBase: 0x8000});
    const m = new RiscV32Machine({clint: clint ? undefined : false});
    m.loadImage(img.image);
    m.run(2_000_000);
    const i0 = retired(m.cpu);
    const t0 = now();
    m.run(n);
    return {instructions: retired(m.cpu) - i0, seconds: now() - t0};
}

/** xv6-rv32 from reset to the shell prompt ("init: starting sh" then "$ "). */
export function runXv6(RiscV32Machine, kernel, fsImg) {
    let out = '';
    const m = new RiscV32Machine(
        {memSize: 1 << 24, ramBase: 0x80000000, uartIrq: 10, virtioIrq: 1, virtioDisk: new Uint8Array(fsImg)},
        {onSerial: b => { out += String.fromCharCode(b); }});
    m.cpu.pc = loadSegments(m, kernel);
    const cpu = m.cpu;
    const t0 = now();
    while (!cpu.halted && !/init: starting sh\n\$ /.test(out)) m.run(1_000_000);
    return {instructions: retired(cpu), seconds: now() - t0, reached: /\$ /.test(out)};
}

/** RV32 Linux (src/riscv32-linux.js) from reset to the busybox prompt. Returns
 *  the instructions and seconds to the prompt. */
export function runLinux(RiscV32Machine, bootLinux, kernel, initrd) {
    let out = '';
    const m = new RiscV32Machine({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10},
        {onSerial: b => { out += String.fromCharCode(b); }});
    bootLinux(m, {kernel, initrd});
    const cpu = m.cpu;
    const t0 = now();
    while (!cpu.halted && !/BWB-LINUX-USERSPACE-UP[\s\S]*# $/.test(out) && cpu.retired < 1e9) m.run(1_000_000);
    return {instructions: cpu.retired, seconds: now() - t0, reached: /# $/.test(out)};
}
