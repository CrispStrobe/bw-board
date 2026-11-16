/** Admit the seal-compatible GNU toolchain; record actual executable identities. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {accessSync,constants,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {delimiter,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function inspectFixtureToolchain({env=process.env,run=execFileSync}={}){
  const report={schema:'bw.x86-fixture-toolchain.v1',requiredVersion:'2.42',
    head:env.GITHUB_SHA??null,runnerImage:env.ImageOS??null,
    runnerImageVersion:env.ImageVersion??null,tools:{},errors:[],
    authority:'toolchain admission only; original image seals still required'};
  for(const [name,banner] of [['as','GNU assembler'],['ld','GNU ld'],['objcopy','GNU objcopy']]){
    try{
      const path=(env.PATH||'').split(delimiter).map(dir=>join(dir,name)).find(path=>{
        try{accessSync(path,constants.X_OK);return true;}catch{return false;}
      });
      if(!path)throw new Error(`missing ${name}`);
      const resolved=realpathSync(path),argv=[path,'--version'];
      const tool=report.tools[name]={path,resolved,argv,
        sha256:createHash('sha256').update(readFileSync(resolved)).digest('hex')};
      tool.versionOutput=run(path,['--version'],
        {env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024}).toString();
      tool.versionLine=tool.versionOutput.split(/\r?\n/)[0];
      if(!tool.versionLine.startsWith(`${banner} `)||!tool.versionLine.endsWith(' 2.42'))
        throw new Error(`${name}: expected GNU 2.42, observed ${tool.versionLine}`);
    }catch(error){report.errors.push(String(error.message));}
  }
  report.admitted=report.errors.length===0;
  return report;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.length!==4||process.argv[2]!=='--out')
    throw new Error('usage: node scripts/check-x86-fixture-toolchain.mjs --out FILE');
  const report=inspectFixtureToolchain();
  writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(!report.admitted)process.exitCode=1;
}
