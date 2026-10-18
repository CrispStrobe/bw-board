/** Keep fixed-source x86 proofs on their original CPU while testing the live core. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const historicalRevision='41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7';
export const historicalCpuSha256='6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed';
export const historicalTests=Object.freeze([
 'test/i80386-native-cold-reset-report.test.mjs',
 'test/i80386-native-combined-paging-ram-board-gate.test.mjs',
 'test/i80386-native-owned-pic-imr-profile.test.mjs',
 'test/i80386-native-ram-coherence-report.test.mjs',
 'test/i80386-native-rep-pf-pit-board-gate.test.mjs',
 'test/i80386-nonidentity-paging-source.test.mjs',
 'test/i80386-paged-int-iret-source.test.mjs',
 'test/i80386-paged-pagefault-source.test.mjs',
 'test/i80386-protected-ram-source.test.mjs',
 'test/i80386-protected-stack-source.test.mjs',
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pathPattern=/^test\/[A-Za-z0-9_.*?/-]+$/;
const escape=s=>s.replace(/[|\\{}()[\]^$+?.]/g,'\\$&');

export function expandTestSelection(selection,trackedNames){
 assert.ok(Array.isArray(trackedNames)&&trackedNames.every(name=>typeof name==='string'&&/^test\/[A-Za-z0-9_./-]+$/.test(name)));
 assert.equal(new Set(trackedNames).size,trackedNames.length,'unique tracked test paths');
 const tokens=selection==='i80386' ? ['test/i80386*.test.mjs'] : (()=>{
  assert.match(selection,/^node --test(?: test\/[A-Za-z0-9_.*?/-]+)+$/,'package test script');
  return selection.slice('node --test '.length).split(' ');
 })();
 const selected=[];
 for(const token of tokens){
  assert.match(token,pathPattern);
  if(!/[?*]/.test(token)){
   assert.ok(trackedNames.includes(token),'explicit test is tracked: '+token);
   selected.push(token);continue;
  }
  const pattern=new RegExp('^'+[...token].map(c=>c==='*'?'[^/]*':c==='?'?'[^/]':escape(c)).join('')+'$');
  const matches=trackedNames.filter(name=>pattern.test(name)).sort();
  assert.ok(matches.length>0,'wildcard has tracked tests: '+token);
  selected.push(...matches);
 }
 return selected;
}

export function splitHistoricalCohorts(selection,trackedNames){
 const expanded=expandTestSelection(selection,trackedNames);
 // Node's test runner deduplicates file arguments. Preserve the first matching
 // occurrence of each path, including explicit package paths after wildcards.
 const selected=[...new Set(expanded)];
 const fixed=new Set(historicalTests);
 assert.equal(fixed.size,historicalTests.length,'unique fixed roster');
 const historical=selected.filter(path=>fixed.has(path));
 assert.equal(historical.length,historicalTests.length,'all fixed tests selected once');
 assert.deepEqual([...historical].sort(),[...historicalTests].sort(),'exact fixed test roster');
 const current=selected.filter(path=>!fixed.has(path));
 assert.ok(current.length>0,'live test cohort is nonempty');
 assert.equal(current.length+historical.length,selected.length,'complete selection partition');
 return {selected,current,historical,expandedArgumentCount:expanded.length};
}

export function historicalDependencyClosure(readHistorical,fixturePaths=[]){
 assert.equal(typeof readHistorical,'function');
 assert.ok(Array.isArray(fixturePaths)&&fixturePaths.every(name=>/^test\/fixtures\/i80386-[A-Za-z0-9_.-]+$/.test(name)));
 const queue=[...historicalTests,...fixturePaths],seen=new Set();
 while(queue.length){
  const name=queue.shift();if(seen.has(name))continue;
  assert.ok(/^[A-Za-z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').includes('..'),'safe historical role');
  const bytes=readHistorical(name);
  assert.ok(Buffer.isBuffer(bytes),'historical role bytes '+name);
  seen.add(name);
  if(!/\.(?:mjs|js)$/.test(name))continue;
  const source=bytes.toString('utf8');
  const links=[];
  for(const pattern of [
   /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g,
   /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
   /new\s+URL\s*\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ])for(const match of source.matchAll(pattern))links.push(match[1]);
  for(const relative of links){
   if(relative.endsWith('/'))continue;
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
   assert.ok(!target.startsWith('../')&&!target.startsWith('/')&&target!=='.','contained historical import');
   if(!seen.has(target))queue.push(target);
  }
 }
 return [...seen].sort();
}

export function admitHistoricalClosure({roles,fixturePaths=[],readCurrent,readHistorical}){
 assert.ok(Array.isArray(roles)&&roles.length>=historicalTests.length);
 assert.equal(typeof readCurrent,'function');assert.equal(typeof readHistorical,'function');
 assert.deepEqual(roles,historicalDependencyClosure(readHistorical,fixturePaths),'complete literal dependency and named fixture set');
 const changed=[];
 for(const name of roles){
  if(name==='src/experimental/i80386.js')continue;
  const current=readCurrent(name),old=readHistorical(name);
  assert.ok(Buffer.isBuffer(current)&&Buffer.isBuffer(old),'source-bound historical role '+name);
  if(sha(current)!==sha(old))changed.push(name);
 }
 assert.deepEqual(changed,[],'historical literal dependencies and named fixtures remain byte-exact');
 return {literalAndFixtureRoles:roles.length,excludedLiveCpu:'src/experimental/i80386.js'};
}

export function admitFixtureRoster(currentNames,historicalNames){
 const select=names=>{
  assert.ok(Array.isArray(names));
  return names.filter(name=>/^test\/fixtures\/i80386-[A-Za-z0-9_.-]+$/.test(name)).sort();
 };
 const current=select(currentNames),historical=select(historicalNames);
 assert.ok(historical.length>0,'named frozen i80386 fixtures');
 const available=new Set(current);
 for(const name of historical)assert.ok(available.has(name),'frozen named i80386 fixture remains present: '+name);
 return {frozen:historical,added:current.filter(name=>!historical.includes(name)).length};
}

export function admitLiveInputs(selected,readWorking,readCommitted){
 assert.ok(Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length);
 assert.equal(typeof readWorking,'function');assert.equal(typeof readCommitted,'function');
 for(const name of [...selected,'src/experimental/i80386.js']){
  const working=readWorking(name),committed=readCommitted(name);
  assert.ok(Buffer.isBuffer(working)&&Buffer.isBuffer(committed),'live source bytes '+name);
  assert.equal(sha(working),sha(committed),'live source matches HEAD '+name);
 }
 return {selectedTests:selected.length,cpuSha256:sha(readCommitted('src/experimental/i80386.js'))};
}

export function admitWorkingTestCensus(trackedNames,workingNames){
 const top=names=>{
  assert.ok(Array.isArray(names));
  return names.filter(name=>/^test\/[^/]+\.test\.(?:mjs|js)$/.test(name)).sort();
 };
 const tracked=top(trackedNames),working=top(workingNames);
 assert.deepEqual(working,tracked,'working top-level test census matches Git');
 return tracked.length;
}

export function admitHistoricalBytes({currentTests,historicalTests:originalTests,currentLock,historicalLock,historicalCpu}){
 assert.ok(currentTests instanceof Map&&originalTests instanceof Map);
 assert.deepEqual([...currentTests.keys()].sort(),[...historicalTests].sort(),'current fixed test roster');
 assert.deepEqual([...originalTests.keys()].sort(),[...historicalTests].sort(),'historical fixed test roster');
 for(const path of historicalTests){
  const current=currentTests.get(path),original=originalTests.get(path);
  assert.ok(Buffer.isBuffer(current)&&Buffer.isBuffer(original),'fixed test bytes '+path);
  assert.equal(sha(current),sha(original),'unchanged historical test '+path);
 }
 assert.ok(Buffer.isBuffer(currentLock)&&Buffer.isBuffer(historicalLock)&&Buffer.isBuffer(historicalCpu));
 assert.equal(sha(currentLock),sha(historicalLock),'unchanged package lock');
 assert.equal(sha(historicalCpu),historicalCpuSha256,'frozen ordinary CPU source');
 return {revision:historicalRevision,cpuSha256:historicalCpuSha256,testCount:historicalTests.length,lockSha256:sha(currentLock)};
}
