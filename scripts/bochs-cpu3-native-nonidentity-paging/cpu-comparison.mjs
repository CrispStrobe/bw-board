/** Exact CR0 scope derivative, no flags mask or state normalization. */
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {expectedCr0} from './profile.mjs';
export const comparisonParentSha256='5943e3bbb6225e224cbaa4555782fa320f8e4637323c8f16c63d42e851704ff0';
const old=" assert.equal(n.state[10],bochsResetProfile.cr0,'native CR0 scope');assert.equal(j.cr0,bochsResetProfile.cr0,'JS CR0 scope');";
const next=" assert.equal(j.cr0,expectedCr0(j.cs,j.eip),'fixed paging oracle CR0 phase');";
export function derivePagingComparison(bytes){const s=authenticated(bytes,comparisonParentSha256,'held raw counterpart comparison');const d=replacement(s,old,next,'only fixed paging CR0 scope');assert.equal(sha256(replacement(d,next,old,'scope inverse')),comparisonParentSha256);return {bytes:Buffer.from(d),baseSha256:comparisonParentSha256};}
const parent=new URL('../bochs-cpu3-native-cold-bios/parity.mjs',import.meta.url);
const source=("import {expectedCr0} from '"+new URL('./profile.mjs',import.meta.url).href+"';\n"+derivePagingComparison(readFileSync(parent)).bytes.toString()).replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`);
const comparison=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export function comparePagingCpu(native,js){return comparison.compareCpu(native,js);}
