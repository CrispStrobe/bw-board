import assert from 'node:assert/strict';
import {deriveNativeChild,runVariant,heldSha256} from './native-child.mjs';

const derived=deriveNativeChild();
assert.equal(derived.heldSha256,heldSha256);
assert.match(derived.normalizedSha256,/^[0-9a-f]{64}$/);
assert.match(derived.loadedSha256,/^[0-9a-f]{64}$/);
assert.notEqual(derived.normalizedSha256,heldSha256);
await assert.rejects(runVariant({}),error=>error.code==='ERR_ASSERTION');
await assert.rejects(runVariant({schema:'bw.cold-direct-ram.paired-native-input.v1',mode:'direct',providerVariant:'wrong'}),
 error=>error.code==='ERR_ASSERTION');
console.log('native child derivative controls PASS: source inverse, wrong schema/variant before addon');
