// Fixed source materializer proposal only; no compiler/addon invocation.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const own=new URL('./',import.meta.url),repo=new URL('../../',own);
const c=JSON.parse(readFileSync(new URL('contract.json',own),'utf8'));
if(c.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_SOURCE_PREPARATION')throw Error('PENDING source preparation; no directory/import/tool effect');
const context=JSON.parse(readFileSync(new URL('candidate-source-context.json',own),'utf8'));
const authority=JSON.parse(readFileSync(new URL('source-preparation-authority.json',own),'utf8'));
const ORIGINAL='/tmp/bw-property-key-real-napi-qualification-source-20261005';
if(authority.schema!=='bw.property-key.fixed-build-input.v1'||authority.originalRoot!==ORIGINAL||context.revision!==c.candidateRevision)throw Error('fixed source preparation authority');
const hash=b=>createHash('sha256').update(b).digest('hex');
const env={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
const originalRoot=new URL('file://'+ORIGINAL+'/');
const OWN_FILES=["scripts/property-key-real-napi-qualification/SOURCE.md", "scripts/property-key-real-napi-qualification/auth.mjs", "scripts/property-key-real-napi-qualification/build-proposal.json", "scripts/property-key-real-napi-qualification/candidate-source-context.json", "scripts/property-key-real-napi-qualification/contract.json", "scripts/property-key-real-napi-qualification/env-worker.mjs", "scripts/property-key-real-napi-qualification/fixture.cc", "scripts/property-key-real-napi-qualification/prepare.mjs", "scripts/property-key-real-napi-qualification/provenance/header-audit.json", "scripts/property-key-real-napi-qualification/provenance/official-SHASUMS256.txt", "scripts/property-key-real-napi-qualification/provenance/primary-source-index.json", "scripts/property-key-real-napi-qualification/qualify.mjs"];
if(JSON.stringify(Object.keys(authority.sourceFiles).sort())!==JSON.stringify([...OWN_FILES,...Object.keys(context.hashes)].sort()))throw Error('complete fixed source copy inventory required');
if(process.versions.node!==c.nodeVersion||hash(readFileSync(process.execPath))!==c.nodeSha256)throw Error('source preparation actual Node identity');
const originalContract=JSON.parse(readFileSync(new URL('scripts/property-key-real-napi-qualification/contract.json',originalRoot),'utf8'));
const admitted={...originalContract,status:'ROOT_REVIEWED_REAL_NAPI_FIXTURE_SOURCE_PREPARATION'};
if(JSON.stringify(c)!==JSON.stringify(admitted)||originalContract.status!=='PENDING_ROOT_REVIEWED_HELPER_LIFECYCLE_AND_BUILD')throw Error('only copied source-preparation status admission allowed');
if(execFileSync('/usr/bin/git',['-c','safe.directory='+ORIGINAL,'-C',ORIGINAL,'rev-parse','HEAD'],{env,timeout:5000}).toString().trim()!==authority.originalRevision)throw Error('fixed original head');
for(const [path,sha] of Object.entries(authority.sourceFiles)){
 const original=readFileSync(new URL(path,originalRoot)),git=execFileSync('/usr/bin/git',['-c','safe.directory='+ORIGINAL,'-C',ORIGINAL,'show',authority.originalRevision+':'+path],{env,timeout:5000,maxBuffer:1<<20});
 if(hash(original)!==sha||hash(git)!==sha)throw Error('original source current/Git mismatch '+path);
 const copy=readFileSync(new URL(path,repo));
 if(path==='scripts/property-key-real-napi-qualification/contract.json'){if(hash(copy)!==authority.admittedContractSha256)throw Error('copied admitted contract hash');}
 else if(hash(copy)!==sha)throw Error('immutable source copy mismatch '+path);
}
for(const [path,sha] of Object.entries(context.hashes))if(hash(readFileSync(new URL(path,repo)))!==sha||authority.sourceFiles[path]!==sha)throw Error('candidate copied map mismatch');
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
