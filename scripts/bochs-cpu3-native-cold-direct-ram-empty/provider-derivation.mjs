import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const parentUrl=new URL('../bochs-cpu3-native-cold-direct-ram/provider.mjs',import.meta.url);
export const heldProviderSha256='e529866863d1d7644ee866565b32ceef39cf882ba67bc6f56f9e62ed8ccc6dc6';
const oldLine='  const stagedGenerations=new Map(board.generations);';
const newLine='  const stagedGenerations=entries.length===0?board.generations:new Map(board.generations);';

export function deriveEmptyBatchProvider(){
 const held=readFileSync(parentUrl,'utf8');
 assert.equal(sha256(held),heldProviderSha256,'exact qualified provider parent');
 assert.equal(held.split(oldLine).length,2,'one Map-copy seam');
 const normalized=held.replace(oldLine,newLine);
 assert.equal(normalized.replace(newLine,oldLine),held,'one-line inverse proof');
 let importCount=0;
 const loaded=normalized.replace(/from '([^']+)';/g,(original,specifier)=>{
  if(specifier.startsWith('node:'))return original;
  assert.ok(specifier.startsWith('../'),'only relative held imports');
  importCount++;
  return `from '${new URL(specifier,parentUrl).href}';`;
 });
 assert.equal(importCount,2,'all exact held provider imports resolved');
 return Object.freeze({
  heldSha256:heldProviderSha256,
  normalizedSha256:sha256(normalized),
  loadedSha256:sha256(loaded),
  normalized,
  moduleUrl:`data:text/javascript;base64,${Buffer.from(loaded).toString('base64')}`
 });
}
