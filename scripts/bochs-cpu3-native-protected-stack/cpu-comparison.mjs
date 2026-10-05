/** Narrow exact comparison-scope derivative, never a state normalization. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const comparisonParentSha256='5943e3bbb6225e224cbaa4555782fa320f8e4637323c8f16c63d42e851704ff0';
const old=" assert.equal(n.state[10],bochsResetProfile.cr0,'native CR0 scope');assert.equal(j.cr0,bochsResetProfile.cr0,'JS CR0 scope');";
const next=" assert.equal(j.cr0,j.cs===0x18||j.cs===0xf000&&j.eip===0x175?0x7ffffff1:0x7ffffff0,'fixed stack oracle CR0 phase');";
export function deriveStackComparison(bytes){const s=authenticated(bytes,comparisonParentSha256,'qualified cold counterpart comparison');const d=replacement(s,old,next,'only fixed CR0 scope');assert.equal(sha256(replacement(d,next,old,'CR0 scope inverse')),comparisonParentSha256);return {bytes:Buffer.from(d),baseSha256:comparisonParentSha256};}
const parent=new URL('../bochs-cpu3-native-cold-bios/parity.mjs',import.meta.url),source=deriveStackComparison(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`);
const comparison=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export function compareStackCpu(native,js){return comparison.compareCpu(native,js);}
