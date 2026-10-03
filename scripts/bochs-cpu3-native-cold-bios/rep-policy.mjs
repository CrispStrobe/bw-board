/** Four pinned free-BIOS REP sites; source policy, not a runnable BIOS profile. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const biosSha256='6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac';
export const repSites=Object.freeze([
 {eip:0xe0c4,bytes:[0xf3,0xab],width:2,count:128,destination:0x400,value:0},
 {eip:0x9daf,bytes:[0xf3,0x66,0xab],width:4,count:120,destination:0,value:0xf000ff53},
 {eip:0x9e3a,bytes:[0xf3,0xab],width:2,count:16,destination:0x180,value:0},
 {eip:0x9e44,bytes:[0xf3,0x66,0xab],width:4,count:136,destination:0x1e0,value:0}
].map(r=>Object.freeze({...r,bytes:Object.freeze(r.bytes)})));
export function authenticateBiosRepPolicy(){
 const b=readFileSync(new URL('../../roms/free-at-bios/BIOS-bochs-legacy',import.meta.url));assert.equal(b.length,65536);assert.equal(createHash('sha256').update(b).digest('hex'),biosSha256);
 for(const r of repSites)assert.deepEqual(Array.from(b.subarray(r.eip,r.eip+r.bytes.length)),r.bytes);return biosSha256;
}
/** Pure source-control model of the native pre-element admission predicate. */
export function admitRepElement(s){
 if(!s||s.cs!==0xf000||s.csBase!==0xf0000||s.cs32!==false||s.es!==0||s.esBase!==0||s.es32!==false||s.pe!==false||s.df!==false)return false;
 const r=repSites.find(r=>r.eip===s.eip);if(!r||!Number.isInteger(s.cx)||s.cx<1||s.cx>r.count||!Number.isInteger(s.di)||s.di!==r.destination+(r.count-s.cx)*r.width||!Number.isInteger(s.eax)||s.eax<0||s.eax>0xffffffff)return false;
 if((r.width===2?s.eax&65535:s.eax)!==r.value)return false;
 return Array.isArray(s.bytes)&&s.bytes.length===r.bytes.length&&r.bytes.every((v,i)=>s.bytes[i]===v);
}
