import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const workflow = readFileSync(new URL('../.github/workflows/labwired-wasm.yml', import.meta.url), 'utf8');

test('motion publication is fail-closed for all 250 prerequisite result combinations', () => {
    const expression = workflow.match(/\n    if: \$\{\{ (always\(\) && inputs.publish.*?) \}\}/)?.[1];
    assert.ok(expression, 'actual publish expression must parse');
    const verdict = new Function('inputs', 'needs', 'always', `return (${expression});`);
    const states = ['success', 'failure', 'cancelled', 'skipped', ''];
    let checked = 0;
    for (const requested of [false, true]) {
        for (const determinism of states) for (const tests of states) for (const motion of states) {
            const needs = {determinism: {result: determinism}, test: {result: tests}, motion: {result: motion}};
            const inputs = {publish: true, qualify_motion: requested};
            const expected = determinism === 'success' && tests === 'success' &&
                motion === (requested ? 'success' : 'skipped');
            assert.equal(verdict(inputs, needs, () => true), expected, JSON.stringify({inputs, needs}));
            assert.equal(verdict({...inputs, publish: false}, needs, () => true), false);
            checked++;
        }
    }
    assert.equal(checked, 250);
    assert.match(workflow, /needs: \[determinism, test, motion\]/);
});

test('requested motion cannot report a skipped or zero-test run as qualification', () => {
    const motion = workflow.slice(workflow.indexOf('\n  motion:'), workflow.indexOf('\n  publish:'));
    assert.match(motion, /if: inputs.qualify_motion/);
    assert.match(motion, /LABWIRED_MOTION_REQUIRED: '1'/);
    assert.match(motion, /LABWIRED_REQUIRE_MOTION_RTX: '1'/);
    assert.match(motion, /node test\/labwired-microbit-motion.test.mjs/);
    assert.match(motion, /\$\{tests:-0\}.*-ge 2/);
    assert.match(motion, /\$\{skips:-1\}.*= 0/);
    assert.match(motion, /MICROBIT_WASM_SAMPLE.*-eq 5/);
    assert.match(motion, /if: always\(\)/, 'failed measurement logs must be preserved');
});

test('motion guest source bundle is the exact MIT native-qualified fixture', () => {
    const flags = ['-mcpu=cortex-m4', '-mthumb', '-nostdlib', '-DMICROBIT_MOTION_IO', '-Wl,-T,board-io.ld'];
    const records = ['board-io.S', 'motion-polled.inc', 'board-io.ld'].map(name => [name,
        readFileSync(new URL('./fixtures/labwired/microbit-motion/' + name, import.meta.url))]);
    records.push(['compileFlags', Buffer.from(JSON.stringify(flags))]);
    const parts = [Buffer.from('labwired.microbit.motion-source.v1\0')];
    for (const [name, bytes] of records) {
        const encoded = Buffer.from(name);
        for (const data of [encoded, bytes]) {
            const size = Buffer.alloc(8);
            size.writeBigUInt64BE(BigInt(data.length));
            parts.push(size, data);
        }
    }
    assert.equal(createHash('sha256').update(Buffer.concat(parts)).digest('hex'),
        'e6b8c239dc7ee1aca736671350cda8101f4bf8d6c89d91e2a9e787c85b553939');
});
