/** Failure-only host fixture evidence; never changes the caller's verdict. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {accessSync,constants,copyFileSync,existsSync,mkdirSync,mkdtempSync,
  readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Diagnostic errors (including unavailable tools/storage) must not mask the
// original hard image-hash failure. The check is executed exactly once.
export function withFixtureFailureDiagnostics(details,check,options={}){
  try{return check();}
  catch(error){
    try{retain(details,options);}catch{/* Preserve the original assertion/error. */}
    throw error;
  }
}

function retain({id,build,source,expectedImageSha256,commands},
  {env=process.env,run=execFileSync}={}){
  if(!/^[a-z0-9-]+$/.test(id))throw new Error('invalid fixture diagnostic id');
  const root=env.BW_X86_FIXTURE_DIAGNOSTICS || join(tmpdir(),'bw-x86-fixture-failures');
  mkdirSync(root,{recursive:true});
  const output=mkdtempSync(join(root,`${id}-`));
  const report={schema:'bw.x86-fixture-failure.v1',id,
    expectedImageSha256,commands,files:{},tools:{},diagnostics:[],diagnosticCommands:[],
    authority:'failure diagnostics only; no new oracle or qualification',
    environment:Object.fromEntries(['PATH','LANG','LC_ALL','LC_CTYPE',
      'SOURCE_DATE_EPOCH','GNUTARGET','LDEMULATION','LD_LIBRARY_PATH']
      .map(key=>[key,env[key]??null]))};
  const save=()=>writeFileSync(join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
  save();
  const attempt=(label,fn)=>{
    try{return fn();}catch(error){
      report.diagnostics.push({label,error:String(error.message)});save();return null;
    }
  };
  // Explicit small-file allowlist, not a recursive copy of the build directory.
  for(const [name,path] of [['fixture.S',source],
    ...['guest.o','guest.elf','guest.bin'].map(name=>[name,join(build,name)])]){
    if(!existsSync(path))continue;
    attempt(name,()=>{
      if(statSync(path).size>2*1024*1024)throw new Error('fixture diagnostic file exceeds 2 MiB');
      copyFileSync(path,join(output,name));
      const bytes=readFileSync(join(output,name));
      report.files[name]={bytes:bytes.length,sha256:hash(bytes)};
    });
  }
  report.actualImageSha256=report.files['guest.bin']?.sha256??null;
  save();
  const capture=(tool,args,label)=>attempt(label,()=>{
    const command={argv:[tool,...args]};report.diagnosticCommands.push(command);
    try{
      const stdout=run(tool,args,{env,timeout:5000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
      writeFileSync(join(output,`${label}.txt`),stdout);command.exitCode=0;
    }catch(error){
      command.exitCode=error.status??null;
      command.error=String(error.message);
      if(error.stdout)writeFileSync(join(output,`${label}.txt`),error.stdout);
      if(error.stderr)writeFileSync(join(output,`${label}.stderr`),error.stderr);
      throw error;
    }
  });
  for(const name of ['as','ld','objcopy','objdump','readelf']){
    attempt(name,()=>{
      const path=(env.PATH||'').split(delimiter).map(dir=>join(dir,name)).find(path=>{
        try{accessSync(path,constants.X_OK);return true;}catch{return false;}
      });
      if(!path)throw new Error(`tool not found: ${name}`);
      const resolved=realpathSync(path);
      report.tools[name]={path,resolved,sha256:hash(readFileSync(resolved)),
        observedAt:'failure retention; not a historical toolchain receipt'};
      capture(path,['--version'],`${name}-version`);
    });
  }
  const disassemble=report.tools.objdump?.path;
  const readelf=report.tools.readelf?.path;
  for(const name of ['guest.o','guest.elf']){
    if(!report.files[name])continue;
    if(disassemble)capture(disassemble,['-drw','-Mintel,i8086',join(output,name)],`${name}-disassembly`);
    if(readelf)capture(readelf,['-aW',join(output,name)],`${name}-elf`);
  }
  if(report.files['guest.bin']){
    if(disassemble)capture(disassemble,['-D','-b','binary','-m','i386','-Mintel,i8086',
      '--adjust-vma=0x7c00',join(output,'guest.bin')],'image-disassembly');
    const bytes=readFileSync(join(output,'guest.bin'));
    writeFileSync(join(output,'image-offset-bytes.txt'),Array.from(
      {length:Math.ceil(bytes.length/16)},(_,i)=>`${(i*16).toString(16).padStart(8,'0')}: `+
      [...bytes.subarray(i*16,i*16+16)].map(x=>x.toString(16).padStart(2,'0')).join(' ')
    ).join('\n')+'\n');
  }
  save();
}
