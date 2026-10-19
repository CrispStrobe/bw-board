/**
 * WHAT A WALL-CLOCK FAILURE MOST LIKELY MEANS — in the failure itself.
 *
 * A reader meets a perf test through its FAILURE, in a CI log or a terminal.
 * A note in the file's header is read only by someone who has already decided
 * to open the file, which is to say: after the hunt, rather than instead of
 * it. lego-a4 lost most of an hour to four digital-parity failures that were
 * a loaded box, and was stopped by the one test that put its own diagnosis in
 * the assertion.
 *
 * Measured 2026-09-05: the full bw-board suite at load 20 failed
 * `perf budget: MNA path`; the same file run alone at load 11 passed. Nothing
 * about the engine changed between those two runs.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED. Three files carry it. Three copies
 * of a diagnostic drift, and the drift is invisible because nobody reads a
 * passing test's failure text. One definition, imported.
 *
 * WHICH TESTS SHOULD USE IT: only those whose assertion is fed by a value
 * derived from `performance.now()` or `Date.now()`. Derived MECHANICALLY on
 * 2026-09-05 rather than by eye -- find variables assigned from a wall-clock
 * read, then find assertions naming those variables -- because a first pass
 * by keyword flagged 13 files and all but five were using `elapsed` for
 * EMULATED time: T-states in contention-vectors, simulated milliseconds in
 * device-555. Those are deterministic and adding this to them would be noise,
 * which is how a real warning gets skimmed past.
 *
 * @param {string} what  the quantity being measured, named for the reader
 * @returns {string} a suffix for an assertion message
 */
export const perfHint = (what) =>
    `\n\n  BEFORE CHASING A REGRESSION, CHECK THE MACHINE. ${what} is wall-clock, and` +
    '\n  a loaded box produces exactly this failure with the engine untouched.' +
    '\n  Discriminator: run THIS FILE ALONE. A real regression is slow solo too;' +
    '\n  a noisy neighbour is not. `uptime` and `free -m` settle it in one line.' +
    '\n  Measured 2026-09-05: full suite at load 20 red, same test solo at load 11 green.';
