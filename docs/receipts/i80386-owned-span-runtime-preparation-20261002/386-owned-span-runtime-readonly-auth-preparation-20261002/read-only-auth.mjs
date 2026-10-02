/** Read-only runtime/compiled provenance authentication; never loads an addon or constructs a provider. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceIdentity,authenticateBuild,validateInput} from '/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-runtime-source-20261002/scripts/bochs-cpu3-native-owned-span-runtime/admission.mjs';
assert.equal(process.argv.length,2);
const bytes=readFileSync('/mnt/volume1/tmp-astra/native-owned-dispatch-parity-prepared-20261002/smoke-off/input.json');
const input=validateInput(JSON.parse(bytes));
const source=sourceIdentity(),provenance=authenticateBuild(input,source);
console.log(JSON.stringify({status:'READ_ONLY_RUNTIME116_COMPILED103_AUTHENTICATION_PASS_NO_ADDON_LOAD',inputSha256:createHash('sha256').update(bytes).digest('hex'),source,provenance,scope:'Read/hash/Git and exact source derivation only; original compiled fe1/103 and DSO8d9c retained. No provider factory, assembly, addon load, native build, guest, profile or performance workload.'},null,2));
