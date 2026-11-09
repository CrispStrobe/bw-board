// Leaving a code breakpoint. The check runs before the instruction at the
// breakpoint executes, so Run or Step issued while stopped ON a breakpoint used
// to re-hit it at once and retire nothing. run()/step() now exempt the halt
// address once, for the first instruction only; the next pass of a loop still
// halts. Both the 8086 and the 386 target share this runFor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {I8086Machine} from '../src/i8086-machine.js';
import {createI80386Adapter} from '../src/i80386-adapter.js';

// 8086, F800:0000:  40 inc ax ; EB FD jmp 0000h   (bp on the jmp, F8001h)
function loop8086(create) {
    const m = new I8086Machine();
    const img = new Uint8Array(0x8000);
    img.set([0x40, 0xeb, 0xfd], 0);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    m.loadRom(img); m.reset(); m.step();
    return {t: create({machine: m}), pc: () => m.cpu.pc, mask: 0xffff, acc: () => m.cpu.ax, loopBp: 0xf8001, top: 0xf8000};
}
// 386 real mode, 0000:7C11:  66 40 inc eax ; EB FC jmp 7C11h   (bp on the jmp, 7C13h)
function loop386(create) {
    const a = createI80386Adapter(); const m = a.machine; m.reset();
    [0x66, 0x40, 0xeb, 0xfc].forEach((b, i) => { m.mem[0x7c11 + i] = b; });
    m.cpu.cs = 0; m.cpu.segmentCaches[1].base = 0; m.cpu.eip = 0x7c11;
    return {t: create(a), pc: () => m.cpu.pc >>> 0, mask: 0xffffffff, acc: () => m.cpu.eax >>> 0, loopBp: 0x7c13, top: 0x7c11};
}

function pump(t) { for (let i = 0; i < 64 && t.state() === 'running'; i++) t.runFor(1000); }

async function scenario(make) {
    const f = make;
    const halts = [];
    f.t.onHalt(w => halts.push(w.cause));
    f.t.setBreakpoint({kind: 'code', addr: f.loopBp});
    f.t.run(); pump(f.t);
    assert.equal(f.pc(), f.loopBp, 'first run stops at the breakpoint');
    const a0 = f.acc();
    // STEP from the breakpoint: the jmp executes, landing on the loop top.
    f.t.step('insn', 1); pump(f.t);
    assert.equal(f.pc(), f.top, 'step leaves the breakpoint');
    assert.equal(halts.at(-1), 'step');
    // Back on the breakpoint by stepping the inc: the re-hit still works.
    f.t.step('insn', 1); pump(f.t);
    assert.equal(f.pc(), f.loopBp);
    assert.equal(f.acc(), ((a0 + 1) & f.mask) >>> 0, 'the inc retired');
    // CONTINUE from the breakpoint: leaves it, runs one loop pass, halts again.
    const before = halts.length;
    f.t.run(); pump(f.t);
    assert.equal(f.pc(), f.loopBp, 'the next pass of the loop halts again');
    assert.equal(halts.slice(before).join(), 'breakpoint', 'exactly one re-hit');
    assert.equal(f.acc(), ((a0 + 2) & f.mask) >>> 0, 'one pass retired');
}

const src = new URL('../src/i8086-debug.js', import.meta.url);
const loaders = {real: async () => import(src.href)};

for (const [name, make] of [['8086', loop8086], ['386', loop386]]) {
    test(`${name}: step and continue leave a breakpoint once; the loop re-hit still halts`, async () => {
        const {createI8086DebugTarget} = await loaders.real();
        const {createI80386DebugTarget} = await import('../src/i80386-debug.js');
        await scenario(make(name === '8086' ? createI8086DebugTarget : createI80386DebugTarget));
    });
}

test('mutants: no exemption, or an exemption that never expires, are both caught', async () => {
    const text = readFileSync(src, 'utf8');
    const mutants = [
        ['no exemption', 'if (breakpoints.size && cpu.pc !== leavePc) {', 'if (breakpoints.size) {'],
        ['never expires', 'leavePc = null;     // the exemption covers the first instruction only', ''],
        ['not armed by step', '        step(kind, count = 1) {\n            armLeave();\n', '        step(kind, count = 1) {\n'],
        ['any address', 'leavePc = haltPc !== null && haltPc === cpu.pc ? haltPc : null;', 'leavePc = cpu.pc;']
    ];
    for (const [name, from, to] of mutants) {
        assert.ok(text.includes(from), `anchor ${name}`);
        const file = fileURLToPath(src).replace(/i8086-debug\.js$/, `i8086-debug.mutant-${process.pid}.js`);
        writeFileSync(file, text.replace(from, to));
        try {
            const mod = await import(pathToFileURL(file).href + `?${encodeURIComponent(name)}`);
            let killed = false;
            try { await scenario(loop8086(mod.createI8086DebugTarget)); } catch { killed = true; }
            if (name === 'any address' && !killed) {
                // Exempting whatever PC run() starts at is only wrong when that
                // PC is a breakpoint the program has NOT halted on yet.
                const f = loop8086(mod.createI8086DebugTarget);
                const halts = []; f.t.onHalt(w => halts.push(w.cause));
                f.t.setBreakpoint({kind: 'code', addr: f.top});   // the current PC, never halted on
                f.t.run(); f.t.runFor(1000);
                killed = !halts.includes('breakpoint');
            }
            assert.ok(killed, `mutant survived: ${name}`);
        } finally {
            rmSync(file, {force: true});
        }
    }
});

test('a breakpoint set on the current PC before the first run still halts', async () => {
    const {createI8086DebugTarget} = await loaders.real();
    const f = loop8086(createI8086DebugTarget);
    const halts = []; f.t.onHalt(w => halts.push(w.cause));
    f.t.setBreakpoint({kind: 'code', addr: f.top});
    f.t.run(); f.t.runFor(1000);
    assert.deepEqual(halts, ['breakpoint']);
    assert.equal(f.pc(), f.top);
});
