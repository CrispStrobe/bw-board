/** Prepare a separate, source-pinned Bochs CPU3 instrumentation tree. No build or guest run. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PIN='0e45b736ef9792eb9b752b0a35db49eaf2faea47';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const probe=resolve(repo,'scripts/bochs-cpu3-owned-oracle/instrument.cc');
const source=resolve(process.env.BOCHS_386_ROOT??'');
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const usage='BOCHS_386_ROOT=/path/to/pinned/Bochs node scripts/prepare-bochs-cpu3-owned-oracle.mjs --check | --prepare /new/path';

const [mode,destination,...extra]=process.argv.slice(2);
if(!process.env.BOCHS_386_ROOT || extra.length ||
    (mode!=='--check' && (mode!=='--prepare' || !destination)) ||
    (mode==='--check' && destination)) throw new Error(usage);
if(git(source,['rev-parse','HEAD'])!==PIN) throw new Error(`Bochs source must be ${PIN}`);
if(git(source,['status','--porcelain','--untracked-files=no']))
  throw new Error('Bochs tracked source must be clean');
const stub=resolve(source,'bochs/instrument/stubs/instrument.h');
const body=resolve(source,'bochs/instrument/stubs/instrument.cc');
if(!existsSync(stub) || !existsSync(body)) throw new Error('pinned Bochs instrumentation stubs missing');
const header=readFileSync(stub,'utf8');
for(const hook of ['BX_INSTR_BEFORE_EXECUTION','BX_INSTR_LIN_ACCESS','BX_INSTR_PHY_ACCESS',
  'BX_INSTR_INP2','BX_INSTR_OUTP'])
  if(!header.includes(`#define ${hook}(`)) throw new Error(`Bochs hook missing: ${hook}`);

const result={bochsRevision:PIN,bochsStubHeaderSha256:sha256(stub),
  bochsStubBodySha256:sha256(body),ownedProbeSha256:sha256(probe)};
if(mode==='--prepare'){
  const target=resolve(destination);
  if(existsSync(target)) throw new Error(`destination already exists: ${target}`);
  execFileSync('git',['clone','--local','--no-hardlinks','--quiet',source,target]);
  if(git(target,['rev-parse','HEAD'])!==PIN) throw new Error('cloned Bochs revision changed');
  copyFileSync(probe,resolve(target,'bochs/instrument/stubs/instrument.cc'));
  result.preparedSource=target;
  result.configure=[
    './configure','--enable-cpu-level=3','--with-nogui','--disable-plugins',
    '--disable-debugger','--disable-repeat-speedups','--disable-handlers-chaining',
    '--enable-instrumentation=instrument/stubs',
  ];
  result.next='After the serial guest slot is free: cd preparedSource/bochs; run configure above; make -j1; then run the owned floppy fixture and capture BW386O1 stderr.';
}
console.log(JSON.stringify(result,null,2));
