// Fixed source materializer proposal only; no compiler/addon invocation.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const own=new URL('./',import.meta.url),repo=new URL('../../',own);
const c=JSON.parse(readFileSync(new URL('contract.json',own),'utf8'));
if(c.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_SOURCE_PREPARATION')throw Error('PENDING source preparation; no directory/import/tool effect');
const context=JSON.parse(readFileSync(new URL('candidate-source-context.json',own),'utf8'));
if(context.revision!==c.candidateRevision)throw Error('owned candidate revision mismatch');
const hash=b=>createHash('sha256').update(b).digest('hex');
const env={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
for(const [path,sha] of Object.entries(context.hashes)){
 const actual=readFileSync(new URL(path,repo)),git=execFileSync('/usr/bin/git',['-c','safe.directory='+repo.pathname,'-C',repo.pathname,'show',context.revision+':'+path],{env,timeout:5000,maxBuffer:1<<20});
 if(hash(actual)!==sha||hash(git)!==sha)throw Error('candidate current/Git mismatch '+path);
}
for(const [path,sha] of Object.entries(context.nodeHeaderFiles))if(hash(readFileSync(path))!==sha)throw Error('owned Node header mismatch');
const {derivePropertyKeyNapi}=await import('../bochs-cpu3-native-property-key-cache/napi.mjs');
const s=derivePropertyKeyNapi().bytes.toString(),start=s.indexOf('// Private keys only:'),end=s.indexOf('\nbool u32(',start);
if(start<0||end<=start)throw Error('fixed helper bounds');const helper=s.slice(start,end);
if(hash(helper)!==context.expectedHelperSha256)throw Error('fixed generated helper mismatch');
const out=new URL('./owned-build/',own);mkdirSync(out); // exclusive
const include=new URL('include/node/',out);mkdirSync(include,{recursive:true});
for(const [path,sha] of Object.entries(context.nodeHeaderFiles)){const bytes=readFileSync(path);if(hash(bytes)!==sha)throw Error('header changed before copy');const name=path.slice(path.lastIndexOf('/')+1);if(!['node_api.h','node_api_types.h','js_native_api.h','js_native_api_types.h'].includes(name))throw Error('fixed header name');writeFileSync(new URL(name,include),bytes,{flag:'wx'});}
writeFileSync(new URL('generated-helper.inc',out),helper,{flag:'wx'});
writeFileSync(new URL('fixture.cc',out),readFileSync(new URL('fixture.cc',own)),{flag:'wx'});
writeFileSync(new URL('source-receipt.json',out),JSON.stringify({schema:'bw.property-key.fixture-source.v1',candidateRevision:context.revision,helperSha256:hash(helper),fixtureSha256:hash(readFileSync(new URL('fixture.cc',own))),scope:'source only; no compile/addon execution'})+'\n',{flag:'wx'});
