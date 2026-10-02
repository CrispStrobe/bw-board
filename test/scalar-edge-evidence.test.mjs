import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const root = new URL('../docs/receipts/2026-10-02-scalar-edge-preflight/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
test('preserved scalar motion receipts reparse all observations and negative floors', () => {
    for (const file of ['hosted-ab-1/abba.json', 'hosted-ab-2/abba.json',
        'vps-motion-primary.json', 'vps-motion-repeat.json',
        'vps-motion-reverse-primary.json', 'vps-motion-reverse-repeat.json']) {
        const receipt = json(file);
        assert.ok(receipt.completedAt && receipt.guestObservationsMatch);
        assert.equal(receipt.runs.length, 4);
        const parsed = receipt.runs.map(r => motionProbeResult(r.stdout, r.exitCode));
        for (const result of parsed) {
            assertSameMotionGuest(parsed[0], result);
            assert.equal(result.allWindowsMeet1x, false);
        }
        for (const label of ['baseline', 'candidate']) {
            const values = parsed.flatMap((r, i) => receipt.runs[i].label === label ? r.samples.map(s => s.rtx) : []);
            assert.equal(values.length, 10);
            assert.equal(median(values), receipt.summary[label].medianRtx);
            assert.equal(Math.min(...values), receipt.summary[label].minimumRtx);
        }
    }
});
test('preserved scalar F0 raw stdout matches every stored child and loaded guest', () => {
    for (const directory of ['hosted-ab-1/f0-abba', 'hosted-ab-2/f0-abba',
        'vps-f0-primary', 'vps-f0-repeat']) {
        const receipt = json(directory + '/abba.json');
        assert.ok(receipt.completedAt && receipt.guestObservationsMatch);
        assert.equal(receipt.runs.length, 4);
        const parsed = receipt.runs.map((r, i) => {
            const result = f0TimingResult(read(`${directory}/${i + 1}-${r.label}/ordinary-stdout.txt`), r.capture.ordinary.exitCode);
            assert.deepEqual(result.workloads, r.capture.ordinary.workloads);
            assert.equal(result.workloads.gpio.allWindowsMeet1x, false);
            assert.equal(result.workloads.ram.allWindowsMeet1x, true);
            return result;
        });
        for (const result of parsed) assertSameF0Guest(parsed[0], result);
    }
});
