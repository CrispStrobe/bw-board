/**
 * The `--import` half of scripts/cov-i8086-opcodes.mjs. Wraps the 8086 core's
 * two dispatch methods so every opcode that ACTUALLY EXECUTES is recorded, and
 * appends this worker's set to $COV_OUT when the process exits. `node --test`
 * runs one worker per file, so each appends its own set and the runner unions
 * them; nothing here reads or asserts, it only observes.
 *
 * This is ANALYSIS, not shipped behaviour: it patches the prototype in the test
 * process and never touches src/. Loaded with `--import`, it runs before any
 * test file, so the wrap is in place for the first instruction stepped.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { I8086 } = await import(join(here, '..', 'src', 'i8086.js'));

const fired = new Set();
for (const name of ['_exec', '_exec186']) {
    const orig = I8086.prototype[name];
    if (typeof orig !== 'function') continue;
    I8086.prototype[name] = function (op) {
        fired.add(op & 0xff);
        return orig.call(this, op);
    };
}

process.on('exit', () => {
    const out = process.env.COV_OUT;
    if (out && fired.size) {
        appendFileSync(out, [...fired].map((o) => o.toString(16).padStart(2, '0')).join('\n') + '\n');
    }
});
