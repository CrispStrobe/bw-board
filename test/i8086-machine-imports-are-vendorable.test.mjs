/**
 * `i8086-machine.js` must not statically import anything a downstream vendor
 * cannot take.
 *
 * It used to import `./i8088-timing.js`, which imports `./i8088-cycles.js` — a
 * generated table of 974,864 bytes. Both static, so every bundle carrying this
 * machine carried the table, for a path that is opt-in, defaults to null, and
 * that NOTHING in this repo enables.
 *
 * brickwright-lite could not pay that in an editor bundle, so it removed the
 * whole cycle-timing path and declared the two files `absentByDesign`. A
 * downstream that drops a FEATURE to avoid a byte cost is the strongest signal
 * available that a dependency is in the wrong place — and it made this file
 * unvendorable, which cost a pin bump a whole extra divergence.
 *
 * The estimator is injected now. This test is what stops it coming back: the
 * next person to reach for a module-scope import of a large generated table
 * gets a red naming the file and the reason.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const staticImports = (file) => [...readFileSync(path.join(SRC, file), 'utf8')
    .matchAll(/^\s*import\s[^;]*?from\s*'(\.[^']+)'/gm)].map(m => m[1]);

/** Anything this big is generated, and a generated table does not belong on a hot import. */
const BIG = 100_000;

test('i8086-machine.js statically imports nothing over 100 KB', () => {
    const imports = staticImports('i8086-machine.js');
    assert.ok(imports.length > 3,
        `fixture: only ${imports.length} static imports found — the scan is not reading the file`);

    const heavy = [];
    for (const spec of imports) {
        const resolved = path.join(SRC, spec);
        const bytes = statSync(resolved).size;
        // One hop: a small module re-exporting a huge one is the shape that hid this.
        const via = staticImports(path.basename(spec))
            .map(s => ({s, bytes: statSync(path.join(SRC, s)).size}))
            .filter(x => x.bytes > BIG);
        if (bytes > BIG) heavy.push(`${spec} (${bytes} bytes)`);
        for (const v of via) heavy.push(`${spec} -> ${v.s} (${v.bytes} bytes)`);
    }

    assert.deepEqual(heavy, [],
        'a static import reaches a generated table. Every bundle carrying this machine '
        + 'now carries it, whether or not the feature is used — and a downstream that '
        + 'cannot pay it must drop the whole path, which is what happened with '
        + 'i8088-cycles.js. Inject the consumer instead, as enableI8088CycleTiming does.');
});

test('the estimator refuses BY NAME rather than throwing on new undefined', async () => {
    const {I8086Machine} = await import('../src/i8086-machine.js');
    const m = new I8086Machine();
    assert.throws(() => m.enableI8088CycleTiming(true), /needs its estimator injected/,
        'a caller who forgets must learn what to pass, not get a TypeError from `new undefined`');
    assert.equal(m.enableI8088CycleTiming(false), false,
        'and disabling still needs no estimator at all');
});
