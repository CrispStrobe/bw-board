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
/** Six times the ~5s a bare invocation takes here. Generous on an idle box,
 *  and reachable on a loaded one — see the catch below. */
const TIMEOUT_MS = 30000;

function runDigitalChipTest(digPath, testData) {
    if (!existsSync(digPath)) return { pass: false, output: `${digPath} not found` };
    const xml = readFileSync(digPath, 'utf8');
    const tcXml = `<visualElement><elementName>Testcase</elementName><elementAttributes><entry><string>Testdata</string><testData><dataString>${testData}\n</dataString></testData></entry></elementAttributes><pos x="800" y="800"/></visualElement>`;
    const injected = xml.replace('</visualElements>', tcXml + '</visualElements>');
    const tmp = join(tmpdir(), `dp_${Date.now()}.dig`);
    writeFileSync(tmp, injected);
    try {
        const out = execFileSync('java', ['-cp', DIGITAL_JAR, 'CLI', 'test', '-circ', tmp, '-verbose'],
            { encoding: 'utf8', timeout: TIMEOUT_MS });
        // THE EXIT CODE IS DOING THE WORK, AND NOTHING SAID SO. Measured:
        // given one correct row and one wrong row in the same element, Digital
        // prints
        //
        //     unnamed: passed
        //     unnamed: failed (50%)
        //     ... Tests have failed.
        //
        // so `out.includes('passed')` is TRUE for a run that failed. What
        // actually protects this gate is that Digital exits non-zero, sending
        // the mixed case to the catch branch — an undocumented coupling the
        // substring check was quietly relying on. Harmless today; a hole the
        // moment Digital exits 0 with a mixed result, or a circuit carries a
        // passing element beside a failing one.
        //
        // So the verdict is now explicit on both halves: something passed, and
        // NOTHING failed. Substring matching cannot tell a partial success
        // from a total one — the same lesson the disassembler's exclusion key
        // learned when it matched an escaped quote.
        const failed = /failed|Tests have failed/i.test(out);
        return { pass: out.includes('passed') && !failed, output: out.trim() };
    } catch (e) {
        // A KILLED JVM IS NOT A DISAGREEING CHIP, and until now it reported as
        // one: every failure path returned `pass: false` with whatever partial
        // stdout had arrived, so a machine under memory pressure produced a
        // message that read exactly like a truth-table mismatch. That cost a
        // real investigation on 2026-09-04 — four of these went red in a full
        // suite run, were reported upstream as a possible defect, and turned
        // out to be a JVM killed at the cap on a box whose swap was 11.9 GB of
        // 12 GB used. The same file passed 7/7 alone minutes later.
        //
        // The verdict is deliberately still FAIL rather than skip: a check that
        // could not run has not passed, and a skip reads the same as a pass in
        // a summary line. What changes is that it now says WHICH failure it is.
        const killed = e.killed === true || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
        const partial = ((e.stdout || '') + '\n' + (e.stderr || '')).trim();
        if (killed) {
            return {
                pass: false,
                output: `ENVIRONMENT, NOT THE CIRCUIT — the Digital JVM was killed after `
                    + `${TIMEOUT_MS / 1000}s. A bare invocation on this box takes about 5s, so a `
                    + `failure at the cap means the machine was loaded, not that the truth table `
                    + `disagreed. Check \`free -m\` AND \`swapon --show\` before chasing this, `
                    + `and re-run the file alone. Partial output: ${partial || '(none)'}`,
            };
        }
        return { pass: false, output: partial };
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
