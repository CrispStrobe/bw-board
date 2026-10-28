#!/usr/bin/env node
/**
 * Controller: assemble the frozen guest, derive the independent expectation,
 * execute the ordinary JS core and (with --bochs-root) pinned Bochs CPU level 3,
 * then write originals and a comparison summary to --out. Never rewrites inputs.
 */
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {buildGuest, toolVersions, sha256} from './build.mjs';
import {expectedStream, firstDifference, allDifferences, layout} from './expected.mjs';
import {runJs, runBochs, bochsProfile} from './engines.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const out = opt('--out');
if (!out) throw new Error('usage: run.mjs --out DIR [--bochs-root DIR]');
if (existsSync(out)) throw new Error('output directory must not exist');
mkdirSync(out, {recursive: true});

const guest = buildGuest();
const expected = expectedStream(guest);
if (expected.length !== layout().length) throw new Error('expectation/layout length mismatch');
const write = (name, data) => { writeFileSync(join(out, name), data); return sha256(data); };
const files = {
  'guest.bin': write('guest.bin', guest.image),
  'expected.bin': write('expected.bin', expected),
};
const engines = {};
const js = await runJs(guest.image);
files['js.bin'] = write('js.bin', js.stream);
engines.js = {...js, stream: undefined, streamLength: js.stream.length,
  firstDifference: firstDifference(expected, js.stream), differences: allDifferences(expected, js.stream).length};
const bochsRoot = opt('--bochs-root');
if (bochsRoot) {
  const bochs = await runBochs(guest.image, bochsProfile(bochsRoot));
  files['bochs.bin'] = write('bochs.bin', bochs.stream);
  engines.bochs = {...bochs, stream: undefined, streamLength: bochs.stream.length,
    firstDifference: firstDifference(expected, bochs.stream), differences: allDifferences(expected, bochs.stream).length,
    jsVsBochs: firstDifference(bochs.stream, js.stream)};
}
const summary = {schema: 'bw.i80386-vm86-common-context.v1', guest: {sourceSha256: guest.sourceSha256,
  imageSha256: guest.imageSha256, symbols: guest.symbols}, tools: toolVersions(), node: process.version,
  expectedLength: expected.length, files, engines,
  pass: Object.values(engines).every(e => e.differences === 0) && !!engines.bochs};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(JSON.stringify({pass: summary.pass,
  js: engines.js.firstDifference, bochs: engines.bochs?.firstDifference ?? 'not-run'}) + '\n');
