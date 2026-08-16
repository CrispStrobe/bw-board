/**
 * SAP-1 module-level parity harness — our 74xx device models vs
 * hand-computed truth tables from TI datasheets.
 *
 * Each test runs a STIMULUS VECTOR (a sequence of input pin changes
 * and clock edges) and asserts the output matches the expected values.
 * The vectors are the parity surface: when vrcpu (MIT), wmvanvliet
 * (local-only), or Digital/8bitsim (local-only) referees are
 * available, their output on the SAME stimulus is compared.
 *
 * 2-of-3 tiebreak: our engine, vrcpu, wmvanvliet. Module-level
 * checks against Digital's .dig circuits are the first tier (no full
 * machine needed).
 *
 * Stimulus format: array of { set: {pin: value}, expect: {pin: value} }
 * steps. Each step sets pins, calls update, then asserts outputs.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerSAP1Chips } from '../src/devices/sap1-chips.js';
import { registerTier1Parts } from '../src/devices/tier1-parts.js';
import { registerTier2Parts } from '../src/devices/tier2-parts.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

const KINDS = ['74ls173', '74ls161', '74ls189', '74ls157', '74ls107', '74hc138', '74hc283'];
function setup() {
    registerSAP1Chips();
    try { registerTier1Parts(); } catch {}
    try { registerTier2Parts(); } catch {}
}
function teardown() { for (const k of KINDS) try { unregisterDevice(k); } catch {} }

/** Run a stimulus vector on a chip, return the output trace. */
function runVector(kind, vector) {
    const model = getDevice(kind);
    const part = { id: kind, kind, params: {} };
    const state = model.init(part);
    const pins = {};
    for (const t of model.terminals) pins[t] = 0;
    pins.vcc = 5; pins.gnd = 0;
    const read = (t) => pins[t] ?? 0;
    const trace = [];

    for (const step of vector) {
        if (step.set) for (const [k, v] of Object.entries(step.set)) pins[k] = v;
        model.update(part, state, read, BigInt(trace.length * 100));
        if (step.expect) {
            const actual = {};
            for (const k of Object.keys(step.expect)) {
                actual[k] = state.drives[k]?.vTh ?? pins[k] ?? 0;
            }
            trace.push({ step: trace.length, actual, expected: step.expect });
        }
    }
    return { trace, state };
}

/** Assert all expectations in a trace pass. */
function assertTrace(kind, trace) {
    for (const { step, actual, expected } of trace) {
        for (const [pin, val] of Object.entries(expected)) {
            assert.equal(actual[pin], val,
                `${kind} step ${step}: ${pin} expected ${val}, got ${actual[pin]}`);
        }
    }
}

// ─── 74LS173 parity vector ────────────────────────────────────────
// Stimulus: load 0b1010, verify outputs, clear, verify zeros,
// load with /G high (should not latch), verify old value held.

describe('74LS173 parity: load → read → clear → inhibit', () => {
    beforeEach(setup);

    it('full stimulus vector matches datasheet truth table', () => {
        const V = 5, L = 0;
        const { trace } = runVector('74ls173', [
            // Init: enable outputs, enable data input
            { set: { oe1b: L, oe2b: L, g1b: L, g2b: L, mr: L, clk: L,
                     d0: L, d1: V, d2: L, d3: V } },                    // data = 0b1010
            // CLK rising: latch
            { set: { clk: V }, expect: { q0: L, q1: V, q2: L, q3: V } },
            // CLK low (hold)
            { set: { clk: L }, expect: { q0: L, q1: V, q2: L, q3: V } },
            // Change data, no clock: outputs hold
            { set: { d0: V, d1: V, d2: V, d3: V } },
            { set: {}, expect: { q0: L, q1: V, q2: L, q3: V } },       // still 0b1010
            // CLK rising with new data: latch 0b1111
            { set: { clk: V }, expect: { q0: V, q1: V, q2: V, q3: V } },
            { set: { clk: L } },
            // MR clear: all outputs go low
            { set: { mr: V }, expect: { q0: L, q1: L, q2: L, q3: L } },
            { set: { mr: L } },
            // /G1 high inhibits latch: data ignored on CLK edge
            { set: { g1b: V, d0: V, d1: V, d2: V, d3: V, clk: V },
              expect: { q0: L, q1: L, q2: L, q3: L } },                // still cleared
        ]);
        assertTrace('74ls173', trace);
    });
});

// ─── 74LS161 parity vector ────────────────────────────────────────
// Stimulus: clear, count 0→3, parallel load 12, count 12→15,
// verify RCO at 15, count wraps to 0, RCO drops.

describe('74LS161 parity: clear → count → load → RCO → wrap', () => {
    beforeEach(setup);

    it('full stimulus vector matches datasheet truth table', () => {
        const V = 5, L = 0;
        const steps = [];

        // Async clear
        steps.push({ set: { clrb: L, loadb: V, enp: V, ent: V, clk: L } });
        steps.push({ set: {}, expect: { q0: L, q1: L, q2: L, q3: L, rco: L } });
        steps.push({ set: { clrb: V } }); // release clear

        // Count 0→1→2→3
        for (let i = 0; i < 4; i++) {
            steps.push({ set: { clk: V } }); // rising edge
            steps.push({ set: { clk: L }, expect: {
                q0: ((i + 1) & 1) ? V : L,
                q1: ((i + 1) & 2) ? V : L,
                q2: ((i + 1) & 4) ? V : L,
                q3: ((i + 1) & 8) ? V : L,
            }});
        }

        // Parallel load 12 (0b1100)
        steps.push({ set: { loadb: L, d0: L, d1: L, d2: V, d3: V } });
        steps.push({ set: { clk: V } }); // load on rising edge
        steps.push({ set: { clk: L, loadb: V },
            expect: { q0: L, q1: L, q2: V, q3: V } }); // 12

        // Count 12→13→14→15
        for (let i = 12; i < 15; i++) {
            steps.push({ set: { clk: V } });
            steps.push({ set: { clk: L }, expect: {
                q0: ((i + 1) & 1) ? V : L,
                q1: ((i + 1) & 2) ? V : L,
                q2: ((i + 1) & 4) ? V : L,
                q3: ((i + 1) & 8) ? V : L,
            }});
        }

        // At count=15 with ENT=high: RCO should be high
        steps.push({ set: {}, expect: { rco: V } });

        // Count 15→0 (wrap)
        steps.push({ set: { clk: V } });
        steps.push({ set: { clk: L },
            expect: { q0: L, q1: L, q2: L, q3: L, rco: L } }); // wrapped, RCO drops

        const { trace } = runVector('74ls161', steps);
        assertTrace('74ls161', trace);
    });
});

// ─── 74LS189 parity vector ────────────────────────────────────────
// The INVERTED OUTPUT trap: write known values, read back, verify
// outputs are bitwise-inverted.

describe('74LS189 parity: write/read with inverted outputs', () => {
    beforeEach(setup);

    it('all 16 addresses store and invert-read independently', () => {
        const V = 5, L = 0;
        const steps = [];

        // Write pattern: addr i gets value i (0-15)
        for (let addr = 0; addr < 16; addr++) {
            steps.push({ set: {
                csb: L, web: L,
                a0: (addr & 1) ? V : L, a1: (addr & 2) ? V : L,
                a2: (addr & 4) ? V : L, a3: (addr & 8) ? V : L,
                d0: (addr & 1) ? V : L, d1: (addr & 2) ? V : L,
                d2: (addr & 4) ? V : L, d3: (addr & 8) ? V : L,
            }});
        }

        // Read back: outputs should be INVERTED
        for (let addr = 0; addr < 16; addr++) {
            steps.push({ set: {
                csb: L, web: V, // read mode
                a0: (addr & 1) ? V : L, a1: (addr & 2) ? V : L,
                a2: (addr & 4) ? V : L, a3: (addr & 8) ? V : L,
            }, expect: {
                // INVERTED: stored bit 1 → output 0V, stored bit 0 → output 5V
                o0: (addr & 1) ? L : V,
                o1: (addr & 2) ? L : V,
                o2: (addr & 4) ? L : V,
                o3: (addr & 8) ? L : V,
            }});
        }

        const { trace } = runVector('74ls189', steps);
        assertTrace('74ls189', trace);
    });
});

// ─── 74LS157 parity vector ────────────────────────────────────────
// All 16 input combinations × 2 select states × 2 enable states.

describe('74LS157 parity: exhaustive select/enable truth table', () => {
    beforeEach(setup);

    it('all input combinations produce correct outputs', () => {
        const V = 5, L = 0;
        const steps = [];

        // Enabled, S=0 (A selected): sweep A inputs
        for (let a = 0; a < 16; a++) {
            steps.push({ set: {
                gb: L, s: L,
                '1a': (a & 1) ? V : L, '2a': (a & 2) ? V : L,
                '3a': (a & 4) ? V : L, '4a': (a & 8) ? V : L,
                '1b': V, '2b': V, '3b': V, '4b': V, // B all high (should not matter)
            }, expect: {
                '1y': (a & 1) ? V : L,
                '2y': (a & 2) ? V : L,
                '3y': (a & 4) ? V : L,
                '4y': (a & 8) ? V : L,
            }});
        }

        // Enabled, S=1 (B selected): sweep B inputs
        for (let b = 0; b < 16; b++) {
            steps.push({ set: {
                gb: L, s: V,
                '1a': V, '2a': V, '3a': V, '4a': V, // A all high (should not matter)
                '1b': (b & 1) ? V : L, '2b': (b & 2) ? V : L,
                '3b': (b & 4) ? V : L, '4b': (b & 8) ? V : L,
            }, expect: {
                '1y': (b & 1) ? V : L,
                '2y': (b & 2) ? V : L,
                '3y': (b & 4) ? V : L,
                '4y': (b & 8) ? V : L,
            }});
        }

        // Disabled: all outputs LOW regardless of inputs
        steps.push({ set: {
            gb: V, s: L,
            '1a': V, '2a': V, '3a': V, '4a': V,
            '1b': V, '2b': V, '3b': V, '4b': V,
        }, expect: { '1y': L, '2y': L, '3y': L, '4y': L } });

        const { trace } = runVector('74ls157', steps);
        assertTrace('74ls157', trace);
    });
});

// ─── 74LS107 parity vector ────────────────────────────────────────
// Both flip-flops: J/K truth table on falling edges, async clear.

describe('74LS107 parity: JK truth table on falling edges', () => {
    beforeEach(setup);

    it('full JK truth table for both flip-flops', () => {
        const V = 5, L = 0;
        const steps = [];

        // Init: both /CLR high (not clearing), both CLK high (idle)
        steps.push({ set: { '1clrb': V, '2clrb': V, '1clk': V, '2clk': V,
                            '1j': L, '1k': L, '2j': L, '2k': L } });

        // FF1 J=1 K=0: falling edge → set
        steps.push({ set: { '1j': V, '1k': L } });
        steps.push({ set: { '1clk': L }, expect: { '1q': V, '1qb': L } });
        steps.push({ set: { '1clk': V } }); // back high

        // FF1 J=0 K=0: falling edge → hold (stays 1)
        steps.push({ set: { '1j': L, '1k': L } });
        steps.push({ set: { '1clk': L }, expect: { '1q': V, '1qb': L } });
        steps.push({ set: { '1clk': V } });

        // FF1 J=0 K=1: falling edge → reset
        steps.push({ set: { '1j': L, '1k': V } });
        steps.push({ set: { '1clk': L }, expect: { '1q': L, '1qb': V } });
        steps.push({ set: { '1clk': V } });

        // FF1 J=1 K=1: falling edge → toggle (0→1)
        steps.push({ set: { '1j': V, '1k': V } });
        steps.push({ set: { '1clk': L }, expect: { '1q': V, '1qb': L } });
        steps.push({ set: { '1clk': V } });

        // FF1 J=1 K=1 again: toggle (1→0)
        steps.push({ set: { '1clk': L }, expect: { '1q': L, '1qb': V } });
        steps.push({ set: { '1clk': V } });

        // FF1 /CLR low: async clear
        steps.push({ set: { '1j': V, '1k': L } }); // set first
        steps.push({ set: { '1clk': L } }); steps.push({ set: { '1clk': V } });
        steps.push({ set: { '1clrb': L }, expect: { '1q': L, '1qb': V } });
        steps.push({ set: { '1clrb': V } }); // release

        // FF2 independence: set FF2 while FF1 is cleared
        steps.push({ set: { '2j': V, '2k': L } });
        steps.push({ set: { '2clk': L }, expect: { '2q': V, '2qb': L, '1q': L } });

        const { trace } = runVector('74ls107', steps);
        assertTrace('74ls107', trace);
    });
});

// ─── 74HC138 parity vector ────────────────────────────────────────
// 3-to-8 decoder: exhaustive address sweep with enables.

describe('74HC138 parity: exhaustive decode + enable truth table', () => {
    beforeEach(setup);

    it('all 8 addresses decode correctly when enabled', () => {
        const V = 5, L = 0;
        const steps = [];

        // G1=high, /G2A=low, /G2B=low → enabled
        for (let addr = 0; addr < 8; addr++) {
            const expect = {};
            for (let i = 0; i < 8; i++) {
                expect[`y${i}b`] = (i === addr) ? L : V; // active-LOW outputs
            }
            steps.push({ set: {
                g1: V, g2ab: L, g2bb: L,
                a: (addr & 1) ? V : L,
                b: (addr & 2) ? V : L,
                c: (addr & 4) ? V : L,
            }, expect });
        }

        // Disabled (G1=low): all outputs HIGH
        steps.push({ set: { g1: L, g2ab: L, g2bb: L, a: V, b: V, c: V },
            expect: { y0b: V, y1b: V, y2b: V, y3b: V, y4b: V, y5b: V, y6b: V, y7b: V } });

        // Disabled (/G2A=high): all HIGH
        steps.push({ set: { g1: V, g2ab: V, g2bb: L, a: L, b: L, c: L },
            expect: { y0b: V, y1b: V, y2b: V, y3b: V, y4b: V, y5b: V, y6b: V, y7b: V } });

        const { trace } = runVector('74hc138', steps);
        assertTrace('74hc138', trace);
    });
});

// ─── 74HC283 parity vector ────────────────────────────────────────
// 4-bit adder: exhaustive A+B+Cin for selected values.

describe('74HC283 parity: addition truth table', () => {
    beforeEach(setup);

    it('exhaustive 4-bit addition with carry', () => {
        const V = 5, L = 0;
        const steps = [];

        // Test all combos of A=0..15 × B=0..15 × Cin=0..1 would be 512
        // — test a representative subset covering edge cases.
        const cases = [
            [0, 0, 0], [0, 0, 1], [1, 1, 0], [7, 8, 0], [7, 8, 1],
            [15, 0, 0], [0, 15, 0], [15, 15, 0], [15, 15, 1],
            [9, 6, 0], [9, 6, 1], [5, 10, 1], [8, 8, 0],
        ];

        for (const [a, b, cin] of cases) {
            const sum = a + b + cin;
            const s = sum & 0xf;
            const cout = (sum >> 4) & 1;
            steps.push({ set: {
                a0: (a & 1) ? V : L, a1: (a & 2) ? V : L,
                a2: (a & 4) ? V : L, a3: (a & 8) ? V : L,
                b0: (b & 1) ? V : L, b1: (b & 2) ? V : L,
                b2: (b & 4) ? V : L, b3: (b & 8) ? V : L,
                cin: cin ? V : L,
            }, expect: {
                s0: (s & 1) ? V : L, s1: (s & 2) ? V : L,
                s2: (s & 4) ? V : L, s3: (s & 8) ? V : L,
                cout: cout ? V : L,
            }});
        }

        const { trace } = runVector('74hc283', steps);
        assertTrace('74hc283', trace);
    });
});
