/** Source-only candidate identity; does not load an addon or execute a guest. */
import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';import {execFileSync}from 'node:child_process';import {fileURLToPath}from 'node:url';
import {sourceIdentity as originalIdentity}from '../bochs-cpu3-native-owned-in8/identity.mjs';
import {sha256}from '../bochs-cpu3-native-owned-clock/derive.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const candidateAssets=['scripts/bochs-cpu3-native-owned-pic-imr/provider.mjs', 'scripts/bochs-cpu3-native-owned-pic-imr/runtime.mjs', 'scripts/bochs-cpu3-native-owned-pic-imr/identity.mjs', 'scripts/bochs-cpu3-native-owned-pic-imr/contract.md', 'scripts/i80386-free-owned-pic-imr.mjs', 'scripts/run-i80386-free-owned-pic-imr.mjs', 'test/i80386-native-owned-pic-imr.test.mjs', 'test/fixtures/i80386-free-owned-pic-imr.S'];
export function sourceIdentity(){const source=originalIdentity();assert.equal(Object.keys(source.hashes).length,103);for(const p of candidateAssets){const bytes=readFileSync(root+p);assert.equal(sha256(bytes),sha256(execFileSync('git',['show',source.revision+':'+p],{cwd:root,maxBuffer:32<<20})));source.hashes[p]=sha256(bytes);}assert.equal(Object.keys(source.hashes).length,111);return source;}
