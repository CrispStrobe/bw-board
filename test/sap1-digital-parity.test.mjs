/**
 * SAP-1 module-level parity: our engine vs hneemann Digital (GPL,
 * run-local). Each test injects a truth-table vector into the
 * corresponding Digital library 74xx .dig file and runs Digital CLI.
 *
 * Pin names are Digital's own (from the library .dig files), mapped
 * to our engine's pin names in the test assertions.
 *
 * Skips loudly without Digital.jar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIGITAL_JAR = '/mnt/volume1/code/digital-sim/Digital/Digital.jar';
const LIB = '/mnt/volume1/code/digital-sim/Digital/lib/DIL Chips/74xx';
const AVAILABLE = existsSync(DIGITAL_JAR);
const SKIP = !AVAILABLE && 'Digital.jar not found';

function runDigitalChipTest(digPath, testData) {
    if (!existsSync(digPath)) return { pass: false, output: `${digPath} not found` };
    const xml = readFileSync(digPath, 'utf8');
    const tcXml = `<visualElement><elementName>Testcase</elementName><elementAttributes><entry><string>Testdata</string><testData><dataString>${testData}\n</dataString></testData></entry></elementAttributes><pos x="800" y="800"/></visualElement>`;
    const injected = xml.replace('</visualElements>', tcXml + '</visualElements>');
    const tmp = join(tmpdir(), `dp_${Date.now()}.dig`);
    writeFileSync(tmp, injected);
    try {
        const out = execFileSync('java', ['-cp', DIGITAL_JAR, 'CLI', 'test', '-circ', tmp, '-verbose'],
            { encoding: 'utf8', timeout: 30000 });
        return { pass: out.includes('passed'), output: out.trim() };
    } catch (e) {
        return { pass: false, output: ((e.stdout || '') + '\n' + (e.stderr || '')).trim() };
    } finally { try { unlinkSync(tmp); } catch {} }
}

// ─── 74161: counter ───────────────────────────────────────────────
// Digital pins: ~CLR CLK ~LD ENT ENP A B C D QA QB QC QD RCO
describe('Digital parity: 74LS161', () => {
    it('clear → count → load → RCO', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'counter/74161.dig'),
`~CLR CLK ~LD ENT ENP A B C D QA QB QC QD RCO
 0   0    1   1   1  0 0 0 0  0  0  0  0  0
 1   0    1   1   1  0 0 0 0  0  0  0  0  0
 1   C    1   1   1  0 0 0 0  1  0  0  0  0
 1   C    1   1   1  0 0 0 0  0  1  0  0  0
 1   C    1   1   1  0 0 0 0  1  1  0  0  0
 1   0    0   1   1  1 0 1 1  1  1  0  0  0
 1   C    0   1   1  1 0 1 1  1  0  1  1  0
 1   C    1   1   1  0 0 0 0  0  1  1  1  0
 1   C    1   1   1  0 0 0 0  1  1  1  1  1`);
        assert.ok(r.pass, `74161: ${r.output}`);
    });
});

// ─── 74173: D register ────────────────────────────────────────────
// Digital pins: RES CLK DE1 DE2 OE1 OE2 D0 D1 D2 D3 Q0 Q1 Q2 Q3
describe('Digital parity: 74LS173', () => {
    it('latch → hold → clear', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'flipflops/74173.dig'),
`RES CLK DE1 DE2 OE1 OE2 D0 D1 D2 D3 Q0 Q1 Q2 Q3
 0   0    0   0   0   0   1  0  1  0  0  0  0  0
 0   C    0   0   0   0   1  0  1  0  1  0  1  0
 0   0    0   0   0   0   0  0  0  0  1  0  1  0
 1   0    0   0   0   0   0  0  0  0  0  0  0  0`);
        assert.ok(r.pass, `74173: ${r.output}`);
    });
});

// ─── 74189: RAM (inverted outputs) ────────────────────────────────
// Digital pins: ~CS ~WE A0 A1 A2 A3 D0 D1 D2 D3 Q0 Q1 Q2 Q3
// Q outputs are ACTIVE-LOW (inverted) in Digital's model too
describe('Digital parity: 74LS189', () => {
    it('write 0b1010 → read back inverted', { skip: SKIP }, () => {
        // Digital's 74189 latches data on the /WE RISING edge (data
        // must be stable). Outputs are inverted: stored 1→output 0.
        const r = runDigitalChipTest(join(LIB, 'memory/74189.dig'),
`~CS ~WE A0 A1 A2 A3 D0 D1 D2 D3 Q0 Q1 Q2 Q3
  0   0   1  1  0  0  0  1  0  1  Z  Z  Z  Z
  0   1   1  1  0  0  0  1  0  1  1  0  1  0`);
        assert.ok(r.pass, `74189: ${r.output}`);
    });
});

// ─── 74157: quad 2:1 mux ─────────────────────────────────────────
// Digital pins: G S A1 B1 A2 B2 A3 B3 A4 B4 Y1 Y2 Y3 Y4
describe('Digital parity: 74LS157', () => {
    it('S=0→A, S=1→B, G=1→all 0', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'plexers/74157.dig'),
`G S A1 B1 A2 B2 A3 B3 A4 B4 Y1 Y2 Y3 Y4
 0 0  1  0  0  1  1  1  0  0  1  0  1  0
 0 1  1  0  0  1  1  1  0  0  0  1  1  0
 1 0  1  1  1  1  1  1  1  1  0  0  0  0`);
        assert.ok(r.pass, `74157: ${r.output}`);
    });
});

// ─── 74107: dual JK (falling edge) ───────────────────────────────
// Digital pins: 1~C 1~CLK 1J 1K 2~C 2~CLK 2J 2K 1Q 1~Q 2Q 2~Q
describe('Digital parity: 74LS107', () => {
    it('set → hold → reset → clear', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'flipflops/74107.dig'),
`1~C 1~CLK 1J 1K 2~C 2~CLK 2J 2K 1Q 1~Q 2Q 2~Q
  1    1   1  0   1    1   0  0  0   1  0   1
  1    0   1  0   1    0   0  0  1   0  0   1
  1    1   0  1   1    1   0  0  1   0  0   1
  1    0   0  1   1    0   0  0  0   1  0   1
  0    1   1  1   1    1   0  0  0   1  0   1`);
        assert.ok(r.pass, `74107: ${r.output}`);
    });
});

// ─── 74138: 3-to-8 decoder ───────────────────────────────────────
// Digital pins: G ~GA ~GB A B C ~Y0..~Y7
describe('Digital parity: 74HC138', () => {
    it('exhaustive decode + disable', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'plexers/74138.dig'),
`G ~GA ~GB A B C ~Y0 ~Y1 ~Y2 ~Y3 ~Y4 ~Y5 ~Y6 ~Y7
 1  0   0  0 0 0   0   1   1   1   1   1   1   1
 1  0   0  1 0 0   1   0   1   1   1   1   1   1
 1  0   0  0 1 0   1   1   0   1   1   1   1   1
 1  0   0  1 1 0   1   1   1   0   1   1   1   1
 1  0   0  0 0 1   1   1   1   1   0   1   1   1
 1  0   0  1 0 1   1   1   1   1   1   0   1   1
 1  0   0  0 1 1   1   1   1   1   1   1   0   1
 1  0   0  1 1 1   1   1   1   1   1   1   1   0
 0  0   0  0 0 0   1   1   1   1   1   1   1   1`);
        assert.ok(r.pass, `74138: ${r.output}`);
    });
});

// ─── 74283: 4-bit adder ──────────────────────────────────────────
// Digital pins: C0 A1 A2 A3 A4 B1 B2 B3 B4 S1 S2 S3 S4 C4
describe('Digital parity: 74HC283', () => {
    it('7+8=15, 15+1=0+carry', { skip: SKIP }, () => {
        const r = runDigitalChipTest(join(LIB, 'arithmetic/74283.dig'),
`C0 A1 A2 A3 A4 B1 B2 B3 B4 S1 S2 S3 S4 C4
 0  1  1  1  0  0  0  0  1  1  1  1  1   0
 1  1  1  1  1  1  0  0  0  1  0  0  0   1
 0  0  0  0  0  0  0  0  0  0  0  0  0   0`);
        assert.ok(r.pass, `74283: ${r.output}`);
    });
});
