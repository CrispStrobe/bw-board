import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Tiny source-only helper compilation: never links or loads a native addon.
const directory=mkdtempSync(join(tmpdir(),'owned-clock-c-helper-')),binary=join(directory,'helper');
execFileSync('g++',['-std=c++17','-O0','-Wall','-Wextra',fileURLToPath(new URL('./fixtures/i80386-owned-clock-harness.cc',import.meta.url)),'-o',binary]);
process.on('exit',()=>rmSync(directory,{recursive:true,force:true}));
for(const mode of ['ordered','900','mapping-Q0','post-valid','longjmp'])test('actual C helper positive '+mode,()=>{const r=spawnSync(binary,[mode],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);assert.equal(r.stdout,'PASS\n');});
const denied={ 'init-repeat':'owned-init-phase','entry-repeat':'owned-query-phase','post-wrong':'owned-query-phase','entry-due':'owned-entry-due','post-debt':'owned-pio-debt','zero-deadline':'owned-state-reply','oversize-deadline':'owned-state-reply','mapping-N':'owned-N-mapping-pending','mapping-REP':'owned-Q-mapping-pending','lag':'owned-native-ledger','N-cap':'owned-N-cap','Q-cap':'owned-Q-cap-or-due','due':'owned-Q-cap-or-due','901':'owned-tape-capacity','invalid':'owned-word'};
for(let i=0;i<7;i++)denied['reply-'+i]=i===3||i===4?'owned-clock-reply':'owned-state-reply';
for(const [mode,reason] of Object.entries(denied))test('actual C helper denies '+mode,()=>{const r=spawnSync(binary,[mode],{encoding:'utf8',timeout:3000});assert.equal(r.status,73,JSON.stringify(r));assert.equal(r.signal,null);assert.equal(r.stderr,reason+'\n');assert.equal(r.stdout,'');});
