/** Separate compact REP/PF/PIT transform over byte-pinned cold RAM derivation. */
import {readFileSync} from 'node:fs';
import {patchPinnedSource as ram,revision,sha256,upstreamHashes} from '../bochs-cpu3-native-ram-coherence/patch.mjs';
if(sha256(readFileSync(new URL('../bochs-cpu3-native-ram-coherence/patch.mjs',import.meta.url)))!=='88305e91af67102eb633fa7946a0d9941acd7b14bd69df57ddfb98815616e45f')throw Error('frozen REP derivation changed');
export {revision,sha256,upstreamHashes};
export function patchPinnedSource(path,bytes){return ram(path,bytes);}
