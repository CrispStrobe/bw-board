/**
 * The 8051 checkpoint capability refusal has an EXACT shape, and consumers
 * compare it exactly (brickwright-lite's test/emu8051-checkpoint-refusal
 * contract does `deepEqual` against `{supported, code, missing}`).
 *
 * Found 2026-09-12 when lite's pin advanced to 208710e: the capability block
 * spread `reason: checkpointSupport().reason` unconditionally, so a build
 * without the checkpoint ABI reported `reason: undefined` — a key that names
 * nothing, and enough to fail a strict comparison downstream. The rule the
 * rest of this module already follows (`unavailableCheckpointRefusal`): a
 * reason is named or absent.
 *
 * Two drives, both against the real emu8051 build:
 *   1. the native ABI hidden -> refusal carries code + missing, no undefined key,
 *      and `deepEqual`s the documented shape;
 *   2. (only where the build has the ABI) an adapter that refuses WITH a reason
 *      -> the reason is present, so this is not "never a reason".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051DebugTarget } from '../src/emu8051-debug.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
    process.env.EMU8051_JS,
    resolveAncestor(here, ['emu8051-stc', 'build', 'emu8051.js']),
].filter(Boolean);
let createEmu8051 = null;
for (const p of CANDIDATES) {
    if (existsSync(p)) { createEmu8051 = require(p); break; }
}
const SKIP = createEmu8051 ? false
    : 'no emu8051 build reachable — check out CrispStrobe/emu8051-stc beside this repo and build it, or set $EMU8051_JS';

async function wasmReady() {
    const wasm = await createEmu8051();
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm._emu_set_vcc(5.0);
    return wasm;
}

/** The same module with one export hidden — the shape a pre-checkpoint build has. */
function withoutCheckpointAbi(wasm) {
    return new Proxy(wasm, {
        get(target, prop, receiver) {
            if (prop === '_emu_checkpoint_size') return undefined;
            return Reflect.get(target, prop, receiver);
        },
        has(target, prop) { return prop !== '_emu_checkpoint_size' && prop in target; }
    });
}

/**
 * Every path to an undefined VALUE anywhere in the object. Recursive on purpose:
 * `{reason: undefined}` and `{}` are equal under deepEqual and identical under
 * JSON.stringify, which is why bw-board's own tests could not see this and a
 * consumer enumerating keys could. Only key enumeration tells them apart.
 */
// The walker itself, at a planted case.
const undefinedKeys = (o, prefix = '') => Object.entries(o ?? {}).flatMap(([k, v]) =>
    v === undefined ? [prefix + k]
        : (v && typeof v === 'object' && !Array.isArray(v)) ? undefinedKeys(v, `${prefix}${k}.`) : []);

assert.deepEqual(undefinedKeys({a: 1, b: {c: undefined, d: [undefined]}, e: undefined}), ['b.c', 'e']);

describe('8051 checkpoint capability refusal: a reason is named or absent', () => {
    it('without the native ABI the refusal is exactly {supported, code, missing}', {skip: SKIP}, async () => {
        const t = createEmu8051DebugTarget(withoutCheckpointAbi(await wasmReady()));
        const caps = t.capabilities();
        assert.deepEqual(undefinedKeys(caps), [], `undefined-valued key(s) somewhere in capabilities(): ${JSON.stringify(caps)}`);
        const cp = caps.extensions.checkpoint;
        assert.deepEqual(cp, {
            supported: false,
            code: 'incomplete-snapshot-abi',
            missing: ['cpu-in-flight-microstate', 'program-time', 'timer-and-interrupt-internals',
                'uart-queues', 'external-input-latches']
        });
        // The operation refusal (the other builder) agrees on the rule.
        const r = t.captureCheckpoint();
        assert.deepEqual(undefinedKeys(r), []);
        assert.equal(r.code, 'incomplete-snapshot-abi');
        assert.equal('reason' in r, false, 'no adapter, no native error: nothing to name');
    });

    it('with the ABI present and an adapter that refuses WITH a reason, the reason is named', {skip: SKIP}, async (ctx) => {
        const wasm = await wasmReady();
        if (typeof wasm._emu_checkpoint_size !== 'function') {
            // A skip, not a pass: this build cannot reach the adapter branch at all.
            return ctx.skip('the emu8051 build has no checkpoint ABI, the adapter branch is unreachable here');
        }
        const adapter = {
            checkpointSupport: () => ({supported: false, code: 'adapter-not-ready', reason: 'the test adapter is not ready'}),
            captureCheckpointState: () => ({}),
            prepareCheckpointRestore: () => ({}),
        };
        const t = createEmu8051DebugTarget(wasm, {adapter});
        const caps = t.capabilities();
        assert.deepEqual(undefinedKeys(caps), []);
        const cp = caps.extensions.checkpoint;
        assert.equal(cp.supported, false);
        assert.equal(cp.code, 'adapter-not-ready');
        assert.equal(cp.reason, 'the test adapter is not ready');
    });
});
