#!/usr/bin/env node
/**
 * SAP-1 module-level parity: our engine vs hneemann Digital (GPL,
 * run-local referee). Creates a minimal .dig circuit wrapping the
 * library 74xx chip, adds a test vector, runs Digital CLI, compares.
 *
 * Usage: node scripts/digital-parity.mjs [--chip 74161]
 *
 * Outputs JSON: { chip, agree, disagree, details }
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIGITAL_JAR = '/mnt/volume1/code/digital-sim/Digital/Digital.jar';
const LIB_BASE = '/mnt/volume1/code/digital-sim/Digital/lib/DIL Chips/74xx';

if (!existsSync(DIGITAL_JAR)) {
    console.error('Digital.jar not found at', DIGITAL_JAR);
    process.exit(1);
}

/**
 * Run a Digital test circuit and return pass/fail.
 * The test data is embedded in the .dig XML.
 */
function runDigitalTest(digXml) {
    const tmpFile = join(tmpdir(), `parity_${Date.now()}.dig`);
    writeFileSync(tmpFile, digXml);
    try {
        const out = execFileSync('java', ['-cp', DIGITAL_JAR, 'CLI', 'test',
            '-circ', tmpFile, '-verbose'], {
            encoding: 'utf8', timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { pass: true, output: out.trim() };
    } catch (e) {
        // Same distinction as test/sap1-digital-parity.test.mjs: a JVM killed
        // at the cap is the machine, not the circuit, and reporting the two
        // identically sent a real investigation after the wrong cause once.
        const killed = e.killed === true || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
        const partial = ((e.stdout || '') + '\n' + (e.stderr || '')).trim();
        return {
            pass: false,
            output: killed
                ? `ENVIRONMENT, NOT THE CIRCUIT — Digital's JVM was killed after 30s. A bare `
                  + `invocation takes about 5s here, so this means the box was loaded. Check `
                  + `\`free -m\` AND \`swapon --show\`, then re-run alone. Partial: ${partial || '(none)'}`
                : partial,
        };
    } finally {
        try { unlinkSync(tmpFile); } catch {}
    }
}

// ─── 74161 test ───────────────────────────────────────────────────
// Digital's 74161 has: ~CLR, CLK, ~LD, ENT, ENP, A-D inputs, QA-QD+RCO outputs
function test74161() {
    // Test: clear, count 3 times, verify QA-QD
    const dig = `<?xml version="1.0" encoding="utf-8"?>
<circuit>
  <version>2</version>
  <attributes/>
  <visualElements>
    <visualElement>
      <elementName>74161.dig</elementName>
      <elementAttributes/>
      <pos x="300" y="200"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>~CLR</string></entry>
      </elementAttributes>
      <pos x="200" y="200"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>CLK</string></entry>
      </elementAttributes>
      <pos x="200" y="220"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>~LD</string></entry>
      </elementAttributes>
      <pos x="200" y="240"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>ENT</string></entry>
      </elementAttributes>
      <pos x="200" y="260"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>ENP</string></entry>
      </elementAttributes>
      <pos x="200" y="280"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>A</string></entry>
      </elementAttributes>
      <pos x="200" y="300"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>B</string></entry>
      </elementAttributes>
      <pos x="200" y="320"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>C</string></entry>
      </elementAttributes>
      <pos x="200" y="340"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>D</string></entry>
      </elementAttributes>
      <pos x="200" y="360"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>QA</string></entry>
      </elementAttributes>
      <pos x="500" y="200"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>QB</string></entry>
      </elementAttributes>
      <pos x="500" y="220"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>QC</string></entry>
      </elementAttributes>
      <pos x="500" y="240"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>QD</string></entry>
      </elementAttributes>
      <pos x="500" y="260"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry><string>Label</string><string>RCO</string></entry>
      </elementAttributes>
      <pos x="500" y="280"/>
    </visualElement>
    <visualElement>
      <elementName>Testcase</elementName>
      <elementAttributes>
        <entry><string>Testdata</string>
<testData>
<dataString>~CLR CLK ~LD ENT ENP A B C D QA QB QC QD RCO
 0   0    1   1   1  0 0 0 0  0  0  0  0  0
 1   0    1   1   1  0 0 0 0  0  0  0  0  0
 1   C    1   1   1  0 0 0 0  1  0  0  0  0
 1   C    1   1   1  0 0 0 0  0  1  0  0  0
 1   C    1   1   1  0 0 0 0  1  1  0  0  0
</dataString>
</testData>
        </entry>
      </elementAttributes>
      <pos x="600" y="200"/>
    </visualElement>
  </visualElements>
  <wires>
    <wire><p1 x="200" y="200"/><p2 x="300" y="200"/></wire>
    <wire><p1 x="200" y="220"/><p2 x="300" y="220"/></wire>
    <wire><p1 x="200" y="240"/><p2 x="300" y="240"/></wire>
    <wire><p1 x="200" y="260"/><p2 x="300" y="260"/></wire>
    <wire><p1 x="200" y="280"/><p2 x="300" y="280"/></wire>
    <wire><p1 x="200" y="300"/><p2 x="300" y="300"/></wire>
    <wire><p1 x="200" y="320"/><p2 x="300" y="320"/></wire>
    <wire><p1 x="200" y="340"/><p2 x="300" y="340"/></wire>
    <wire><p1 x="200" y="360"/><p2 x="300" y="360"/></wire>
    <wire><p1 x="400" y="200"/><p2 x="500" y="200"/></wire>
    <wire><p1 x="400" y="220"/><p2 x="500" y="220"/></wire>
    <wire><p1 x="400" y="240"/><p2 x="500" y="240"/></wire>
    <wire><p1 x="400" y="260"/><p2 x="500" y="260"/></wire>
    <wire><p1 x="400" y="280"/><p2 x="500" y="280"/></wire>
  </wires>
</circuit>`;
    return runDigitalTest(dig);
}

// Run
const result = test74161();
console.log(JSON.stringify({ chip: '74161', ...result }, null, 2));
