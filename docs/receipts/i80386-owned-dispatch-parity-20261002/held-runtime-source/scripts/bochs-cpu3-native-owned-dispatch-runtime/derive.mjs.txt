/** Exact inverse CLI derivative. No compilation or addon load. */
import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';import {sha256}from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function runnerSeams(){return [
 ["import {createOwnedIn8Provider}from './bochs-cpu3-native-owned-in8/provider.mjs';","import {createOwnedDispatchProvider as createOwnedIn8Provider}from './bochs-cpu3-native-owned-dispatch/provider.mjs';"],
 ["import {sourceIdentity as identity,authenticateBuild} from './bochs-cpu3-native-owned-in8/identity.mjs';","import {sourceIdentity as identity,authenticateBuild} from './bochs-cpu3-native-owned-dispatch-runtime/identity.mjs';"]];}
export function deriveRunner(source){assert.equal(sha256(source),'68f85005a471c2ccade1d4dcfbbf2794fb0161fc7536e9c4b9bcb1dc05c9578b','exact frozen fe1 runner');let text=source.toString();for(const [before,after]of runnerSeams()){assert.equal(text.split(before).length,2);text=text.replace(before,after);}return text;}
export function inverseRunner(text){for(const [before,after]of runnerSeams().toReversed()){assert.equal(text.split(after).length,2);text=text.replace(after,before);}assert.equal(sha256(text),'68f85005a471c2ccade1d4dcfbbf2794fb0161fc7536e9c4b9bcb1dc05c9578b');return text;}
export function sourceRunner(){return readFileSync(new URL('../run-i80386-native-owned-in8.mjs',import.meta.url));}
