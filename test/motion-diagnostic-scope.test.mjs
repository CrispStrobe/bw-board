import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {MOTION_DIAGNOSTIC_PATHS as PATHS,admitMotionDiagnosticScope} from '../scripts/check-motion-diagnostic-scope.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const files=()=>Object.entries(PATHS).map(([filename,status])=>({filename,status}));
const packet=()=>{
    const pull={number:731,state:'open',head:{sha:head,repo:{full_name:'CrispStrobe/bw-board'}},
        base:{sha:'e'.repeat(40),ref:'master',repo:{full_name:'CrispStrobe/bw-board'}},changed_files:Object.keys(PATHS).length};
    return {before:structuredClone(pull),after:structuredClone(pull),files:files(),expectedHead:head,expectedPR:731};
};
test('exact first-introduction scope requires real focused controls and preserves all other checks',()=>{
    const proof=admitMotionDiagnosticScope(packet());assert.equal(proof.focusedControlsRequired,true);
});
const cuts=[
    ['wrong expected PR',p=>{p.expectedPR=732;}],
    ['missing expected PR',p=>{delete p.expectedPR;}],
    ['base advanced',p=>{p.after.base.sha='f'.repeat(40);}],
    ['missing base identity',p=>{delete p.before.base.sha;}],
    ['empty files',p=>{p.files=[];p.before.changed_files=p.after.changed_files=0;}],
    ['unknown source',p=>{p.files[0].filename='src/board.js';}],
    ['pin',p=>{p.files[0].filename='scripts/build-labwired-wasm.mjs';}],
    ['qualification workflow',p=>{p.files[0].filename='.github/workflows/labwired-wasm.yml';}],
    ['unknown workflow',p=>{p.files[0].filename='.github/workflows/other.yml';}],
    ['incomplete file API',p=>{p.files.pop();}],
    ['API error object',p=>{p.before={message:'API unavailable'};}],
    ['missing metadata',p=>{p.after=null;}],
    ['head advanced',p=>{p.after.head.sha='f'.repeat(40);}],
    ['count changed',p=>{p.after.changed_files++;}],
    ['foreign source',p=>{p.before.head.repo.full_name='another/repo';}],
    ['closed pull',p=>{p.after.state='closed';}],
    ['noncanonical base',p=>{p.before.base.ref='another';}],
    ['invalid head',p=>{p.expectedHead='HEAD';}],
    ['duplicate file',p=>{p.files[1]={...p.files[0]};}],
    ['renamed path',p=>{p.files[0].previous_filename='old';}],
    ['removed path',p=>{p.files[0].status='removed';}],
    ['subsequent edit outside introduction',p=>{p.files[0].status='modified';}],
    ['missing exact path',p=>{p.files.pop();p.before.changed_files--;p.after.changed_files--;}],
    ['mixed production addition',p=>{p.files.push({filename:'src/board.js',status:'modified'});p.before.changed_files++;p.after.changed_files++;}]
];
for(const [name,change] of cuts)test('diagnostic scope refuses '+name,()=>{
    const p=packet();change(p);assert.throws(()=>admitMotionDiagnosticScope(p),{name:'AssertionError'});
});
const workflow=readFileSync(new URL('../.github/workflows/ci-tier-gate.yml',import.meta.url),'utf8');
const shell=workflow.split('        run: |\n')[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
assert.match(shell,/set -euo pipefail/);
const controls='node --test test/labwired-motion-source-diagnostic.test.mjs test/wasm-motion-profile.test.mjs test/motion-ab-receipt.test.mjs || exit 1';
function runGate({rows=files(),hasFull='false',apiError=false,body=shell}={}) {
    const temp=mkdtempSync(join(tmpdir(),'bw-motion-gate-'));mkdirSync(join(temp,'bin'));
    const p=packet();p.files=rows;p.before.changed_files=p.after.changed_files=rows.length;
    writeFileSync(join(temp,'pull.json'),JSON.stringify(p.before));writeFileSync(join(temp,'files.json'),JSON.stringify(rows));
    writeFileSync(join(temp,'bin','gh'),`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(process.env.API_ERROR==='1')process.exit(45);const p=a.find(x=>x.startsWith('repos/'));if(!p)process.exit(46);const rows=JSON.parse(fs.readFileSync(process.env.FAKE_FILES));if(p.endsWith('/files'))console.log(a.includes('--jq')?rows.map(r=>r.filename).join('\\n'):JSON.stringify([rows]));else console.log(fs.readFileSync(process.env.FAKE_PULL,'utf8'));`,{mode:0o755});
    try {
        const r=spawnSync('/bin/bash',['-c',body],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:512*1024,
            env:{PATH:join(temp,'bin')+':'+process.env.PATH,RUNNER_TEMP:temp,GH_TOKEN:'fixture-no-network',
                REPO:'CrispStrobe/bw-board',PR:'731',HAS_FULL:hasFull,EXPECTED_HEAD:head,
                FAKE_FILES:join(temp,'files.json'),FAKE_PULL:join(temp,'pull.json'),API_ERROR:apiError?'1':'0'}});
        assert.ifError(r.error);return r;
    } finally {rmSync(temp,{recursive:true,force:true});}
}
test('actual gate shell runs genuine focused controls for exact diagnostic scope',()=>{
    assert.equal(shell.split(controls).length-1,1);
    const r=runGate();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/57/);
    assert.match(r.stdout,/focused controls passed/);
});
test('actual gate keeps docs-only and existing full-label behavior; API/empty/mixed refuse',()=>{
    assert.equal(runGate({rows:[{filename:'docs/example.md',status:'added'}]}).status,0);
    assert.equal(runGate({hasFull:'true',apiError:true}).status,0);
    assert.notEqual(runGate({rows:[]}).status,0);
    assert.notEqual(runGate({rows:[{filename:'',status:'added'}]}).status,0);
    assert.notEqual(runGate({apiError:true}).status,0);
    assert.notEqual(runGate({hasFull:''}).status,0);
    assert.notEqual(runGate({hasFull:'invalid'}).status,0);
    const mixed=[...files(),{filename:'src/board.js',status:'modified'}];assert.notEqual(runGate({rows:mixed}).status,0);
});
test('actual gate cannot turn failed focused controls into admission',()=>{
    const failed=runGate({body:shell.replace(controls,"node -e 'process.exit(7)' || exit 1")});
    assert.equal(failed.status,1);assert.doesNotMatch(failed.stdout,/focused controls passed/);
});
test('actual source scope branch is load-bearing against unconditional-admission mutation',()=>{
    const anchor='if node scripts/check-motion-diagnostic-scope.mjs "$RUNNER_TEMP/motion-before.json" "$RUNNER_TEMP/motion-pages.json" "$RUNNER_TEMP/motion-after.json" "$EXPECTED_HEAD" "$PR"; then';
    assert.equal(shell.split(anchor).length-1,1);
    const rows=[...files(),{filename:'src/board.js',status:'modified'}];
    assert.notEqual(runGate({rows}).status,0);
    const mutant=runGate({rows,body:shell.replace(anchor,'if true; then')});
    assert.equal(mutant.status,0,'mutation actually admits mixed production; unchanged refusal control detects it');
});
