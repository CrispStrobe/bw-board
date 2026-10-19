/** Source-only provider derivation/inverse proof; does not admit a native image. */
import {readFileSync} from 'node:fs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function verifyInterfaceProvider(){
 const d=JSON.parse(readFileSync(new URL('./derivation.json',import.meta.url))),base=readFileSync(new URL('../bochs-cpu3-native-owned-8042/provider.mjs',import.meta.url));authenticated(base,d.baseSha256,'held self-test provider');let s=base.toString();
 for(const e of d.edits)s=replacement(s,e.old,e.next,e.label);
 authenticated(readFileSync(new URL('./provider.mjs',import.meta.url)),d.derivedSha256,'actual interface provider');if(sha256(s)!==d.derivedSha256)throw Error('interface provider derivation');
 for(const e of [...d.edits].reverse())s=replacement(s,e.next,e.old,'inverse '+e.label);
 if(sha256(s)!==d.baseSha256)throw Error('interface provider inverse');return d;
}
