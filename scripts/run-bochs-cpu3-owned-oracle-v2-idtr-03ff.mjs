/** Capture the separate IDTR-aligned owned paging fixture with the exact published v2 Bochs build. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {endianness,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseBochsCpu3OwnedOracleV2} from './bochs-cpu3-owned-oracle-v2/parse.mjs';
import {patchPinnedHeader,revision,sha256,upstreamHashes} from './bochs-cpu3-owned-oracle-v2/patch.mjs';
import {assertOwnedIdtr03ff} from './bochs-cpu3-owned-oracle-v2-idtr-03ff/contract.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const paths=['test/fixtures/i80386-bochs-cpu3-paging-idtr-03ff.S',
  'scripts/bochs-cpu3-owned-oracle-v2/instrument.cc',
  'scripts/bochs-cpu3-owned-oracle-v2/parse.mjs',
  'scripts/bochs-cpu3-owned-oracle-v2/patch.mjs',
  'scripts/prepare-bochs-cpu3-owned-oracle-v2.mjs',
  'scripts/bochs-cpu3-owned-oracle-v2-idtr-03ff/contract.mjs',
  'scripts/run-bochs-cpu3-owned-oracle-v2-idtr-03ff.mjs',
  'test/bochs-cpu3-owned-oracle-v2-idtr-03ff.test.mjs',
  'docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json'];
const hash=sha256;
const sha=path=>hash(readFileSync(path));
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const assertCommittedBoardSources=()=>{
  for(const path of paths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
    if(hash(committed)!==sha(resolve(repo,path)))
      throw new Error(`board source differs from committed HEAD: ${path}`);
  }
};
if(endianness()!=='LE') throw new Error('v2 dataptr proof requires a little-endian host');
const instrumented=process.env.BOCHS_386_INSTRUMENTED_ROOT;
if(!instrumented) throw new Error('Set BOCHS_386_INSTRUMENTED_ROOT to the separately prepared and built CPU3 source');
const bochsRoot=resolve(instrumented);
if(git(bochsRoot,['rev-parse','HEAD'])!==revision) throw new Error('unexpected Bochs revision');
const altered=git(bochsRoot,['diff','--name-only','HEAD','--']);
if(altered!=='bochs/cpu/cpu.h\nbochs/instrument/stubs/instrument.cc\nbochs/instrument/stubs/instrument.h')
  throw new Error(`Bochs source must differ only at the owned v2 bridge and probe: ${altered}`);
const probe=resolve(repo,'scripts/bochs-cpu3-owned-oracle-v2/instrument.cc');
const body=resolve(bochsRoot,'bochs/instrument/stubs/instrument.cc');
if(sha(probe)!==sha(body)) throw new Error('instrumented Bochs body differs from owned probe');
const patchedHashes={};
for(const path of Object.keys(upstreamHashes)){
  const upstream=execFileSync('git',['show',`HEAD:${path}`],{cwd:bochsRoot});
  const expected=patchPinnedHeader(path,upstream);
  if(hash(expected)!==sha(resolve(bochsRoot,path))) throw new Error(`Bochs header differs from pinned v2 patch: ${path}`);
  patchedHashes[path]=hash(expected);
}
const config=resolve(bochsRoot,'bochs/config.h');
const configText=readFileSync(config,'utf8');
for(const option of ['#define BX_CPU_LEVEL 3','#define BX_DEBUGGER 0',
  '#define BX_INSTRUMENTATION 1',
  '#define BX_SUPPORT_REPEAT_SPEEDUPS 0','#define BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS 0'])
  if(!new RegExp(`^${option}$`,'m').test(configText))
    throw new Error(`Bochs configuration missing ${option}`);
const bochs=resolve(bochsRoot,'bochs/bochs');
const bios=resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy');
const vga=resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin');
assertCommittedBoardSources();
const sourceHashes=Object.fromEntries(paths.map(path=>[path,sha(resolve(repo,path))]));
const boardRevision=git(repo,['rev-parse','HEAD']);
const referencePath=resolve(repo,'docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json');
const referenceReceiptSha256='0865be3b65043672d436b6716fc060795b0853cbac93d2f858f0bcf93f4e73f7';
if(sha(referencePath)!==referenceReceiptSha256) throw new Error('published v2 receipt bytes changed');
const reference=JSON.parse(readFileSync(referencePath,'utf8'));
if(reference.schema!=='bw.bochs-cpu3-owned-memory-capture.v2' ||
    reference.status!=='native-capture-complete' || reference.bochsRevision!==revision)
  throw new Error('published v2 receipt identity changed');
for(const path of ['scripts/bochs-cpu3-owned-oracle-v2/instrument.cc',
  'scripts/bochs-cpu3-owned-oracle-v2/parse.mjs',
  'scripts/bochs-cpu3-owned-oracle-v2/patch.mjs',
  'scripts/prepare-bochs-cpu3-owned-oracle-v2.mjs'])
  if(sourceHashes[path]!==reference.sourceHashes[path])
    throw new Error(`published v2 imported source changed: ${path}`);
if(sha(config)!==reference.bochsConfigSha256 ||
    sha(bochs)!==reference.bochsExecutableSha256 ||
    sha(body)!==reference.bochsProbeSha256)
  throw new Error('native v2 build/config/probe differs from published receipt');

const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-owned-v2-'));
try {
  const object=join(build,'guest.o');
  const image=join(build,'guest.bin');
  execFileSync('as',['--32','-o',object,resolve(repo,paths[0])]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
  const binary=readFileSync(image);
  if(binary.length>1474560) throw new Error('owned fixture exceeds floppy capacity');
  const floppy=Buffer.alloc(1474560);
  binary.copy(floppy);
  const floppyPath=join(build,'floppy.img');
  writeFileSync(floppyPath,floppy);
  const log=join(build,'bochs.log');
  const rc=join(build,'bochsrc');
  writeFileSync(rc,[
    'display_library: nogui',
    'memory: guest=16, host=16',
    `romimage: file=${bios}`,
    `vgaromimage: file=${vga}`,
    'cpu: count=1, ips=10000000',
    `floppya: 1_44=${floppyPath}, status=inserted`,
    'boot: floppy',
    'port_e9_hack: enabled=1',
    `log: ${log}`,
    'panic: action=fatal',
    'error: action=report',
    'info: action=report',
    'debug: action=ignore',
    'mouse: enabled=0',
  ].join('\n')+'\n');
  const run=await new Promise((done,reject)=>{
    const child=spawn('stdbuf',['-o0','-e0',bochs,'-q','-f',rc],
      {stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',sawEnd=false,timedOut=false,hardTimer;
    const stop=()=>{
      child.kill('SIGTERM');
      hardTimer??=setTimeout(()=>child.kill('SIGKILL'),2000);
    };
    const timer=setTimeout(()=>{timedOut=true;stop();},30000);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('latin1');});
    child.stderr.on('data',chunk=>{
      stderr+=chunk.toString('latin1');
      if(stderr.length>20000000){stop();return;}
      if(!sawEnd && stderr.includes('BW386O2\tEND\tBHPG004\t')){
        sawEnd=true;
        stop();
      }
    });
    child.once('error',err=>{clearTimeout(timer);clearTimeout(hardTimer);reject(err);});
    child.once('close',(code,signal)=>{
      clearTimeout(timer);
      clearTimeout(hardTimer);
      done({stdout,stderr,code,signal,sawEnd,timedOut});
    });
  });
  if(run.timedOut || !run.sawEnd) throw new Error(`native checkpoint absent (timeout=${run.timedOut}, exit=${run.code}/${run.signal}): ${run.stderr.slice(-2000)}`);
  const checkpoint=parseBochsCpu3OwnedOracleV2(run.stderr);
  assertOwnedIdtr03ff(checkpoint);
  const start=run.stdout.indexOf('BHPG004');
  if(start<0) throw new Error('port E9 stdout marker absent');
  const bochsLog=readFileSync(log,'utf8');
  if(!bochsLog.includes('Booting from 0000:7c00') || bochsLog.includes('>>PANIC<<'))
    throw new Error('owned Bochs boot did not reach fixture cleanly');
  assertCommittedBoardSources();
  if(paths.some(path=>sha(resolve(repo,path))!==sourceHashes[path]))
    throw new Error('board source changed during native capture');
  const report={schema:'bw.bochs-cpu3-owned-memory-idtr-aligned-capture.v1',status:'native-capture-complete',
    comparison:'not-run',fixtureVariant:'paging-4k-idtr-0-03ff',
    fixtureSourcePath:paths[0],fixtureSourceSha256:sourceHashes[paths[0]],
    referenceReceiptSha256,referenceSourceRevision:reference.boardRevision,
    retainedHookSchema:'bw.bochs-cpu3-owned-memory-checkpoint.v2',
    retainedMarker:'BHPG004',
    boardRevision,sourceHashes,bochsRevision:revision,cpuLevel:3,cpu3NoCr4Pse:true,
    buildRecipe:{configure:['--enable-cpu-level=3','--with-nogui','--disable-plugins',
      '--disable-debugger','--disable-repeat-speedups','--disable-handlers-chaining',
      '--enable-instrumentation=instrument/stubs'],make:['make','-j1']},
    bochsUpstreamHeaderHashes:upstreamHashes,bochsPatchedHeaderHashes:patchedHashes,
    bochsConfigSha256:sha(config),bochsExecutableSha256:sha(bochs),
    bochsStubHeaderSha256:sha(resolve(bochsRoot,'bochs/instrument/stubs/instrument.h')),
    bochsProbeSha256:sha(body),biosSha256:sha(bios),vgaBiosSha256:sha(vga),
    imageSha256:hash(binary),floppySha256:hash(floppy),
    marker:run.stdout.slice(start,start+7),hostEndianness:'LE',
    hookBytePolicy:'borrowed dataptr bytes; linear write prewrite, linear read postread, page-walk physical A/D write postwrite',
    coverage:'CPU instrumentation callbacks only; no complete physical bus, MMIO, DMA, or cycle equivalence',
    ramSnapshotDomain:'fixed plain owned low RAM only; not bus events',bochsExit:{code:run.code,signal:run.signal},
    checkpoint};
  console.log(JSON.stringify(report,null,2));
} finally {rmSync(build,{recursive:true,force:true});}
