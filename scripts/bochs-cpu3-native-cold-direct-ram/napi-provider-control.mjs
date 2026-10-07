import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createDirectRamColdBiosProvider} from './provider.mjs';
const [addonPath,scenario='normal']=process.argv.slice(2);
assert.ok(process.argv.length===3||process.argv.length===4);
assert.ok(scenario==='normal'||scenario==='source-clock-deny');
const addon=createRequire(import.meta.url)(resolve(addonPath));
const provider=createDirectRamColdBiosProvider(addon);
if(scenario==='source-clock-deny'){
 assert.throws(()=>addon.create(scenario,provider.rom,provider.callbacks,false),/direct RAM copied observer admission/);
 console.log('direct-RAM source-clock denial before INIT ACK PASS');
 process.exit(0);
}
const reset=addon.create('real-provider',provider.rom,provider.callbacks,false);
assert.equal(reset.successfulQuanta,0n);
provider.checkpoint();
const status=addon.directStatus();assert.equal(status.ownerFailed,false);assert.equal(status.journalPending,0n);
addon.close();provider.close();
assert.equal(addon.directStatus().ownerClosed,true);
assert.deepEqual(provider.closedStatus(),{providerClosed:true,boardClosed:true});
console.log('direct-RAM actual-provider same-DSO INIT/control PASS');
