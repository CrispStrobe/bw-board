/** Explicit bounded actual CPU3 fixture. Requires separately supplied local addons and Bochs config. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,isAbsolute} from 'node:path';
import {createOwnedRamColdBiosProvider} from './provider.mjs';
import {createOwnedMemoryFusionLedgerScalarProvider} from '../bochs-cpu3-native-cold-memory-fusion-ledger-scalars/factory.mjs';
import {memoryFusionCallbacks} from '../bochs-cpu3-native-cold-memory-fusion-ledger-scalars/provider.mjs';

const [mode,addonPath,ownerPath,configPath,targetText,outputPath]=process.argv.slice(2);
assert.ok(mode==='owned'||mode==='callback');
for(const p of [addonPath,configPath,outputPath])assert.ok(isAbsolute(p)&&resolve(p)===p);
if(mode==='owned')assert.ok(isAbsolute(ownerPath)&&resolve(ownerPath)===ownerPath);
else assert.equal(ownerPath,'-');
const target=Number(targetText);assert.ok(Number.isInteger(target)&&target>=1&&target<=300);
const require=createRequire(import.meta.url);
const addon=require(addonPath);
assert.equal(addon.abiVersion,4);
assert.equal(addon.memoryFusionProfile,'bw.cold-native.memory-clock-fusion.v1');
const provider=mode==='owned'?createOwnedRamColdBiosProvider(require(ownerPath)):createOwnedMemoryFusionLedgerScalarProvider();
const callbacks=mode==='owned'?memoryFusionCallbacks(provider).callbacks:provider.callbacks;
let native=addon.create(configPath,provider.rom,callbacks,false);
const reset={native,board:provider.checkpoint()};
let q=0,resumes=0,zero=0;
while(q<target){
 assert.ok(++resumes<=1200&&zero<=400,'bounded cold guest fixture');
 const stage=provider.stage();if(stage.changed)native=addon.setIRQ(stage.asserted);
 provider.begin();let error=null;
 try{native=addon.resume(1,1,0xffffffffffffffffn);}catch(e){error=e;throw e;}finally{try{provider.end();}catch(e){if(!error)throw e;}}
 const next=Number(native.successfulQuanta);assert.ok(next===q||next===q+1,'contiguous guest Q');
 if(next===q)zero++;q=next;
}
const last=native,final=addon.inspect(),settled=provider.settleCheckpoint(),ports=provider.records();
const report={schema:'bw.cold-native.owned-ram-actual-fixture.v1',mode,target,resumes,zero,reset,last,final,board:settled.state,ramSha256:settled.ramSha256,ports};
addon.close();provider.close();
writeFileSync(outputPath,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():ArrayBuffer.isView(v)?Array.from(v):v)+'\n',{flag:'wx'});
