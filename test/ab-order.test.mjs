import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparisonOrder} from '../scripts/lib/ab-order.mjs';

test('default ABBA and optional BAAB balance both labels and mirror process positions', () => {
    assert.deepEqual(comparisonOrder(), ['baseline', 'candidate', 'candidate', 'baseline']);
    assert.deepEqual(comparisonOrder(true), ['candidate', 'baseline', 'baseline', 'candidate']);
    for (const reverse of [false, true]) {
        const order = comparisonOrder(reverse);
        assert.equal(order.filter(label => label === 'candidate').length, 2);
        order[0] = 'mutated';
        assert.notEqual(comparisonOrder(reverse)[0], 'mutated');
    }
});

test('both ordinary runners use explicit order control and reject injected Node options', () => {
    for (const name of ['motion', 'f0']) {
        const source = readFileSync(new URL(`../scripts/probe-labwired-${name}-ab.mjs`, import.meta.url), 'utf8');
        assert.match(source, /order: comparisonOrder\(process.argv.includes\('--reverse'\)\)/);
        assert.match(source, /if \(process.env.NODE_OPTIONS\) throw Error/);
        assert.match(source, /samples.every\(s => s.rtx >= 1\)/);
    }
});
