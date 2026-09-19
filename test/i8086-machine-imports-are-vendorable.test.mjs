/**
 * The generated 8088 timing tables are an optional payload. The default
 * i8086-machine import must remain usable by downstreams that do not vendor it.
 *
 * This is a dependency boundary, not a file-size boundary. `i8086.js` is large
 * handwritten core logic and belongs in the default graph; `i8088-timing.js`
 * and its generated `i8088-cycles.js` payload do not. Walk the complete static
 * relative-import graph so a small forwarding module cannot hide either file.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const OPTIONAL_TIMING_PAYLOAD = new Set(['i8088-timing.js', 'i8088-cycles.js']);

function staticRelativeImports(source) {
    const specifiers = [];
    const statements = [
        /^\s*import\s+(?:[^;]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm,
        /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/gm,
    ];
    for (const pattern of statements) {
        for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
    }
    return specifiers;
}

function staticImportGraph(entry, read = file => readFileSync(path.join(SRC, file), 'utf8')) {
    const parent = new Map([[entry, null]]);
    const pending = [entry];
    while (pending.length) {
        const importer = pending.pop();
        for (const specifier of staticRelativeImports(read(importer))) {
            let dependency = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
            if (!path.posix.extname(dependency)) dependency += '.js';
            if (parent.has(dependency)) continue;
            parent.set(dependency, importer);
            pending.push(dependency);
        }
    }
    return parent;
}

function importPath(graph, target) {
    if (!graph.has(target)) return null;
    const result = [];
    for (let file = target; file !== null; file = graph.get(file)) result.push(file);
    return result.reverse();
}

test('the default i8086 machine graph excludes the optional 8088 timing payload', () => {
    const graph = staticImportGraph('i8086-machine.js');
    assert.ok(graph.size > 15,
        `fixture: only ${graph.size} modules found — the scan is not traversing the machine graph`);

    const violations = [...OPTIONAL_TIMING_PAYLOAD]
        .map(file => importPath(graph, file))
        .filter(Boolean)
        .map(files => files.join(' -> '));
    assert.deepEqual(violations, [],
        'the default machine statically reaches the optional 8088 timing payload. '
        + 'Inject the estimator, as enableI8088CycleTiming does. Import path(s):\n'
        + violations.join('\n'));

    assert.ok(graph.has('i8086.js'), 'fixture: the required CPU core is missing from the graph');
});

test('the boundary scan catches direct and transitive forbidden imports', () => {
    const graphFor = sources => staticImportGraph('i8086-machine.js', file => {
        assert.ok(Object.hasOwn(sources, file), `fixture has no source for ${file}`);
        return sources[file];
    });

    const direct = graphFor({
        'i8086-machine.js': "import './i8088-cycles.js';",
        'i8088-cycles.js': '',
    });
    assert.deepEqual(importPath(direct, 'i8088-cycles.js'),
        ['i8086-machine.js', 'i8088-cycles.js']);

    const transitive = graphFor({
        'i8086-machine.js': "export { helper } from './forwarder.js';",
        'forwarder.js': "import {\n CycleEstimator\n} from './i8088-timing.js';\nexport const helper = CycleEstimator;",
        'i8088-timing.js': "import { TABLES } from './i8088-cycles.js';\nexport const CycleEstimator = TABLES;",
        'i8088-cycles.js': 'export const TABLES = {};',
    });
    assert.deepEqual(importPath(transitive, 'i8088-cycles.js'), [
        'i8086-machine.js', 'forwarder.js', 'i8088-timing.js', 'i8088-cycles.js',
    ]);
});

test('the estimator refuses BY NAME rather than throwing on new undefined', async () => {
    const {I8086Machine} = await import('../src/i8086-machine.js');
    const m = new I8086Machine();
    assert.throws(() => m.enableI8088CycleTiming(true), /needs its estimator injected/,
        'a caller who forgets must learn what to pass, not get a TypeError from `new undefined`');
    assert.equal(m.enableI8088CycleTiming(false), false,
        'and disabling still needs no estimator at all');
});
