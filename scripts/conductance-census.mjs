#!/usr/bin/env node
// Census of conductance stamps whose second leg is STATICALLY absent.
//
// `ctx.conductance(tA, tB, g)` funnels into `stampTwoTerminal`, whose first
// line is `if (!netA || !netB) return;` — the air-leg guard
// (src/mna.js, "a resistor with one leg unconnected was stamped as a resistor
// TO GROUND"). So a call written `ctx.conductance(t, null, g)` can never
// stamp anything: `tB` is falsy, `netB` is `undefined`, and the guard returns
// before a single matrix entry is touched. Same for a literal `undefined`
// third argument to `stampTwoTerminal` itself.
//
// Those calls are not wrong by construction — an ideal high-Z op-amp input IS
// the better model at the teaching tier — but a declaration that does nothing
// is either a lie in the code or a missing piece of physics, and neither can
// be adjudicated until the class is counted exactly. This script counts it.
//
// Usage:
//   node scripts/conductance-census.mjs            # human table
//   node scripts/conductance-census.mjs --json     # machine-readable
//   node scripts/conductance-census.mjs --count    # just the total
//
// The parse is a balanced-paren scan over source with comments and string
// literals blanked out (offsets preserved), so nested calls, multi-line
// argument lists and commas inside the arguments are all handled without a
// parser dependency — this repo has none, and the census must not add one.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** Recursively list every .js file under a directory. */
function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/**
 * Replace every comment and string/template/regex literal with spaces,
 * keeping byte offsets identical so line numbers and slices stay valid.
 * Only the structural characters — parens, commas — need to survive.
 */
function blankLiterals(src) {
  const out = Array.from(src);
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  // Tracks whether a `/` starts a regex or is division. Good enough for this
  // codebase: a regex only follows one of these.
  let prevSignificant = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = src.length;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? src.length : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      blank(i, j);
      i = j;
      prevSignificant = 'x';
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%<>~^]|^$/.test(prevSignificant)) {
      // Regex literal.
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { j++; break; }
        else if (src[j] === '\n') break;
        j++;
      }
      blank(i, j);
      i = j;
      prevSignificant = 'x';
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

/** Split an argument list at top-level commas (parens/brackets/braces aware). */
function splitArgs(text) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  args.push([start, text.length]);
  return args;
}

/**
 * Find every call to `name` and return its argument spans.
 * @returns {{index:number, argSpans:[number,number][]}[]}
 */
function findCalls(blanked, name) {
  const found = [];
  // `ctx.conductance(...)` must match, so a leading `.` is allowed; a longer
  // identifier ending in the name (`fooConductance(`) must not.
  const re = new RegExp(`(?<![\\w$])${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(blanked))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < blanked.length; i++) {
      const c = blanked[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const inner = blanked.slice(open + 1, close);
    const spans = splitArgs(inner).map(([a, b]) => [open + 1 + a, open + 1 + b]);
    found.push({ index: m.index, argSpans: spans });
  }
  return found;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** Nearest enclosing `registerDevice('id'` above an offset, if any. */
function deviceAbove(src, idx) {
  const head = src.slice(0, idx);
  const matches = [...head.matchAll(/registerDevice\(\s*['"`]([^'"`]+)['"`]/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** Comment lines immediately above the statement, as authored intent. */
function commentAbove(src, idx) {
  const lines = src.slice(0, idx).split('\n');
  const out = [];
  for (let i = lines.length - 2; i >= 0 && out.length < 4; i--) {
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
      out.unshift(t.replace(/^\/\/\s?|^\*\s?|^\/\*+\s?/, ''));
    } else if (t === '') {
      if (out.length) break;
    } else break;
  }
  return out.join(' ').trim();
}

const NOOP_LITERAL = /^(null|undefined)$/;

const files = listJs(SRC);
const sites = [];
const live = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const blanked = blankLiterals(src);
  const rel = relative(ROOT, file);

  // ctx.conductance(tA, tB, g): the second argument is the far leg.
  // stampTwoTerminal(A, netA, netB, g, nodeIndex): the third argument is.
  for (const [name, legArg, terminalArg] of [
    ['conductance', 1, 0],
    ['stampTwoTerminal', 2, 1],
  ]) {
    for (const call of findCalls(blanked, name)) {
      const spans = call.argSpans;
      if (spans.length <= legArg) continue;
      const leg = src.slice(...spans[legArg]).trim();
      const rec = {
        file: rel,
        line: lineOf(src, call.index),
        callee: name,
        device: deviceAbove(src, call.index),
        terminal: src.slice(...spans[terminalArg]).trim(),
        leg,
        g: spans.length > legArg + 1 ? src.slice(...spans[legArg + 1]).trim() : '',
        comment: commentAbove(src, call.index),
      };
      if (NOOP_LITERAL.test(leg)) sites.push(rec);
      else live.push(rec);
    }
  }
}

sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (process.argv.includes('--count')) {
  console.log(sites.length);
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    noop: sites,
    noopCount: sites.length,
    noopFiles: [...new Set(sites.map((s) => s.file))].length,
    liveCount: live.length,
  }, null, 2));
} else {
  const byFile = new Map();
  for (const s of sites) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  console.log('conductance stamps whose far leg is statically absent (always a no-op)');
  console.log('='.repeat(78));
  for (const [file, rows] of byFile) {
    console.log(`\n${file}  (${rows.length})`);
    for (const r of rows) {
      const dev = r.device ? `${r.device}` : '(builtin)';
      console.log(`  ${String(r.line).padStart(5)}  ${dev.padEnd(22)} ${r.terminal} , ${r.leg} , ${r.g}`);
    }
  }
  console.log(`\n${'='.repeat(78)}`);
  console.log(`no-op sites: ${sites.length} across ${byFile.size} files`);
  console.log(`live (two real legs) sites: ${live.length}`);
}
