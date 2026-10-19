#!/usr/bin/env node
/** Disjoint self-sample attribution for an ordinary 386 V8 CPU profile. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const core='/src/experimental/i80386.js';
const board='/src/experimental/i80386-at-machine.js';
const consoleScript='/scripts/run-i80386-at-console.mjs';
const fetchNames=new Set(['_fetch8','_fetchN']);
const dataNames=new Set(['_read','_write','_readLinear','_writeLinear',
  '_readPhysical','_writePhysical','_decodeEA']);
const urlOf=node=>node?.callFrame?.url??'';
const nameOf=node=>node?.callFrame?.functionName??'';

export function summarizeOrdinaryFetchProfile(profile){
  if(!Array.isArray(profile?.nodes)||!Array.isArray(profile.samples)||
      !profile.nodes.length||!profile.samples.length)
    throw new Error('V8 CPU profile needs nonempty nodes and samples');
  const nodes=new Map(),parents=new Map();
  for(const node of profile.nodes){
    if(!Number.isInteger(node.id)||nodes.has(node.id))throw new Error('invalid V8 node id');
    nodes.set(node.id,node);
    for(const child of node.children??[]){
      if(parents.has(child))throw new Error('V8 node has multiple parents');
      parents.set(child,node.id);
    }
  }
  const counts={codeFetchOrigin:0,dataOrEaOrigin:0,coreOther:0,
    atBoardOther:0,consoleOther:0,allOther:0};
  let missingNodes=0;
  for(const id of profile.samples){
    const leaf=nodes.get(id);
    if(!leaf){missingNodes++;continue;}
    let cursor=id,fetch=false,data=false,depth=0;
    while(cursor!==undefined){
      const node=nodes.get(cursor);
      if(!node)throw new Error('V8 CPU profile has a missing parent');
      if(urlOf(node).endsWith(core)&&fetchNames.has(nameOf(node)))fetch=true;
      if(urlOf(node).endsWith(core)&&dataNames.has(nameOf(node)))data=true;
      cursor=parents.get(cursor);
      if(++depth>nodes.size)throw new Error('V8 CPU profile parent cycle');
    }
    const url=urlOf(leaf);
    if(fetch)counts.codeFetchOrigin++;
    else if(data)counts.dataOrEaOrigin++;
    else if(url.endsWith(core))counts.coreOther++;
    else if(url.endsWith(board))counts.atBoardOther++;
    else if(url.endsWith(consoleScript))counts.consoleOther++;
    else counts.allOther++;
  }
  if(missingNodes)throw new Error(`${missingNodes} V8 samples have no node`);
  const totalSamples=profile.samples.length;
  if(Object.values(counts).reduce((a,b)=>a+b,0)!==totalSamples)
    throw new Error('profile sample partition is incomplete');
  return {schema:'bw.i80386-ordinary-fetch-v8-summary.v1',
    method:'One category per V8 self sample; fetch/data ancestry is checked before leaf file. Inlined fetch work without a visible fetch frame remains in another category.',
    totalSamples,counts,
    codeFetchPercent:100*counts.codeFetchOrigin/totalSamples,
    screenPass:counts.codeFetchOrigin/totalSamples>=0.10};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw new Error('usage: summarize-i80386-ordinary-fetch-profile.mjs PROFILE.cpuprofile');
  const profile=JSON.parse(readFileSync(process.argv[2],'utf8'));
  process.stdout.write(`${JSON.stringify(summarizeOrdinaryFetchProfile(profile),null,2)}\n`);
}
