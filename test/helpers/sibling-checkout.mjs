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
