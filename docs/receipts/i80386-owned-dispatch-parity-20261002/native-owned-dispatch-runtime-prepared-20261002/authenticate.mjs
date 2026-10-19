/** Root-authorized read/hash only; no addon require or guest. */
import {readFileSync}from 'node:fs';
import {sourceIdentity,authenticateBuild}from '/tmp/bw-board-386-owned-dispatch-runtime-20261002/scripts/bochs-cpu3-native-owned-dispatch-runtime/identity.mjs';
const input=JSON.parse(readFileSync('/mnt/volume1/tmp-astra/native-owned-in8-r3-ci-restored-20261002/static-input.json')).input;
const source=sourceIdentity();const provenance=authenticateBuild(input,source);
console.log(JSON.stringify({status:'ACTUAL_READONLY_SOURCE_AND_COMPILED_ADMISSION_PASS_NO_ADDON_LOAD',source,provenance,input}));
