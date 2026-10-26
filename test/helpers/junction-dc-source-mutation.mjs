/** Buildable actual-source guard mutants in an owned temporary module mirror. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const edges = Object.freeze({
  diode: "      join(netFor(part, 'anode'), netFor(part, 'cathode'));",
  'base-emitter': "      join(netFor(part, 'base'), netFor(part, 'emitter'));",
  'base-collector': "      join(netFor(part, 'base'), netFor(part, 'collector'));",
});

export async function withJunctionEdgeOmitted(edge, testBody) {
  assert.ok(Object.hasOwn(edges, edge), 'only the declared junction-edge mutants are allowed');
  const sourceRoot = join(root, 'src');
  const source = await readFile(join(sourceRoot, 'board.js'), 'utf8');
  const needle = edges[edge];
  assert.equal(source.split(needle).length - 1, 1, 'one exact production edge anchor');
  const mutant = source.replace(needle, `      // Evidence mutant: ${edge} edge omitted.`);
  const scratch = await mkdtemp(join(tmpdir(), 'bw-junction-edge-'));
  try {
    await writeFile(join(scratch, 'package.json'), await readFile(join(root, 'package.json')));
    const target = join(scratch, 'src');
    await mkdir(target);
    for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
      if (entry.name === 'board.js') await writeFile(join(target, entry.name), mutant);
      else await symlink(join(sourceRoot, entry.name), join(target, entry.name), entry.isDirectory() ? 'junction' : 'file');
    }
    if (existsSync(join(root, 'node_modules'))) await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'junction');
    // Import/build must succeed OUTSIDE the callback's expected-refusal assertion.
    const actual = await import(pathToFileURL(join(target, 'board.js')).href);
    assert.equal(typeof actual.BoardImpl, 'function');
    await testBody(actual.BoardImpl);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
