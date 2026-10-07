/** Diagnostic-only file loader for the exact authenticated timing provider bytes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, lstatSync, readFileSync, realpathSync, openSync, writeSync, closeSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deriveDirectTimingProvider} from '../cold-direct-ram-paired/direct-provider.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const providerFilename='profiled-direct-provider.mjs';
export function profileProviderPath(profilePath){
 assert.ok(typeof profilePath==='string'&&isAbsolute(profilePath)&&
  resolve(profilePath)===profilePath&&basename(profilePath)==='profile.cpuprofile',
  'exact absolute profile file role');
 const folder=dirname(profilePath);
 assert.ok(lstatSync(folder).isDirectory()&&realpathSync(folder)===folder,
  'ordinary canonical receipt directory');
 return join(folder,providerFilename);
}
export function writeAuthenticatedProvider(profilePath,bytes,digest){
 assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=1024*1024&&
  typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),
  'complete bounded provider role');
 assert.equal(sha(bytes),digest,'exact derived provider hash before file effect');
 const file=profileProviderPath(profilePath);
 const descriptor=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{assert.equal(writeSync(descriptor,bytes),bytes.length,'complete provider write');}
 finally{closeSync(descriptor);}
 assert.ok(lstatSync(file).isFile()&&realpathSync(file)===file,'ordinary provider file');
 assert.equal(sha(readFileSync(file)),digest,'exact loaded file bytes');
 return file;
}
export async function loadDirectTimingProvider(sourceRoot){
 const derived=deriveDirectTimingProvider(sourceRoot);
 const prefix='data:text/javascript;base64,';
 assert.ok(derived.moduleUrl.startsWith(prefix),'exact source format');
 const encoded=derived.moduleUrl.slice(prefix.length),bytes=Buffer.from(encoded,'base64');
 assert.equal(bytes.toString('base64'),encoded,'canonical complete provider bytes');
 const file=writeAuthenticatedProvider(process.env.BW_CPU_PROFILE_PATH,bytes,derived.loadedModuleSha256);
 const module=await import(pathToFileURL(file).href);
 assert.equal(typeof module.createDirectRamColdBiosProvider,'function');
 return {create:module.createDirectRamColdBiosProvider,
  derivation:{qualifiedSha256:derived.qualifiedSha256,derivedSha256:derived.derivedSha256,
   loadedModuleSha256:derived.loadedModuleSha256,dependencySha256:derived.dependencySha256,
   removed:derived.removed}};
}
