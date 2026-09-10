/**
 * Find a checkout that lives BESIDE this repo, from wherever this repo is.
 *
 * Several suites here are driven by an oracle that is not a fixture in this
 * repo — a third-party firmware build, a corpus, a simulator. They look it up
 * rather than assume it, which is right, and they look for it as a SIBLING of
 * the repo, which is right from a clone and wrong from every git WORKTREE:
 * a worktree lives one level deeper (`code/wt/<lane>/` beside `code/<repo>/`),
 * so `<repo>/../..` lands in `code/wt` and the oracle is never found.
 *
 * MEASURED, because the consequence is not a missing test but a SPLIT one:
 * `blinkenrocket-modem-e2e` runs from the canonical clone at
 * `/mnt/volume1/code/bw-board` and skips in every one of the 66 worktrees on
 * this box. CI checks the repo out directly, so the suite is green there and
 * absent everywhere the work is actually done — and its absence shows up as a
 * `# skipped`, which reads as a deliberate exclusion rather than as a lookup
 * that cannot reach.
 *
 * So the search walks UP instead of assuming a depth. It stops at the
 * filesystem root and it never guesses: a caller gets candidate PATHS and
 * decides for itself what counts as a hit, because "the file exists" and "the
 * file is the reference build" are different questions and only the caller
 * knows which one it is asking.
 *
 * @param {string} fromDir directory to start from (a test's own dirname)
 * @param {string[]} relative path segments below each ancestor, e.g.
 *   ['blinkenrocket-firmware', 'build', 'main.hex']
 * @param {number} [levels] how far up to look; 6 covers repo → code → home
 * @returns {string[]} candidates, nearest ancestor first
 */
import path from 'node:path';
import { existsSync } from 'node:fs';

export function ancestorCandidates(fromDir, relative, levels = 6) {
  const out = [];
  let dir = path.resolve(fromDir);
  for (let i = 0; i <= levels; i++) {
    out.push(path.join(dir, ...relative));
    const up = path.dirname(dir);
    if (up === dir) break;                 // filesystem root: stop, do not loop
    dir = up;
  }
  return out;
}

/**
 * The first of those candidates that exists — or, if none does, the one the
 * old fixed-depth code would have named.
 *
 * Most callers here do not want a list: they hold ONE path and check it with
 * `existsSync` to decide whether to skip. Handing them the sibling-level
 * candidate when nothing is found keeps that absent case EXACTLY as it was,
 * message included, and changes only what happens when the thing is actually
 * present somewhere up the tree. A conversion that altered the failure text as
 * well as the search would make it impossible to tell which change did what.
 *
 * @param {string} fromDir directory to start from (a test's own dirname)
 * @param {string[]} relative path segments below each ancestor
 * @param {number} [levels]
 * @returns {string} an existing path, else the beside-the-repo candidate
 */
export function resolveAncestor(fromDir, relative, levels = 6) {
  const candidates = ancestorCandidates(fromDir, relative, levels);
  // Index 2 from a test/ directory is test -> repo -> BESIDE THE REPO, which is
  // what the fixed-depth form meant.
  return candidates.find(existsSync) ?? candidates[Math.min(2, candidates.length - 1)];
}

/**
 * The same source with comments removed, string and template literals intact.
 *
 * A scan for a CODE shape cannot tell code from prose about code. The first
 * version of the fixed-depth ratchet reddened on eight files it had just
 * cleaned, because the comment explaining each conversion QUOTED the shape it
 * was explaining. That is the same species as a divergence ledger answering a
 * search about a file with prose rather than a declaration: the document
 * discussing the thing matches every pattern the thing does.
 *
 * So the ratchet reads this instead. Quotes are tracked because a line-comment
 * marker inside a string is not a comment, and one inside a template literal
 * would otherwise eat the rest of the file.
 */
export function stripComments(source) {
  let out = '';
  let quote = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}
