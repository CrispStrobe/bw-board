import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectFixtureToolchain} from '../scripts/check-x86-fixture-toolchain.mjs';

function setup(t){
  const root=mkdtempSync(join(tmpdir(),'bw-toolchain-control-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tools=join(root,'tools');mkdirSync(tools);
  for(const name of ['as','ld','objcopy'])writeFileSync(join(tools,name),'synthetic tool identity\n',{mode:0o755});
  const calls=[],banners={as:'GNU assembler',ld:'GNU ld',objcopy:'GNU objcopy'};
  const options={env:{PATH:tools,GITHUB_SHA:'controlled-head',ImageOS:'controlled-image',ImageVersion:'controlled-version'},
    run:(path,args)=>{calls.push([path,...args]);return `${banners[basename(path)]} (controlled) 2.42\n`;}};
  return {root,tools,calls,options,banners};
}

test('compatible toolchain records all three executable identities, versions and exact probe argv',t=>{
  const s=setup(t),r=inspectFixtureToolchain(s.options);
  assert.equal(r.admitted,true);assert.deepEqual(r.errors,[]);assert.equal(r.requiredVersion,'2.42');
  assert.equal(r.head,'controlled-head');assert.equal(r.runnerImageVersion,'controlled-version');
  for(const name of ['as','ld','objcopy']){
    assert.equal(r.tools[name].sha256,createHash('sha256').update(readFileSync(join(s.tools,name))).digest('hex'));
    assert.deepEqual(r.tools[name].argv,[join(s.tools,name),'--version']);
  }
  assert.equal(s.calls.length,3);
});

for(const name of ['as','ld','objcopy'])test(`reject ${name} 2.46 without substituting flags or accepting partial admission`,t=>{
  const s=setup(t);s.options.run=path=>`${s.banners[basename(path)]} (controlled) ${basename(path)===name?'2.46':'2.42'}\n`;
  const r=inspectFixtureToolchain(s.options);
  assert.equal(r.admitted,false);assert.equal(r.errors.length,1);assert.match(r.errors[0],/expected GNU 2.42/);
  assert.equal(Object.keys(r.tools).length,3);
});

test('reject non-GNU and development-version banners rather than a loose substring match',t=>{
  const s=setup(t);
  for(const text of ['not GNU 2.42\n','GNU assembler (controlled) 2.42.50\n']){
    s.options.run=()=>text;assert.equal(inspectFixtureToolchain(s.options).admitted,false);
  }
});

test('missing tools and failed version probes refuse admission with explicit provenance gaps',t=>{
  const s=setup(t);s.options.env.PATH=join(s.root,'absent');
  const missing=inspectFixtureToolchain(s.options);assert.equal(missing.admitted,false);assert.equal(missing.errors.length,3);
  s.options.env.PATH=s.tools;s.options.run=()=>{throw new Error('controlled timeout');};
  const failed=inspectFixtureToolchain(s.options);assert.equal(failed.admitted,false);
  assert.equal(failed.errors.length,3);assert.equal(Object.keys(failed.tools).length,3);
});

test('actual CLI preserves provenance file and nonzero exit for incompatible synthetic tools',t=>{
  const s=setup(t),output=join(s.root,'provenance.json');
  for(const name of ['as','ld','objcopy'])writeFileSync(join(s.tools,name),
    `#!/bin/sh\nprintf '%s\\n' '${s.banners[name]} (controlled) 2.46'\n`,{mode:0o755});
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-x86-fixture-toolchain.mjs',import.meta.url)),
    '--out',output],{env:s.options.env,encoding:'utf8',timeout:5000});
  assert.equal(child.status,1);const report=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(report.admitted,false);assert.equal(report.errors.length,3);
  assert.equal(JSON.parse(child.stdout).admitted,false);
});

test('ordinary job selects compatible runner and checks provenance before original serial tests',()=>{
  const w=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  const job=w.match(/^  test:\n([\s\S]*?)(?=^  [a-z]|$(?![\s\S]))/m)?.[1];assert.ok(job);
  assert.match(job,/runs-on: ubuntu-24\.04/);assert.match(job,/if: github\.event_name != 'pull_request'/);
  const gate=job.indexOf('node scripts/check-x86-fixture-toolchain.mjs --out');
  const originalTest=job.indexOf('node scripts/run-ci-tests-serial.mjs');
  assert.ok(gate>=0&&gate<originalTest);assert.match(job,/\$\{\{ runner\.temp \}\}\/bw-x86-toolchain\.json/);
  assert.match(job,/if: \$\{\{ always\(\) && steps\.ordinary_tests\.outcome != 'skipped' \}\}/);
});
