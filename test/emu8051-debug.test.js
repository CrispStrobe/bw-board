/**
 * The debug target, against the REAL emu8051-stc WASM.
 *
 * Boundary D is a contract three targets implement differently, so the only
 * thing worth asserting is what this one really does — including the two
 * places it says no, and the one place the C API would mislead a caller if it
 * were passed straight through.
 *
 * Skips (rather than fails) when no WASM build is reachable, like
 * conformance-real-wasm.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051DebugTarget } from '../src/emu8051-debug.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// Look where the build actually is: an env override, a sibling checkout on a
// developer's machine, then the VPS path the other WASM test uses.
const CANDIDATES = [
    process.env.EMU8051_JS,
    path.resolve(here, '../../emu8051-stc/build/emu8051.js'),
].filter(Boolean);

let createEmu8051 = null;
for (const p of CANDIDATES) {
    if (existsSync(p)) { createEmu8051 = require(p); break; }
}

/** LJMP 0x0006 at 0x0000, SJMP $ at 0x0006 — two instructions, no peripherals. */
const TINY_HEX = ':03000000020006F5\n:0200060080FE7A\n:00000001FF\n';

async function target() {
    if (!createEmu8051) return null;
    const wasm = await createEmu8051();
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm._emu_set_vcc(5.0);
    const t = createEmu8051DebugTarget(wasm);
    // ccall marshals the string itself — see the module header on why nothing
    // here may touch a heap view.
    wasm.ccall('emu_load_hex', 'number', ['string', 'number'], [TINY_HEX, TINY_HEX.length]);
    t.reset();
    return t;
}

const skip = (t) => { if (!t) console.log('# SKIP: no emu8051 build reachable'); return !t; };

describe('debug target: capabilities are what this emulator can really do', () => {
    it('offers block stepping and yield breakpoints — the universal pair', async () => {
        const t = await target(); if (skip(t)) return;
        const caps = t.capabilities();
        assert.ok(caps.steps.includes('block'));
        assert.ok(caps.breakpoints.includes('yield'));
        assert.equal(caps.timeFreezes, true);
        assert.deepEqual(caps.consumes, [], 'an emulator takes nothing from the program');
    });

    it('does NOT claim line stepping, and refuses it with a reason', async () => {
        const t = await target(); if (skip(t)) return;
        // dbg_step returns success for STEP_LINE and then steps one INSTRUCTION
        // ("Would need a line table"). Passing that through would be the exact
        // failure DEBUG-CONTROL-MODEL §1 forbids: doing something else quietly.
        assert.ok(!t.capabilities().steps.includes('line'));
        const refusal = t.step('line');
        assert.ok(refusal && refusal.unsupported, 'a refusal, not a silent instruction step');
        assert.match(refusal.unsupported, /line table/);
        assert.equal(t.state(), 'halted', 'and it did not move');
    });

    it('watchpoint capability matches what the WASM actually exports', async () => {
        const t = await target(); if (skip(t)) return;
        const caps = t.capabilities();
        // Feature detection: if the WASM exports _emu_dbg_set_bp_write,
        // the target claims 'write' breakpoints. Otherwise it refuses.
        if (caps.breakpoints.includes('write')) {
            // WASM exports watchpoints — setting one should succeed
            const r = t.setBreakpoint({ kind: 'write', space: 'iram', addr: 8, len: 2 });
            assert.ok(!r || !r.unsupported, 'write breakpoint accepted when WASM exports it');
        } else {
            // WASM lacks the export — target must refuse with a reason
            const r = t.setBreakpoint({ kind: 'write', space: 'iram', addr: 8, len: 2 });
            assert.ok(r.unsupported);
            assert.match(r.unsupported, /sampling/, 'and it says what to do instead');
        }
    });
});

describe('debug target: run control', () => {
    it('reset leaves it halted at 0, and step(insn) advances one instruction', async () => {
        const t = await target(); if (skip(t)) return;
        assert.equal(t.state(), 'halted');
        assert.equal(t.regs().pc, 0);

        const halts = [];
        t.onHalt((why) => halts.push(why));
        t.step('insn', 1);
        // A step needs pumping, exactly as a run does: dbg_step only arms it.
        for (let i = 0; i < 1000 && t.state() === 'running'; i++) t.runFor(1000);

        assert.equal(t.regs().pc, 6, 'LJMP 0x0006 retired');
        assert.equal(halts.length, 1);
        assert.equal(halts[0].cause, 'step');
        assert.equal(halts[0].skewNs, 0n, 'an emulator freezes time, so nothing was missed');
    });

    it('a budgeted run does NOT look like a halt', async () => {
        const t = await target(); if (skip(t)) return;
        // emu_dbg_run_until_ns stops the target when the budget runs out, and
        // dbg_halt reports that as HALT_USER. Left alone, a host pumping once
        // per frame would see a "halt" sixty times a second.
        const halts = [];
        t.onHalt((why) => halts.push(why));
        t.run();
        for (let i = 0; i < 10; i++) {
            assert.equal(t.runFor(1_000_000), 'budget');
            assert.equal(t.state(), 'running', 'and it is still running afterwards');
        }
        assert.equal(halts.length, 0, 'ten frames, no spurious halts');
        assert.ok(t.timeNs() >= 10_000_000n, 'while really advancing program time');
    });

    it('a breakpoint stops it, says so once, and names which one', async () => {
        const t = await target(); if (skip(t)) return;
        const halts = [];
        t.onHalt((why) => halts.push(why));
        const handle = t.setBreakpoint({ kind: 'code', addr: 0x0006 });
        assert.equal(typeof handle, 'number');

        t.run();
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(t.regs().pc, 0x0006);
        assert.equal(halts.length, 1);
        assert.equal(halts[0].cause, 'breakpoint');
        assert.equal(halts[0].bp, handle, 'identified by PC, since bp_id is unreadable');
        assert.equal(halts[0].bpKind, 'code');
    });

    it('breakpoints survive a reset, because the emulator keeps them', async () => {
        const t = await target(); if (skip(t)) return;
        // dbg_reset resets the CPU and the peripherals and does not touch
        // t->bps. Forgetting our own record here would leave the two sides
        // disagreeing, and every later hit reported as "some breakpoint".
        const handle = t.setBreakpoint({ kind: 'code', addr: 0x0006 });
        const halts = [];
        t.onHalt((why) => halts.push(why));
        t.reset();
        t.run();
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(halts.at(-1).bp, handle, 'still known after the reset');
    });

    it('clearing a breakpoint really clears it', async () => {
        const t = await target(); if (skip(t)) return;
        const handle = t.setBreakpoint({ kind: 'code', addr: 0x0006 });
        t.clearBreakpoint(handle);
        t.run();
        assert.equal(t.runFor(1_000_000), 'budget', 'it ran straight past');
    });
});

describe('debug target: memory and registers', () => {
    it('reads code space back as it was loaded', async () => {
        const t = await target(); if (skip(t)) return;
        assert.deepEqual(Array.from(t.readMem('code', 0, 3)), [0x02, 0x00, 0x06]);
    });

    it('reads every space, and refuses one that does not exist', async () => {
        const t = await target(); if (skip(t)) return;
        for (const space of ['code', 'iram', 'sfr', 'xram', 'bit']) {
            assert.ok(t.readMem(space, 0x00, 4) instanceof Uint8Array, space);
        }
        assert.ok(t.readMem('flash', 0, 1).unsupported);
    });

    it('bit space is the bits of IRAM 0x20 and of the SFRs', async () => {
        const t = await target(); if (skip(t)) return;
        t.writeMem('iram', 0x20, Uint8Array.from([0b10100101]));
        const bits = Array.from(t.readMem('bit', 0, 8));
        assert.deepEqual(bits, [1, 0, 1, 0, 0, 1, 0, 1], 'LSB first, as bit 0x00 is IRAM 0x20.0');
        t.writeMem('sfr', 0x80, Uint8Array.from([0x0F]));
        assert.deepEqual(Array.from(t.readMem('bit', 0x80, 8)), [1, 1, 1, 1, 0, 0, 0, 0]);
    });

    it('a multi-byte write goes in a byte at a time and comes back whole', async () => {
        const t = await target(); if (skip(t)) return;
        const data = Uint8Array.from([0xDE, 0xAD, 0xBE, 0xEF]);
        assert.equal(t.writeMem('xram', 0x100, data), undefined);
        assert.deepEqual(Array.from(t.readMem('xram', 0x100, 4)), [0xDE, 0xAD, 0xBE, 0xEF]);
    });

    it('reports the register bank rather than leaving PSW to be decoded', async () => {
        const t = await target(); if (skip(t)) return;
        const r = t.regs();
        assert.equal(r.bank, (r.psw >> 3) & 3);
        assert.equal(r.r.length, 8);
    });
});

describe('debug target: Level 1 position', () => {
    const SYMBOLS = {
        fosc: 11059200,
        device: 'stc12c5a60s2',
        scheduler: {
            bw_ms: { space: 'iram', addr: 0x08, size: 2 },
            tasks: [{
                name: 'bw_task0',
                state: { space: 'iram', addr: 0x0C, size: 2 },
                until: { space: 'iram', addr: 0x0E, size: 2 },
                yields: [
                    { state: 0, label: 'entry', addr: 0x0000, block: 'hatblock' },
                    { state: 1, label: 'wait', addr: 0x0006, block: 'waitblock' }
                ]
            }]
        }
    };

    it('reads (task, state) straight out of RAM', async () => {
        const t = await target(); if (skip(t)) return;
        assert.equal(t.position(), undefined, 'nothing to say without a symbol table');
        const loaded = t.setSymbols(SYMBOLS);
        assert.deepEqual(loaded, { tasks: 1, yields: 2 });

        t.writeMem('iram', 0x0C, Uint8Array.from([0x03, 0x00]));   // state = 3
        t.writeMem('iram', 0x0E, Uint8Array.from([0xE8, 0x03]));   // until = 1000
        assert.deepEqual(t.position(), [{ task: 'bw_task0', state: 3, until: 1000 }]);
    });

    it('a finished task reports no deadline', async () => {
        const t = await target(); if (skip(t)) return;
        t.setSymbols(SYMBOLS);
        t.writeMem('iram', 0x0C, Uint8Array.from([0xFF, 0xFF]));   // ran to the end
        t.writeMem('iram', 0x0E, Uint8Array.from([0xE8, 0x03]));
        const [pos] = t.position();
        assert.equal(pos.state, 0xFFFF);
        assert.equal(pos.until, undefined, 'a finished task is not waiting for anything');
    });

    it('a yield breakpoint resolves through the symbol table', async () => {
        const t = await target(); if (skip(t)) return;
        assert.match(
            t.setBreakpoint({ kind: 'yield', task: 'bw_task0', state: 1 }).unsupported,
            /symbol table/, 'and says so when there is none');

        t.setSymbols(SYMBOLS);
        const h = t.setBreakpoint({ kind: 'yield', task: 'bw_task0', state: 1 });
        assert.equal(typeof h, 'number');
        assert.match(
            t.setBreakpoint({ kind: 'yield', task: 'bw_task0', state: 9 }).unsupported,
            /no address/);
        assert.match(
            t.setBreakpoint({ kind: 'yield', task: 'bw_task9', state: 0 }).unsupported,
            /no task named/);
    });

    it('the halt reason carries the position, so a front end needs no second call', async () => {
        const t = await target(); if (skip(t)) return;
        t.setSymbols(SYMBOLS);
        const halts = [];
        t.onHalt((why) => halts.push(why));
        t.setBreakpoint({ kind: 'code', addr: 0x0006 });
        t.run();
        t.runFor(1_000_000);
        assert.ok(Array.isArray(halts.at(-1).tasks));
        assert.equal(halts.at(-1).tasks[0].task, 'bw_task0');
    });
});

describe('debug target: refusing a build it cannot drive', () => {
    it('says which exports are missing rather than failing later', () => {
        assert.throws(
            () => createEmu8051DebugTarget({ _emu_dbg_state: () => 0 }),
            /no debug surface.*_emu_dbg_run/s
        );
    });
});

describe('debug target: the pieces the TUI shows and this must too', () => {
    it('disassembles, through the one route a pointer return can take', async () => {
        const t = await target(); if (skip(t)) return;
        // emu_disasm returns a `const char *`, and no build exports a heap view.
        // ccall's 'string' return type marshals it with Emscripten's own access.
        assert.match(t.disasm(0x0000), /LJMP/i, 'the LJMP the fixture starts with');
        assert.match(t.disasm(0x0006), /SJMP/i);
        assert.equal(typeof t.disasm(0x1234), 'string', 'and never throws on empty code');
    });

    it('moves the PC, which is the TUI\'s "go to address"', async () => {
        const t = await target(); if (skip(t)) return;
        assert.equal(t.setPc(0x0006), undefined);
        assert.equal(t.regs().pc, 0x0006);
    });

    it('wipe clears RAM, reset does not', async () => {
        const t = await target(); if (skip(t)) return;
        t.writeMem('iram', 0x30, Uint8Array.from([0xAB]));
        t.reset();
        assert.equal(t.readMem('iram', 0x30, 1)[0], 0xAB, 'reset keeps memory');
        t.wipe();
        assert.equal(t.readMem('iram', 0x30, 1)[0], 0x00, 'wipe does not');
    });
});
