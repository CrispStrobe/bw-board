/** Driver-only paused snapshot adapter; this is a new provider derivative. */
import assert from 'node:assert/strict';
import {deriveRamProvider} from './provider-derivation.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const builtProviderSha256='2bb7d25f9ec676b320f980c3b28f9f8e29375e1a9befadc15a3d930b1ac85089';
const old="  records(){assert.ok(!lease&&!active&&!closed);return board.portEvents.map(e=>({...e}));},";
const added=old+"\n  ramPage(){assert.ok(!lease&&!active&&!closed,'paused copied RAM snapshot');return Uint8Array.from(board.machine.mem.subarray(0x7000,0x8000));},";
export function deriveDriverProvider(bytes=deriveRamProvider().bytes){
 assert.equal(sha256(bytes),builtProviderSha256,'actual built RAM provider');
 const text=replacement(bytes.toString(),old,added,'one paused copied page accessor');
 assert.equal(replacement(text,added,old,'accessor inverse'),bytes.toString(),'byte-exact provider inverse');
 return {bytes:Buffer.from(text),parentSha256:builtProviderSha256};
}
export async function createDriverRamProvider(...args){
 assert.equal(args.length,0,'no caller source or hooks');
 const text=deriveDriverProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);
 const module=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 return module.createOwnedRamBootstrapProvider();
}
