/** Authenticated source-only materialization; it never loads an addon or runs a guest. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,relative,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deriveEmptyBatchProvider,heldProviderSha256} from './provider-derivation.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const qualifiedHead='acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1';
const heldFixtureSha256='a70b5713bcef7f734d93fb46fb81a13837e09ae74b5b61f16eb1a570b509e014';
const heldComparatorSha256='ab8733188f52239f93cb699306566a15ae4892ccb33e4bc18270fe62713851c7';
const prefix='scripts/bochs-cpu3-native-cold-direct-ram-empty/';
const fixturePath='scripts/bochs-cpu3-native-cold-direct-ram/actual-fixture.mjs';
const providerPath='scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs';
const comparatorPath='scripts/bochs-cpu3-native-cold-direct-ram/compare-fixtures.mjs';
const heldProviderImport="import {createDirectRamColdBiosProvider} from './provider.mjs';";
const heldIdentityImport="import {authenticateConfiguration} from '../bochs-cpu3-native-cold-memory-fusion/identity.mjs';";
const staticallyImported=/\b(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g;

function head(root){return execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}
function tracked(root,path,expected){
 const full=join(root,path),stat=lstatSync(full);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'ordinary source: '+path);
 assert.equal(realpathSync(full),full,'canonical source: '+path);
 const bytes=readFileSync(full);
 assert.equal(bytes.toString('hex'),execFileSync('git',['-C',root,'show','HEAD:'+path]).toString('hex'),'tracked source: '+path);
 const digest=sha256(bytes);
 if(expected)assert.equal(digest,expected,'pinned source: '+path);
 return digest;
}
function closedImports(root,first){
 const closure={},queue=[...first];
 while(queue.length){
  const path=queue.pop();if(Object.hasOwn(closure,path))continue;
  closure[path]=tracked(root,path);
  if(!/\.[cm]?js$/.test(path))continue;
  const body=readFileSync(join(root,path),'utf8');
  for(const [,specifier]of body.matchAll(staticallyImported)){
   const next=relative(root,resolve(dirname(join(root,path)),specifier));
   assert.ok(next&&!next.startsWith('..')&&!isAbsolute(next),'qualified import stays in checkout');
   queue.push(next);
  }
 }
 return Object.fromEntries(Object.entries(closure).sort(([a],[b])=>a.localeCompare(b)));
}
export function deriveActualFixture(harnessRoot,qualifiedRoot){
 const held=readFileSync(join(qualifiedRoot,fixturePath),'utf8');
 assert.equal(sha256(held),heldFixtureSha256,'exact held actual fixture');
 assert.equal(held.split(heldProviderImport).length,2,'one held provider import');
 assert.equal(held.split(heldIdentityImport).length,2,'one held identity import');
 const providerUrl=pathToFileURL(join(qualifiedRoot,providerPath));
 const derivative=deriveEmptyBatchProvider(providerUrl);
 const derivativeUrl=pathToFileURL(join(harnessRoot,prefix+'provider-derivation.mjs')).href;
 const identityUrl=pathToFileURL(join(qualifiedRoot,'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs')).href;
 const providerStatement=`import {deriveEmptyBatchProvider} from '${derivativeUrl}';\n`+
  `const {createDirectRamColdBiosProvider}=await import(deriveEmptyBatchProvider(new URL(${JSON.stringify(providerUrl.href)})).moduleUrl);`;
 const identityStatement=`import {authenticateConfiguration} from '${identityUrl}';`;
 const generated=held.replace(heldProviderImport,providerStatement).replace(heldIdentityImport,identityStatement);
 assert.equal(generated.replace(providerStatement,heldProviderImport).replace(identityStatement,heldIdentityImport),held,'exact fixture inverse');
 return {generated,generatedSha256:sha256(generated),heldFixtureSha256,
  provider:{heldSha256:derivative.heldSha256,normalizedSha256:derivative.normalizedSha256,
   loadedSha256:derivative.loadedSha256,qualifiedUrl:providerUrl.href}};
}

export function sourceIdentity(harnessRoot,qualifiedRoot,expectedHarnessHead){
 for(const root of [harnessRoot,qualifiedRoot]){
  assert.ok(isAbsolute(root)&&resolve(root)===root&&realpathSync(root)===root,'canonical checkout root');
  assert.equal(execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim(),'','clean checkout');
 }
 assert.equal(head(harnessRoot),expectedHarnessHead,'exact harness head');
 assert.equal(head(qualifiedRoot),qualifiedHead,'exact qualified head');
 assert.equal(tracked(qualifiedRoot,providerPath,heldProviderSha256),heldProviderSha256);
 assert.equal(tracked(qualifiedRoot,fixturePath,heldFixtureSha256),heldFixtureSha256);
 assert.equal(tracked(qualifiedRoot,comparatorPath,heldComparatorSha256),heldComparatorSha256);
 const harnessFiles=execFileSync('git',['-C',harnessRoot,'ls-files','-z','--',prefix,'.github/workflows/i80386-cold-direct-ram-empty-actual.yml',
  'scripts/cold-direct-ram-paired/configuration.mjs']).toString().split('\0').filter(Boolean).sort();
 assert.ok(harnessFiles.includes(prefix+'provider-derivation.mjs')&&harnessFiles.includes(prefix+'actual-materialize.mjs')&&
  harnessFiles.includes('.github/workflows/i80386-cold-direct-ram-empty-actual.yml'),'complete declared harness roles');
 const harnessHashes=Object.fromEntries(harnessFiles.map(path=>[path,tracked(harnessRoot,path)]));
 const qualifiedHashes=closedImports(qualifiedRoot,[fixturePath,providerPath,comparatorPath,
  'roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin',
  'roms/free-at-bios/LICENSE','roms/free-at-bios/README.md']);
 assert.equal(qualifiedHashes[providerPath],heldProviderSha256);
 assert.equal(qualifiedHashes[fixturePath],heldFixtureSha256);
 const derived=deriveActualFixture(harnessRoot,qualifiedRoot);
 const manifest={schema:'bw.cold-direct-ram.empty-actual-source.v1',harnessHead:expectedHarnessHead,qualifiedHead,
  harnessHashes,qualifiedHashes,heldComparatorSha256,heldFixtureSha256,
  generatedFixtureSha256:derived.generatedSha256,provider:derived.provider};
 return {manifest,generated:derived.generated};
}

export function materialize(harnessRoot,qualifiedRoot,outputDir,expectedHarnessHead){
 const {manifest,generated}=sourceIdentity(harnessRoot,qualifiedRoot,expectedHarnessHead);
 assert.ok(isAbsolute(outputDir)&&resolve(outputDir)===outputDir,'absolute output');
 const actualPath=join(outputDir,'actual-empty.mjs');
 writeFileSync(actualPath,generated,{flag:'wx',mode:0o644});
 writeFileSync(join(outputDir,'empty-source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o644});
 return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,6,'harness root, qualified root, output dir, expected harness head');
 const result=materialize(...process.argv.slice(2));
 process.stdout.write(JSON.stringify({schema:result.schema,harnessHead:result.harnessHead,
  qualifiedHead:result.qualifiedHead,generatedFixtureSha256:result.generatedFixtureSha256,
  qualifiedRoles:Object.keys(result.qualifiedHashes).length,harnessRoles:Object.keys(result.harnessHashes).length})+'\n');
}
