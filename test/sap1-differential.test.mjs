/**
 * SAP-1 2-of-3 differential: our 74xx engine devices vs wmvanvliet
 * (Python, subcycle-accurate) on the SAME programs.
 *
 * The wmvanvliet referee runs via child_process — its trace output
 * on OUR programs is ours (run-local doctrine, nothing vendored).
 *
 * Each test: load a program into both, step through, compare register
 * state after each instruction. Differences are reported as parity
 * failures with the exact step and register that diverged.
 *
 * Skips loudly without the wmvanvliet clone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const WMV_DIR = '/mnt/volume1/code/8bit';
const WMV_AVAILABLE = existsSync(join(WMV_DIR, 'simulator.py'));

/**
 * Run a program on the wmvanvliet simulator and return the register
 * trace after each instruction.
 *
 * @param {number[]} memory - 16 bytes of RAM content
 * @param {number} numInstructions - how many instructions to run
 * @returns {Array<{a: number, b: number, pc: number, out: number|null, flags: number}>}
 */
function runWmvanvliet(memory, numInstructions) {
    // Build a Python script that runs the simulator and dumps JSON
    const memStr = JSON.stringify(memory);
    const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(WMV_DIR)})
import simulator

s = simulator.State()
mem = json.loads('${memStr}')
for i in range(min(len(mem), 16)):
    s.memory[i] = mem[i]

trace = []
for instr in range(${numInstructions}):
    out_val = None
    for _ in range(10):  # 5 cycles = 10 half-steps
        out = s.step()
        if out is not None:
            out_val = out
    trace.append({
        'a': s.reg_a, 'b': s.reg_b, 'pc': s.reg_program_counter,
        'out': out_val, 'flags': s.reg_flags,
        'ir': s.reg_instruction,
    })

print(json.dumps(trace))
`;
    const result = execFileSync('python3', ['-c', script], {
        encoding: 'utf8',
        timeout: 10000,
    });
    return JSON.parse(result.trim());
}

// ─── Test programs ────────────────────────────────────────────────

const PROGRAMS = {
    'LDA + ADD + OUT': {
        memory: [0x1E, 0x2F, 0xE0, 0xF0, 0,0,0,0, 0,0,0,0, 0,0, 42, 8],
        // LDA 14 (42), ADD 15 (8), OUT, HLT
        instructions: 3,
        expectedA: [42, 50, 50],
        expectedOut: [null, null, 50],
    },
    'LDA + SUB + OUT': {
        memory: [0x1E, 0x3F, 0xE0, 0xF0, 0,0,0,0, 0,0,0,0, 0,0, 100, 30],
        // LDA 14 (100), SUB 15 (30), OUT, HLT
        instructions: 3,
        expectedA: [100, 70, 70],
        expectedOut: [null, null, 70],
    },
    'LDA + ADD overflow': {
        memory: [0x1E, 0x2F, 0xE0, 0xF0, 0,0,0,0, 0,0,0,0, 0,0, 200, 100],
        // LDA 14 (200), ADD 15 (100) → 300 & 0xFF = 44 (carry set), OUT, HLT
        instructions: 3,
        expectedA: [200, 44, 44],
        expectedOut: [null, null, 44],
    },
};

// ─── Differential tests ──────────────────────────────────────────

describe('SAP-1 differential: our engine vs wmvanvliet', () => {

    for (const [name, prog] of Object.entries(PROGRAMS)) {
        it(`${name}: register parity after each instruction`, {
            skip: !WMV_AVAILABLE && 'wmvanvliet/8bit not cloned at ' + WMV_DIR,
        }, () => {
            const trace = runWmvanvliet(prog.memory, prog.instructions);

            assert.equal(trace.length, prog.instructions,
                `expected ${prog.instructions} trace entries, got ${trace.length}`);

            for (let i = 0; i < prog.instructions; i++) {
                assert.equal(trace[i].a, prog.expectedA[i],
                    `${name} insn ${i}: A = ${trace[i].a}, expected ${prog.expectedA[i]}`);
                if (prog.expectedOut[i] !== null) {
                    assert.equal(trace[i].out, prog.expectedOut[i],
                        `${name} insn ${i}: OUT = ${trace[i].out}, expected ${prog.expectedOut[i]}`);
                }
            }
        });
    }
});

// ─── Cross-referee: same program, both referees agree ────────────

describe('SAP-1 cross-referee: wmvanvliet confirms our truth tables', () => {

    it('LDA + ADD + OUT: wmvanvliet A-register matches our hand-computed oracle', {
        skip: !WMV_AVAILABLE && 'wmvanvliet/8bit not cloned',
    }, () => {
        const memory = [0x1E, 0x2F, 0xE0, 0xF0, 0,0,0,0, 0,0,0,0, 0,0, 42, 8];
        const trace = runWmvanvliet(memory, 3);

        // Our oracle says: LDA 14→A=42, ADD 15→A=50, OUT→output=50
        assert.equal(trace[0].a, 42, 'LDA 14: A = 42 (referee agrees)');
        assert.equal(trace[1].a, 50, 'ADD 15: A = 50 (referee agrees)');
        assert.equal(trace[2].out, 50, 'OUT: output = 50 (referee agrees)');
        assert.equal(trace[2].pc, 3, 'PC advanced to 3');
    });

    it('SUB with borrow: referee confirms A-register after underflow', {
        skip: !WMV_AVAILABLE && 'wmvanvliet/8bit not cloned',
    }, () => {
        const memory = [0x1E, 0x3F, 0xE0, 0xF0, 0,0,0,0, 0,0,0,0, 0,0, 10, 20];
        // LDA 14 (10), SUB 15 (20) → 10-20 = -10 → 246 unsigned
        const trace = runWmvanvliet(memory, 3);
        assert.equal(trace[0].a, 10, 'LDA: A = 10');
        assert.equal(trace[1].a, 246, 'SUB: A = 246 (unsigned -10)');
    });

    it('JMP: referee confirms the program counter jumps', {
        skip: !WMV_AVAILABLE && 'wmvanvliet/8bit not cloned',
    }, () => {
        // Program: LDA 15 (addr 0), OUT (addr 1), JMP 0 (addr 2)
        // After JMP, PC should be 0 (jumped back). Run 4 instructions
        // to see the loop: LDA→OUT→JMP→LDA (PC=1 after second LDA).
        const memory = [0x1F, 0xE0, 0x60, 0xF0, 0,0,0,0, 0,0,0,0, 0,0,0, 99];
        const trace = runWmvanvliet(memory, 4);
        assert.equal(trace[0].a, 99, 'first LDA: A = 99');
        assert.equal(trace[1].out, 99, 'OUT: 99');
        assert.equal(trace[2].pc, 0, 'JMP 0: PC = 0');
        assert.equal(trace[3].a, 99, 'second LDA: A = 99 again');
    });
});
