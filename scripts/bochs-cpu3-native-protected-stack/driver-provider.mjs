/** Driver-only paused snapshot adapter; this is a new provider derivative. */
import assert from 'node:assert/strict';
import {deriveProtectedStackProvider} from './provider-derivation.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const profileProviderSha256='eb8a07e5712b876d1ea3d232223a84d4d18a4b02f4087e509ebe63da4c8a5b38';
const old="  records(){assert.ok(!lease&&!active&&!closed);return board.portEvents.map(e=>({...e}));},";
const added=old+"\n  ramPages(){assert.ok(!lease&&!active&&!closed,'paused copied GDT/code/stack snapshots');return {code:Uint8Array.from(board.machine.mem.subarray(0x7000,0x8000)),gdt:Uint8Array.from(board.machine.mem.subarray(0,4096)),stack:Uint8Array.from(board.machine.mem.subarray(0x8000,0x9000))};},";
export function deriveDriverProvider(bytes=deriveProtectedStackProvider().bytes){
 assert.equal(sha256(bytes),profileProviderSha256,'fixed stack provider source; build pending');
 const text=replacement(bytes.toString(),old,added,'one paused copied GDT/code/stack page accessor');
 assert.equal(replacement(text,added,old,'accessor inverse'),bytes.toString(),'byte-exact provider inverse');
 return {bytes:Buffer.from(text),parentSha256:profileProviderSha256};
}
export async function createDriverStackProvider(...args){
 assert.equal(args.length,0,'no caller source or hooks');
 const text=deriveDriverProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);
 const module=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 return module.createOwnedProtectedStackProvider();
}
