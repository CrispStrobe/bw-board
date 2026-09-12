/**
 * bw-board is consumed as a package (a git-sha npm dependency of
 * brickwright-lite and bw-circuit-ui), not by copying files. Four properties
 * make that work and each of them has been silently broken at least once
 * while the copy regime hid it:
 *
 *   1. Every bare specifier imported by src/ is a declared dependency, and
 *      every declared dependency is imported — the index.js header once said
 *      "No runtime dependencies" while src imported avr8js and rp2040js, and
 *      the consumer re-declared both by hand.
 *   2. No import in src/ reaches through a `node_modules/` path. Such a path
 *      resolves only inside THIS checkout's layout; a consumer that installs
 *      bw-board hoists the dependency and the import reaches nothing
 *      (cortex-m0-machine.js, until 2026-09-12).
 *   3. Every file under src/ is reachable through the package's own
 *      `exports` map by the subpath a consumer would write
 *      (`bw-board/<file>`), so deep imports need no per-consumer rewrite.
 *   4. The browser entry graph (static imports from src/index.js) never
 *      reaches a `node:` builtin. pin-functions.js is node-only and must
 *      stay outside that graph.
 *
 * Each check is driven at its counter-example below (a planted violation
 * fails the assertion) so a rewrite that keeps the name and drops the
 * assertion is caught.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Every .js file under src/, repo-relative with forward slashes. */
function srcFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

/**
 * Specifiers imported by a module's SOURCE — static `import … from`,
 * `export … from`, and `import('…')` — read from code lines only. A
 * specifier inside a comment is not an import (i8086.js says `'irq'` in
 * prose), so comment lines and block-comment bodies are stripped first.
 */
export function importSpecifiers(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const out = new Set();
  const re = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.add(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** `avr8js/foo` -> `avr8js`, `@scope/x/y` -> `@scope/x`; relative and node: -> null. */
export function packageName(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const files = srcFiles();
const specsByFile = new Map(files.map((f) => [f, importSpecifiers(readFileSync(path.join(ROOT, f), 'utf8'))]));

test('the src tree is non-trivial and the scanner sees imports (anti-vacuity)', () => {
  assert.ok(files.length > 100, `only ${files.length} src files found`);
  const total = [...specsByFile.values()].reduce((n, s) => n + s.size, 0);
  assert.ok(total > 200, `only ${total} import specifiers found across src/`);
  // The scanner must find a known static import and a known dynamic one.
  assert.ok(specsByFile.get('src/board.js').has('./mna.js'), 'board.js -> ./mna.js not seen');
  assert.ok(specsByFile.get('src/debug-target-factory.js').has('./rp2040js-adapter.js'),
    'dynamic import in debug-target-factory.js not seen');
  // …and must NOT count a specifier that only appears in prose.
  assert.ok(!specsByFile.get('src/i8086.js').has('irq'), "'irq' in a comment was counted as an import");
});

test('1. declared dependencies == bare specifiers imported by src/ (both directions)', () => {
  const used = new Set();
  for (const specs of specsByFile.values()) {
    for (const s of specs) {
      const name = packageName(s);
      if (name && name !== pkg.name) used.add(name);
    }
  }
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  assert.deepEqual([...used].sort(), [...declared].sort(),
    `src imports ${JSON.stringify([...used].sort())} but package.json declares ${JSON.stringify([...declared].sort())}`);
  // Counter-example: a specifier from a dependency this package never imports.
  assert.ok(!used.has('left-pad'));
});

test('2. no import in src/ reaches through a node_modules/ path', () => {
  const offenders = [];
  for (const [f, specs] of specsByFile) {
    for (const s of specs) if (/(^|\/)node_modules\//.test(s)) offenders.push(`${f}: ${s}`);
  }
  assert.deepEqual(offenders, [],
    'a node_modules/ path resolves only in this checkout; import the package root or a subpath its exports map allows');
  // The predicate fires at the shape it guards against.
  assert.ok(/(^|\/)node_modules\//.test('../node_modules/rp2040js/dist/esm/cortex-m0-core.js'));
});

test('3. every src file resolves through the exports map as bw-board/<subpath>', () => {
  const misses = [];
  for (const f of files) {
    const sub = f.replace(/^src\//, '');
    let resolved;
    try {
      resolved = import.meta.resolve(`${pkg.name}/${sub}`);
    } catch (e) {
      misses.push(`${sub}: ${e.code ?? e.message}`);
      continue;
    }
    const expected = pathToFileURL(path.join(ROOT, f)).href;
    if (resolved !== expected) misses.push(`${sub} -> ${resolved}, expected ${expected}`);
  }
  assert.deepEqual(misses, []);
  // Named subpaths a consumer writes without the .js suffix.
  for (const sub of ['register-all', 'pin-functions', 'conformance', 'devices']) {
    assert.equal(import.meta.resolve(`${pkg.name}/${sub}`),
      pathToFileURL(path.join(SRC, `${sub}.js`)).href, sub);
  }
  // Oracle helpers a consumer's tests share (bw-circuit-ui's cube golden).
  assert.equal(import.meta.resolve(`${pkg.name}/test/golden/cube-oracle.js`),
    pathToFileURL(path.join(ROOT, 'test/golden/cube-oracle.js')).href);
  // Counter-example: something outside src is not reachable by the wildcard.
  assert.throws(() => import.meta.resolve(`${pkg.name}/../package.json`));
  assert.equal(import.meta.resolve(`${pkg.name}/package.json`), pathToFileURL(path.join(ROOT, 'package.json')).href);
});

test('4. the browser entry graph reaches no node: builtin and not pin-functions.js', () => {
  // Static graph only: dynamic imports are lazy and may be node-side tooling.
  const staticRe = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const seen = new Set();
  const queue = ['src/index.js'];
  const nodeImports = [];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    let m;
    while ((m = staticRe.exec(text))) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('node:')) nodeImports.push(`${f}: ${spec}`);
      if (spec.startsWith('.')) {
        const next = path.relative(ROOT, path.resolve(ROOT, path.dirname(f), spec)).replace(/\\/g, '/');
        if (statSync(path.join(ROOT, next), { throwIfNoEntry: false })) queue.push(next);
      }
    }
  }
  assert.ok(seen.size > 50, `entry graph is only ${seen.size} files`);
  assert.deepEqual(nodeImports, [], 'a node: import in the browser entry graph fails the whole app build');
  assert.ok(!seen.has('src/pin-functions.js'), 'pin-functions.js is node-only and must not be reachable from index.js');
  // The node-only module really does import node: — otherwise this check has no subject.
  assert.ok([...specsByFile.get('src/pin-functions.js')].some((s) => s.startsWith('node:')));
});
