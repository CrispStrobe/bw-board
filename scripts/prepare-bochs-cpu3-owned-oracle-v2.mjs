/** Prepare a fresh, source-pinned Bochs CPU3 build tree; no build or guest run. */
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchPinnedHeader,revision,sha256,upstreamHashes} from './bochs-cpu3-owned-oracle-v2/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.BOCHS_386_ROOT && resolve(process.env.BOCHS_386_ROOT);
const body=resolve(repo,'scripts/bochs-cpu3-owned-oracle-v2/instrument.cc');
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const usage='BOCHS_386_ROOT=/path/to/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-owned-oracle-v2.mjs --check | --prepare /new/path';
const [mode,destination,...extra]=process.argv.slice(2);
if(!source || extra.length || (mode==='--check' && destination) ||
    (mode==='--prepare' && !destination) || !['--check','--prepare'].includes(mode))
  throw new Error(usage);
if(git(source,['rev-parse','HEAD'])!==revision ||
    git(source,['status','--porcelain','--untracked-files=no']))
  throw new Error('Bochs input must be the clean pinned revision');
const changed={};
for(const path of Object.keys(upstreamHashes))
  changed[path]=patchPinnedHeader(path,readFileSync(resolve(source,path)));
const result={bochsRevision:revision,upstreamHashes,
  patchedHashes:Object.fromEntries(Object.entries(changed).map(([path,bytes])=>[path,sha256(bytes)])),
  ownedProbeSha256:sha256(readFileSync(body))};
if(mode==='--prepare'){
  const target=resolve(destination);
  if(existsSync(target)) throw new Error(`destination already exists: ${target}`);
  execFileSync('git',['clone','--local','--no-hardlinks','--quiet',source,target]);
  if(git(target,['rev-parse','HEAD'])!==revision) throw new Error('cloned Bochs revision changed');
  for(const [path,bytes] of Object.entries(changed)) writeFileSync(resolve(target,path),bytes);
  copyFileSync(body,resolve(target,'bochs/instrument/stubs/instrument.cc'));
  result.preparedSource=target;
  result.configure=['./configure','--enable-cpu-level=3','--with-nogui',
    '--disable-plugins','--disable-debugger','--disable-repeat-speedups',
    '--disable-handlers-chaining','--enable-instrumentation=instrument/stubs'];
  result.build=['make','-j1'];
}
console.log(JSON.stringify(result,null,2));
