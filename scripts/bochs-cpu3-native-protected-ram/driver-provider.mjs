/** Driver-only paused snapshot adapter; this is a new provider derivative. */
import assert from 'node:assert/strict';
import {deriveProtectedRamProvider} from './provider-derivation.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const profileProviderSha256='ba1c3c76e5a74dd65c9129527f23d7f744ff3f7955f624fff08034242218071e';
const old="  records(){assert.ok(!lease&&!active&&!closed);return board.portEvents.map(e=>({...e}));},";
const added=old+"\n  ramPages(){assert.ok(!lease&&!active&&!closed,'paused copied GDT/code snapshots');return {code:Uint8Array.from(board.machine.mem.subarray(0x7000,0x8000)),gdt:Uint8Array.from(board.machine.mem.subarray(0,4096))};},";
export function deriveDriverProvider(bytes=deriveProtectedRamProvider().bytes){
 assert.equal(sha256(bytes),profileProviderSha256,'fixed protected provider source; build pending');
 const text=replacement(bytes.toString(),old,added,'one paused copied GDT/code page accessor');
 assert.equal(replacement(text,added,old,'accessor inverse'),bytes.toString(),'byte-exact provider inverse');
 return {bytes:Buffer.from(text),parentSha256:profileProviderSha256};
}
export async function createDriverProtectedProvider(...args){
 assert.equal(args.length,0,'no caller source or hooks');
 const text=deriveDriverProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);
 const module=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 return module.createOwnedProtectedRamProvider();
}
