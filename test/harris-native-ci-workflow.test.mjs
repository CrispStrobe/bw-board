import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/harris-native.yml', import.meta.url), 'utf8');
function contract(source) {
    assert.match(source, /branches: \['\*\*'\]/);
    assert.match(source, /  pull_request:/); assert.match(source, /  workflow_dispatch:/);
    assert.match(source, /node-version: 22/);
    for (const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g)) assert.match(action[1], /^[0-9a-f]{40}$/);
    assert.match(source, /mktemp -d "\$RUNNER_TEMP\/harris-native\.XXXXXX"/);
    assert.match(source, /apt-get install --no-install-recommends -y clang lld/);
    assert.match(source, /WASM_LD=\$\(command -v wasm-ld\)/);
    assert.match(source, /node scripts\/build-wired-net-kernel\.mjs "\$HARRIS_RECEIPT_DIR"/);
    assert.match(source, /HARRIS_NET_WASM=\$HARRIS_RECEIPT_DIR\/wired-net-kernel\.wasm/);
    for (const file of ['harris-native-*.test.mjs', 'harris-80c286-memory-board.test.mjs',
        'harris-80c286-boot-cpu.test.mjs', 'harris-boot-cpu-batching.test.mjs', 'harris-run-transactions.test.mjs']) assert.ok(source.includes(`test/${file}`), file);
    assert.match(source, /--test-concurrency=1 --test-reporter=tap/);
    assert.ok(source.includes('/^# skipped 0$/m'));
    assert.ok(source.includes('/^# tests [1-9][0-9]*$/m'));
    assert.ok(source.includes('assert.doesNotMatch(tap,/# SKIP\\b/i)'));
    assert.match(source, /node --expose-gc scripts\/measure-harris-hybrid-producers\.mjs --experimental/);
    assert.match(source, /hybrid-producer-attribution\.json/);
    assert.match(source, /--cpu-prof-name=hybrid-producer\.cpuprofile/);
    assert.match(source, /--heap-prof-name=hybrid-producer\.heapprofile/);
    assert.match(source, /test -s "\$HARRIS_RECEIPT_DIR\/hybrid-producer\.cpuprofile"/);
    assert.match(source, /test -s "\$HARRIS_RECEIPT_DIR\/hybrid-producer\.heapprofile"/);
    assert.ok(source.includes('assert.equal(r.expected.physicalClock,r.expected.periods+67)'));
    assert.match(source, /CHROME_BIN=\$\(command -v google-chrome/);
    assert.match(source, /node bench\/harris-browser\.mjs 1 memory,io,dma,interrupt,idle reference,packed/);
    assert.match(source, /test -s "\$HARRIS_BROWSER_REPORT"/);
    assert.match(source, /if: \$\{\{ always\(\) && env.HARRIS_RECEIPT_DIR != '' \}\}/);
    assert.match(source, /if-no-files-found: error/);
    assert.doesNotMatch(source, /continue-on-error: true|\|\| true/);
}
test('dedicated native CI rebuilds and exercises the explicit artifact without optional skips', () => contract(workflow));
test('contract detects disappearing native inputs, skip acceptance and unpinned actions', () => {
    for (const source of [workflow.replace('test/harris-run-transactions.test.mjs', ''),
        workflow.replace('HARRIS_NET_WASM=$HARRIS_RECEIPT_DIR/wired-net-kernel.wasm', 'UNUSED_ARTIFACT=missing'),
        workflow.replace('/^# skipped 0$/m', '/^# skipped [0-9]+$/m'),
        workflow.replace('scripts/measure-harris-hybrid-producers.mjs', 'scripts/missing-producer-measurement.mjs'),
        workflow.replace('r.expected.periods+67', 'r.expected.periods'),
        workflow.replace('--heap-prof-name=hybrid-producer.heapprofile', '--heap-prof-name=missing.heapprofile'),
        workflow.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v4'),
        workflow.replace('node bench/harris-browser.mjs 1', 'echo browser-disabled 1')]) assert.throws(() => contract(source));
});
