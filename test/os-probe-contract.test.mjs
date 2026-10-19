import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ELKS,MINIX,verifyMedia,probeOS} from '../scripts/probe-16bit-os.mjs';
test('OS probes pin media and refuse corrupt content, invalid budgets and invented 286 backend',()=>{
    for(const guest of [ELKS,MINIX]) {
        assert.match(guest.sha256,/^[a-f0-9]{64}$/);
        assert.throws(()=>verifyMedia(new Uint8Array(guest.bytes),guest),/hash mismatch/);
        assert.throws(()=>probeOS(new Uint8Array(),guest,{variant:'80286'}),/not boot-ready/);
        assert.throws(()=>probeOS(new Uint8Array(),guest,{maxSteps:Infinity}),/invalid maxSteps/);
    }
});
