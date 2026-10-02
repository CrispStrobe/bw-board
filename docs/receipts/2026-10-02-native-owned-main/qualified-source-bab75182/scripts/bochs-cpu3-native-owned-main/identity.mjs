import {authenticateBuild as authenticateCompiled}from '../bochs-cpu3-native-owned-clock/identity.mjs';
/** Frozen source/build provenance admission; does not build or run anything. */
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveOwnedRuntime} from '../bochs-cpu3-native-owned-clock/runtime.mjs';
import {deriveOwnedNapi} from '../bochs-cpu3-native-owned-clock/napi.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const ownedAssets=['abi.h','clock.inc','derive.mjs','runtime.mjs','napi.mjs','provider.mjs','loader.mjs','factory.mjs','worker.mjs','identity.mjs','contract.md'].map(p=>'scripts/bochs-cpu3-native-owned-clock/'+p).concat(['scripts/run-i80386-native-owned-clock.mjs','scripts/prepare-bochs-cpu3-native-owned-clock.mjs','test/i80386-native-owned-clock.test.mjs','test/i80386-native-owned-clock-c-harness.test.mjs','test/fixtures/i80386-owned-clock-harness.cc','scripts/bochs-cpu3-native-direct-board/runtime.inc','scripts/bochs-cpu3-native-direct-board/runtime.h','scripts/bochs-cpu3-native-direct-board/addon.mk','scripts/prepare-bochs-cpu3-native-hot-direct.mjs','scripts/prepare-bochs-cpu3-native-direct-board.mjs','test/i80386-native-direct-board.test.mjs','test/i80386-native-hot-direct.test.mjs','test/fixtures/i80386-free-combined-paging-ram.S','scripts/bochs-cpu3-native-direct-board/abi.h','scripts/bochs-cpu3-native-direct-board-adapter/napi.cc','test/fixtures/i80386-free-combined-hot.S','package.json']);
export function sourceIdentity(){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32<<20}).trim();assert.equal(git(['status','--porcelain']),'','frozen clean source');const revision=git(['rev-parse','HEAD']),paths=new Set();
 function visit(p){if(paths.has(p))return;paths.add(p);const b=readFileSync(resolve(root,p));assert.equal(sha256(b),sha256(execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32<<20})),p);if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));}
 for(const p of [...ownedAssets,'scripts/run-i80386-native-owned-main.mjs','scripts/bochs-cpu3-native-owned-main/bootstrap.mjs','scripts/bochs-cpu3-native-owned-main/identity.mjs','test/i80386-native-owned-main.test.mjs','test/fixtures/i80386-owned-main-scheduler.json','scripts/bochs-cpu3-native-owned-main/admission.mjs','scripts/bochs-cpu3-native-owned-main/contract.md','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha256(readFileSync(resolve(root,p)))]))};
}
export function boundedJson(path,expectedSha){assert.equal(typeof path,'string');assert.match(expectedSha,/^[a-f0-9]{64}$/);const st=statSync(path);assert.ok(st.isFile()&&st.size<=16*1024*1024);const b=readFileSync(path);assert.equal(sha256(b),expectedSha);return JSON.parse(b);}
export function authenticateBuild(input,source){
 assert.equal(input.preparedManifestSha256,'7092cf5efdb3d68b65e2b4b8a91f726ae07516e8df0de4712eeb8c92c7369c28');assert.equal(input.buildReceiptSha256,'acebb536e93e6e74218057f18ae1e5a47d8f436e7aee212c0d82b8658d4e3da8');
 const receipt=boundedJson(input.buildReceipt,input.buildReceiptSha256);assert.equal(receipt.sourceRevision,'7df84bc2c367aff1cadec7cecdde69cf0e904ace');assert.equal(Object.keys(receipt.sourceHashes).length,86);for(const [p,h]of Object.entries(receipt.sourceHashes))assert.equal(source.hashes[p],h,'compiled86 untouched '+p);
 const compiled={revision:receipt.sourceRevision,hashes:receipt.sourceHashes};return {compiledSource:compiled,...authenticateCompiled(input,compiled),runtimeJS:source};
}
