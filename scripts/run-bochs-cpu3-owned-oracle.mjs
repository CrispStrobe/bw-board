/** Boot only the owned VM-task fixture and capture a native CPU3 hook checkpoint. */
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseBochsCpu3OwnedOracle} from './bochs-cpu3-owned-oracle/parse.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const revision='0e45b736ef9792eb9b752b0a35db49eaf2faea47';
const paths=['test/fixtures/i80386-vm-task.S',
  'scripts/bochs-cpu3-owned-oracle/instrument.cc',
  'scripts/bochs-cpu3-owned-oracle/parse.mjs',
  'scripts/prepare-bochs-cpu3-owned-oracle.mjs',
  'scripts/run-bochs-cpu3-owned-oracle.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
const instrumented=process.env.BOCHS_386_INSTRUMENTED_ROOT;
if(!instrumented) throw new Error('Set BOCHS_386_INSTRUMENTED_ROOT to the separately prepared and built CPU3 source');
const bochsRoot=resolve(instrumented);
if(git(bochsRoot,['rev-parse','HEAD'])!==revision) throw new Error('unexpected Bochs revision');
const altered=git(bochsRoot,['diff','--name-only','HEAD','--']);
if(altered!=='bochs/instrument/stubs/instrument.cc')
  throw new Error(`Bochs source must differ only at the owned instrumentation body: ${altered}`);
const probe=resolve(repo,'scripts/bochs-cpu3-owned-oracle/instrument.cc');
const body=resolve(bochsRoot,'bochs/instrument/stubs/instrument.cc');
if(sha(probe)!==sha(body)) throw new Error('instrumented Bochs body differs from owned probe');
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

const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-owned-'));
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
      if(!sawEnd && stderr.includes('BW386O1\tEND\tBHVK003\t')){
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
  const checkpoint=parseBochsCpu3OwnedOracle(run.stderr);
  const start=run.stdout.indexOf('BHVK003');
  if(start<0) throw new Error('port E9 stdout marker absent');
  const bochsLog=readFileSync(log,'utf8');
  if(!bochsLog.includes('Booting from 0000:7c00') || bochsLog.includes('>>PANIC<<'))
    throw new Error('owned Bochs boot did not reach fixture cleanly');
  assertCommittedBoardSources();
  if(paths.some(path=>sha(resolve(repo,path))!==sourceHashes[path]))
    throw new Error('board source changed during native capture');
  const report={schema:'bw.bochs-cpu3-owned-native-capture.v1',status:'native-capture-complete',
    comparison:'not-run',boardRevision,sourceHashes,bochsRevision:revision,
    bochsConfigSha256:sha(config),bochsExecutableSha256:sha(bochs),
    bochsStubHeaderSha256:sha(resolve(bochsRoot,'bochs/instrument/stubs/instrument.h')),
    bochsProbeSha256:sha(body),biosSha256:sha(bios),vgaBiosSha256:sha(vga),
    imageSha256:hash(binary),floppySha256:hash(floppy),
    marker:run.stdout.slice(start,start+7),bochsExit:{code:run.code,signal:run.signal},
    checkpoint};
  console.log(JSON.stringify(report,null,2));
} finally {rmSync(build,{recursive:true,force:true});}
