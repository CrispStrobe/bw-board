import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,
  symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {withFixtureFailureDiagnostics} from '../scripts/retain-x86-fixture-failure.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function setup(t,{elf=true}={}){
  const root=mkdtempSync(join(tmpdir(),'bw-fixture-retention-control-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const build=join(root,'build'),tools=join(root,'tools'),output=join(root,'retained');
  mkdirSync(build);mkdirSync(tools);
  for(const name of ['as','ld','objcopy','objdump','readelf'])
    symlinkSync(process.execPath,join(tools,name));
  const source=join(root,'source.S');writeFileSync(source,'.code16\n');
  // Synthetic bytes only. No assembler, guest, historical capture or benchmark.
  for(const name of ['guest.o','guest.bin',...(elf?['guest.elf']:[])])
    writeFileSync(join(build,name),Buffer.from([0x90,0xf4,0x00]));
  const calls=[];
  const options={env:{PATH:tools,BW_X86_FIXTURE_DIAGNOSTICS:output},
    run:(tool,args)=>{calls.push([tool,...args]);return Buffer.from('synthetic diagnostic output\n');}};
  const details={id:'control',build,source,expectedImageSha256:'unchanged-seal',
    commands:[['as','--32','-o',join(build,'guest.o'),source]]};
  const manifest=()=>{
    const dir=join(output,readdirSync(output)[0]);
    return {dir,report:JSON.parse(readFileSync(join(dir,'manifest.json')))};
  };
  return {root,build,output,source,options,details,calls,manifest};
}

test('passing check executes once, returns its value and creates no retention or tool calls',t=>{
  const s=setup(t);let checks=0;
  assert.equal(withFixtureFailureDiagnostics(s.details,()=>{checks++;return 42;},s.options),42);
  assert.equal(checks,1);assert.equal(existsSync(s.output),false);assert.equal(s.calls.length,0);
});

test('mismatch retains exact bytes, source, tool identities, argv and offset/disassembly output',t=>{
  const s=setup(t),failure=new assert.AssertionError({message:'original image seal mismatch'});
  assert.throws(()=>withFixtureFailureDiagnostics(s.details,()=>{throw failure;},s.options),
    error=>error===failure);
  rmSync(s.build,{recursive:true}); // The caller may still do its original cleanup.
  const {dir,report}=s.manifest();
  assert.deepEqual(report.commands,s.details.commands);
  assert.equal(report.expectedImageSha256,'unchanged-seal');
  assert.equal(report.actualImageSha256,hash(Buffer.from([0x90,0xf4,0x00])));
  for(const name of ['fixture.S','guest.o','guest.elf','guest.bin'])
    assert.equal(hash(readFileSync(join(dir,name))),report.files[name].sha256);
  assert.deepEqual(Object.keys(report.tools).sort(),['as','ld','objcopy','objdump','readelf']);
  assert.equal(report.tools.as.sha256,hash(readFileSync(process.execPath)));
  assert.equal(report.diagnosticCommands.length,10);
  assert.match(readFileSync(join(dir,'image-offset-bytes.txt'),'utf8'),/^00000000: 90 f4 00/);
  assert.equal(existsSync(join(dir,'image-disassembly.txt')),true);
});

test('direct-binary pipeline retains its object/image without inventing a linked ELF',t=>{
  const s=setup(t,{elf:false}),failure=new Error('assembled fixture differs from native image');
  assert.throws(()=>withFixtureFailureDiagnostics(s.details,()=>{throw failure;},s.options),e=>e===failure);
  const {report}=s.manifest();
  assert.equal(report.files['guest.elf'],undefined);assert.ok(report.files['guest.o']);
  assert.equal(s.calls.some(argv=>['as','ld','objcopy'].includes(basename(argv[0]))&&argv[1]!=='--version'),false);
});

test('unwritable retention destination never replaces the original assertion',t=>{
  const s=setup(t),failure=new Error('original failure');writeFileSync(s.output,'not a directory');
  assert.throws(()=>withFixtureFailureDiagnostics(s.details,()=>{throw failure;},s.options),e=>e===failure);
});

test('missing diagnostic tools leave raw bytes and explicit gaps without changing failure',t=>{
  const s=setup(t),failure=new Error('original failure');s.options.env.PATH='';
  assert.throws(()=>withFixtureFailureDiagnostics(s.details,()=>{throw failure;},s.options),e=>e===failure);
  const {report}=s.manifest();
  assert.equal(Object.keys(report.tools).length,0);assert.equal(report.diagnostics.length,5);
  assert.ok(report.files['guest.bin']);
});

test('failed disassembly preserves partial stdout/stderr and the original error',t=>{
  const s=setup(t),failure=new Error('original failure');
  s.options.run=(tool,args)=>{
    if(basename(tool)==='objdump'&&args[0]!=='--version'){
      throw Object.assign(new Error('diagnostic refused'),{status:2,
        stdout:Buffer.from('partial'),stderr:Buffer.from('tool refusal')});
    }
    return Buffer.from('synthetic version');
  };
  assert.throws(()=>withFixtureFailureDiagnostics(s.details,()=>{throw failure;},s.options),e=>e===failure);
  const {dir,report}=s.manifest();
  assert.ok(report.diagnostics.some(x=>x.error==='diagnostic refused'));
  assert.equal(readFileSync(join(dir,'image-disassembly.stderr'),'utf8'),'tool refusal');
  assert.equal(report.diagnosticCommands.at(-1).exitCode,2);
});

test('uncaught original assertion still exits nonzero even when diagnostics cannot be written',t=>{
  const s=setup(t);writeFileSync(s.output,'not a directory');
  const program=`import assert from 'node:assert/strict';
    import {withFixtureFailureDiagnostics as retain} from ${JSON.stringify(new URL('../scripts/retain-x86-fixture-failure.mjs',import.meta.url).href)};
    retain(${JSON.stringify(s.details)},()=>assert.equal('actual','sealed'),
      {env:{PATH:'',BW_X86_FIXTURE_DIAGNOSTICS:${JSON.stringify(s.output)}}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:5000});
  assert.equal(child.status,1);assert.match(child.stderr,/AssertionError/);
  assert.match(child.stderr,/actual/);assert.match(child.stderr,/sealed/);
});

test('actual Win16 setup retains mismatch before finally cleanup; no CPU or GNU pipeline runs',t=>{
  const s=setup(t);
  const url=new URL('./i80386-code16-owned-io-trace.test.mjs',import.meta.url);
  const prelude=readFileSync(url,'utf8').split('\nfunction fixture(')[0]
    .replace(/^import[\s\S]*?;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));
  const stages=[];
  assert.throws(()=>runInNewContext(prelude,{assert,URL,createHash,join,mkdtempSync,readFileSync,rmSync,
    tmpdir:()=>s.root,execFileSync:(tool,args,options)=>{
      if(tool==='git')return execFileSync(tool,args,options);
      stages.push(tool);
      writeFileSync(tool==='objcopy'?args.at(-1):args[args.indexOf('-o')+1],Buffer.from([0x90]));
      return Buffer.alloc(0);
    },withFixtureFailureDiagnostics:(details,check)=>withFixtureFailureDiagnostics(details,check,s.options)}),
  error=>error.code==='ERR_ASSERTION');
  assert.deepEqual(stages,['as','ld','objcopy']);
  assert.equal(s.manifest().report.actualImageSha256,hash(Buffer.from([0x90])));
  assert.equal(readdirSync(s.root).some(name=>name.startsWith('bw-owned-io-trace-test-')),false);
});

test('actual VM-task hash refusal retains before original cleanup and before CPU construction',t=>{
  const s=setup(t,{elf:false});
  const source=readFileSync(new URL('../scripts/compare-bochs-cpu3-owned-integer-state.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    const object=join(build,'),source.indexOf('    const memory=new Uint8Array'));
  assert.ok(body.includes('withFixtureFailureDiagnostics'));
  const stages=[];
  assert.throws(()=>runInNewContext(`try{${body}}finally{rmSync(build,{recursive:true,force:true});}`,{
    build:s.build,repo:s.root,fixturePath:'source.S',join,resolve:join,readFileSync,rmSync,sha256:hash,
    nativeReceipt:{imageSha256:'original-seal'},execFileSync:(tool,args)=>{
      stages.push(tool);writeFileSync(args[args.indexOf('-o')+1],Buffer.from([0x90]));
    },withFixtureFailureDiagnostics:(details,check)=>withFixtureFailureDiagnostics(details,check,s.options)}),
  /assembled fixture differs from native image/);
  assert.deepEqual(stages,['as','ld']);assert.equal(existsSync(s.build),false);
  assert.equal(s.manifest().report.expectedImageSha256,'original-seal');
});

test('ordinary diagnostic upload keeps original failure condition and includes retained fixture directory',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.match(workflow,/if: \$\{\{ always\(\) && steps\.ordinary_tests\.outcome != 'skipped' \}\}/);
  assert.match(workflow,/BW_X86_FIXTURE_DIAGNOSTICS: \$\{\{ runner\.temp \}\}\/bw-x86-fixture-failures/);
  assert.match(workflow,/path: \|\n\s+\$\{\{ runner\.temp \}\}\/bw-board-ci-test\.log\n\s+\$\{\{ runner\.temp \}\}\/bw-x86-fixture-failures/);
});
