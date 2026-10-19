import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createDirectRamColdBiosProvider} from './provider.mjs';
const [addonPath,scenario='normal']=process.argv.slice(2);
assert.ok(process.argv.length===3||process.argv.length===4);
assert.ok(['normal','source-clock-deny','page-clock','invalid-actual-page'].includes(scenario));
const addon=createRequire(import.meta.url)(resolve(addonPath));
const provider=createDirectRamColdBiosProvider(addon);
if(scenario==='source-clock-deny'){
 assert.throws(()=>addon.create(scenario,provider.rom,provider.callbacks,false),/direct RAM copied observer admission/);
 console.log('direct-RAM source-clock denial before INIT ACK PASS');
 process.exit(0);
}
const reset=addon.create(scenario==='normal'?'real-provider':scenario,provider.rom,provider.callbacks,false);
assert.equal(reset.successfulQuanta,0n);
provider.checkpoint();
if(scenario==='page-clock'||scenario==='invalid-actual-page'){
 provider.stage();provider.begin();
 if(scenario==='invalid-actual-page'){
  assert.throws(()=>addon.resume(1,1,0xffffffffffffffffn));
  const denied=addon.directStatus();
  assert.equal(denied.ownerFailed,true);
  assert.equal(denied.pageTicket,false);
  console.log('direct-RAM malformed actual page denied after PAGE clock flush PASS');
  process.exit(0);
 }
 const progressed=addon.resume(1,1,0xffffffffffffffffn);
 assert.equal(progressed.nativeTicks,1n);assert.equal(progressed.successfulQuanta,1n);
 provider.end();provider.checkpoint();
 const admitted=addon.directStatus();
 assert.equal(admitted.ownerFailed,false);assert.equal(admitted.pageTicket,false);
 assert.equal(admitted.acknowledged,admitted.committed);
}
const status=addon.directStatus();assert.equal(status.ownerFailed,false);assert.equal(status.journalPending,0n);
addon.close();provider.close();
assert.equal(addon.directStatus().ownerClosed,true);
assert.deepEqual(provider.closedStatus(),{providerClosed:true,boardClosed:true});
console.log('direct-RAM actual-provider same-DSO control PASS',scenario);
