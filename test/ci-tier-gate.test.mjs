import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci-tier-gate.yml', import.meta.url), 'utf8');

test('CI gate accepts exact-head local/Kaggle validation without the thorough tier', () => {
    assert.match(workflow, /ci:local/);
    assert.match(workflow, /HAS_LOCAL/);
    assert.match(workflow, /Local-validation:/);
    assert.match(workflow, /PASS/);
    assert.match(workflow, /EXPECTED_HEAD/);
    assert.match(workflow, /does not start the thorough GitHub tier/);
});

test('CI gate keeps the first-introduction diagnostic exception bounded', () => {
    assert.match(workflow, /check-motion-diagnostic-scope\.mjs/);
    assert.match(workflow, /git rev-parse HEAD/);
    assert.match(workflow, /every other enabled fast check remains required/);
});
