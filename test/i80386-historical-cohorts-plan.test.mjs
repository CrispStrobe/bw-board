import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {admitFixtureRoster,admitHistoricalBytes,admitHistoricalClosure,admitLiveInputs,admitWorkingTestCensus,expandTestSelection,historicalDependencyClosure,historicalRevision,historicalTests,splitHistoricalCohorts} from '../scripts/i80386-historical-cohorts.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},maxBuffer:4<<20,timeout:10000});
const original=path=>git(['show',historicalRevision+':'+path]);
const current=path=>git(['show','HEAD:'+path]);
const tracked=git(['ls-tree','-r','--name-only','HEAD','test']).toString().trim().split('\n');
const historicalNames=git(['ls-tree','-r','--name-only',historicalRevision,'test']).toString().trim().split('\n');
const fixtures=admitFixtureRoster(tracked,historicalNames).frozen;
const script=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).scripts.test;
const inputs=()=>({
 currentTests:new Map(historicalTests.map(path=>[path,current(path)])),
 historicalTests:new Map(historicalTests.map(path=>[path,original(path)])),
 currentLock:current('package-lock.json'),
 historicalLock:original('package-lock.json'),
 historicalCpu:original('src/experimental/i80386.js'),
});

test('full package and i80386 selections cover every fixed file once and retain live tests',()=>{
 for(const selection of [script,'i80386']){
  const plan=splitHistoricalCohorts(selection,tracked);
  assert.deepEqual([...plan.historical].sort(),[...historicalTests].sort());
  assert.ok(plan.current.includes('test/i80386-dpmi-frame-journal.test.mjs'));
  assert.ok(plan.current.includes('test/i80386-dpmi-frame-journal-boundaries.test.mjs'));
  assert.equal(plan.selected.length,plan.current.length+plan.historical.length);
 }
});
test('frozen tests, lock and ordinary CPU match authentic Git bytes',()=>{
 assert.equal(admitHistoricalBytes(inputs()).revision,historicalRevision);
 const roles=historicalDependencyClosure(original,fixtures);
 assert.ok(roles.includes('src/experimental/i80386.js'));
 assert.ok(roles.includes('test/fixtures/i80386-native-cold-reset-capture.json.gz'));
 assert.ok(roles.includes('scripts/bochs-cpu3-native-protected-ram/cpu-profile.mjs'));
 assert.equal(admitHistoricalClosure({roles,fixturePaths:fixtures,readCurrent:current,readHistorical:original}).literalAndFixtureRoles,roles.length);
});
test('changed fixed file, lock, CPU or roster refuses admission',()=>{
 const changed=inputs(),path=historicalTests[0];changed.currentTests.set(path,Buffer.concat([changed.currentTests.get(path),Buffer.from('\n')]));
 assert.throws(()=>admitHistoricalBytes(changed),/unchanged historical test/);
 const lock=inputs();lock.currentLock=Buffer.concat([lock.currentLock,Buffer.from('\n')]);
 assert.throws(()=>admitHistoricalBytes(lock),/unchanged package lock/);
 const cpu=inputs();cpu.historicalCpu=Buffer.from('not the pinned CPU');
 assert.throws(()=>admitHistoricalBytes(cpu),/frozen ordinary CPU source/);
 const roster=inputs();roster.historicalTests.delete(path);
 assert.throws(()=>admitHistoricalBytes(roster),/historical fixed test roster/);
});
test('selection refuses omitted fixed roles, duplicate fixed roles, and untracked inputs',()=>{
 const names=tracked.filter(path=>path!==historicalTests[0]);
 assert.throws(()=>splitHistoricalCohorts('i80386',names),/all fixed tests selected once/);
 const doubled=splitHistoricalCohorts('node --test test/*.test.mjs '+historicalTests[0],tracked);
 assert.equal(doubled.expandedArgumentCount,doubled.selected.length+1);
 assert.equal(doubled.historical.length,historicalTests.length);
 assert.throws(()=>expandTestSelection('node --test test/not-present.test.mjs',tracked),/explicit test is tracked/);
});
test('changed historical helper or fixture cannot be hidden behind the frozen worktree',()=>{
 const roles=historicalDependencyClosure(original,fixtures),target='scripts/bochs-cpu3-native-protected-ram/cpu-profile.mjs';
 const altered=name=>name===target?Buffer.concat([current(name),Buffer.from('\n')]):current(name);
 assert.throws(()=>admitHistoricalClosure({roles,fixturePaths:fixtures,readCurrent:altered,readHistorical:original}),/historical literal dependencies and named fixtures/);
 const omitted=roles.filter(name=>name!=='test/fixtures/i80386-native-cold-reset-capture.json.gz');
 assert.throws(()=>admitHistoricalClosure({roles:omitted,fixturePaths:fixtures,readCurrent:current,readHistorical:original}),/complete literal dependency and named fixture set/);
 assert.throws(()=>admitFixtureRoster(tracked.filter(name=>name!==fixtures[0]),historicalNames),/frozen named i80386 fixture remains present/);
 assert.equal(admitFixtureRoster([...tracked,'test/fixtures/i80386-new-current-control.json'],historicalNames).added,1);
});
test('live source admission refuses a dirty selected test or CPU',()=>{
 const selected=['test/i80386-dpmi-frame-journal.test.mjs'];
 assert.equal(admitLiveInputs(selected,current,current).selectedTests,1);
 const dirtyTest=name=>name===selected[0]?Buffer.concat([current(name),Buffer.from('\n')]):current(name);
 assert.throws(()=>admitLiveInputs(selected,dirtyTest,current),/live source matches HEAD/);
 const dirtyCpu=name=>name==='src/experimental/i80386.js'?Buffer.concat([current(name),Buffer.from('\n')]):current(name);
 assert.throws(()=>admitLiveInputs(selected,dirtyCpu,current),/live source matches HEAD/);
});
test('top-level test census refuses a generated or missing test',()=>{
 const files=['test/a.test.mjs','test/b.test.js','test/fixtures/input.json'];
 assert.equal(admitWorkingTestCensus(files,[...files]),2);
 assert.throws(()=>admitWorkingTestCensus(files,[...files,'test/extra.test.mjs']),/working top-level test census/);
 assert.throws(()=>admitWorkingTestCensus(files,files.filter(name=>name!=='test/b.test.js')),/working top-level test census/);
});
test('literal closure follows a second relative import after a semicolon',()=>{
 const seed=historicalTests[0],dependency='scripts/cohort-synthetic-control.mjs';
 const old=name=>Buffer.from(name===seed?"import 'node:assert';import {x} from '../scripts/cohort-synthetic-control.mjs';":'');
 assert.ok(historicalDependencyClosure(old).includes(dependency));
});
