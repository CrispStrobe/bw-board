import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=new URL('../docs/receipts/2026-10-03-wasm-edge-callee-inspection/',import.meta.url);
const bytes=path=>readFileSync(new URL(path,root));
const json=path=>JSON.parse(bytes(path));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const wasm='7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d';
test('all static originals, logs and exact sources are hash-bound',()=>{
    const manifest=json('manifest.json');
    assert.equal(manifest.diagnosticOnly,true);assert.equal(manifest.hostedOnly,true);assert.equal(manifest.engineModified,false);
    assert.equal(new Set(manifest.files.map(f=>f.path)).size,manifest.files.length);
    for(const file of manifest.files){const raw=bytes(file.path);assert.equal(raw.length,file.bytes);assert.equal(hash(raw),file.sha256,file.path);}
    const sources=json('source-proof.json');assert.equal(sources.coreCommit,core);assert.equal(sources.files.length,4);
    for(const file of sources.files){const raw=Buffer.from(file.content);assert.equal(raw.length,file.bytes);assert.equal(hash(raw),file.sha256);}
    for(const label of ['initial','types','static','failure']){const log=json(label+'-job-log.json');const raw=gunzipSync(Buffer.from(log.gzipBase64,'base64'));assert.equal(raw.length,log.bytes);assert.equal(hash(raw),log.sha256);assert.equal(log.scope,'complete gh run --log output');}
});
test('exact original module and corrected hosted inspection retain distinct provenance',()=>{
    const datasets=[['initial',37115219824,'5f89d76f47d362403dcb4fe5470eae673db50641'],['types',37115264554,'3c4ddab38406676c21750b4315b5badf2c3710cd'],['static',37115675629,'8764ff688929fbababe03e3c026922977b69d747']];
    for(const [label,run,head] of datasets){const r=json(label+'/selected-callees.json'),metadata=json(label+'-run.json'),build=json(label+'/build-info.json');assert.equal(r.diagnosticOnly,true);assert.equal(r.coreCommit,core);assert.equal(r.wasmSha256,wasm);assert.equal(r.buildRun,'36915940413');assert.equal(r.toolCommit,head);assert.equal(metadata.databaseId,run);assert.equal(metadata.headSha,head);assert.equal(metadata.conclusion,'success');assert.equal(build.ref,core);assert.equal(build.targets.nodejs['labwired_wasm_bg.wasm'].sha256,wasm);assert.equal(build.targets.nodejs['labwired_wasm.js'].sha256,'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73');assert.equal(r.fullWat.bytes,201474404);assert.equal(r.fullWat.sha256,'a36ad9ffcd857f4905e875afce3f1bade2c21b581de519f71f659293b77f508d');}
});
test('compiled cold callers and typed Button table resolve the empty-slice alias independently',()=>{
    const r=json('static/selected-callees.json');
    const cold=r.functions.find(f=>f.header.includes('service_edge_driven_gpio_devices_cold'));
    assert.equal((cold.wat.match(/i32.load offset=48\n\s+call_indirect \(type 16\)/g)||[]).length,2);
    assert(cold.wat.includes('i32.load offset=52\n'));assert(r.types.includes('  (type (;16;) (func (param i32 i32)))'));
    const entries=r.elements[0].match(/\(i32.const (\d+)\) func (.*)\)$/);
    const table=new Map(entries[2].split(/\s+/).map((name,i)=>[Number(entries[1])+i,name]));
    const v=r.vtableCandidates.find(v=>v.address===17082440);assert(v);
    assert.deepEqual(v.words,[7563,40,8,7700,7701,7702,7703,7704,7705,7706,7567,7705,7707,7708]);
    for(const slot of v.slots)if(slot.offset!==4&&slot.offset!==8)assert.equal(slot.symbol,table.get(slot.value)||null);
    assert(v.slots[0].symbol.includes('drop_in_place<labwired_core::peripherals::components::button::Button>'));
    assert(v.slots[3].symbol.includes('Button_as_core::fmt::Debug'));
    assert(v.slots[4].symbol.includes('Button_as_labwired_core::bus::resident_device::BusResidentDevice>::service'));
    assert.equal(table.get(7707),r.emptyName);assert.deepEqual(r.emptyIndices,[7707]);
    assert(r.emptyName.includes('DeclarativeLogicDevice')&&r.emptyName.includes('input_channels'));
    const empty=r.functions.find(f=>f.header.startsWith('  (func '+r.emptyName+' '));
    assert.deepEqual(empty.wat.split('\n').slice(1).map(line=>line.trim()),['local.get 0','i64.const 8','i64.store)']);
    assert(v.slots[13].symbol.includes('BusResidentDevice::service_edge'));
    const files=json('source-proof.json').files;
    const resident=files.find(f=>f.path.endsWith('resident_device.rs')).content;
    assert.match(resident,/fn edge_service_addrs\(&self\) -> &\[u64\] \{\s*&\[\]\s*\}/);
    const button=files.find(f=>f.path.endsWith('/button.rs')).content;assert(!button.includes('fn edge_service_addrs'));
    const hooks=files.find(f=>f.path.endsWith('device_hooks.rs')).content;assert(hooks.includes('.any(|d| !d.edge_service_addrs().is_empty())'));
});
test('failed inspection remains lossless and tooling merge is exact-head check gated',()=>{
    const failure=json('failure-run.json');assert.equal(failure.databaseId,37115414464);assert.equal(failure.headSha,'29372ec7195f671c5dd5a2d28fc487edaa5bb06d');assert.equal(failure.conclusion,'failure');
    const log=json('static-failure.json'),raw=gunzipSync(Buffer.from(log.gzipBase64,'base64'));assert.equal(raw.length,log.bytes);assert.equal(hash(raw),log.sha256);assert(raw.includes('Unsupported active data format'));
    const landing=json('tool-landing.json');assert.equal(landing.engineMerge,false);assert.equal(landing.physicalAcknowledgementChanges,false);assert.equal(landing.head,'8764ff688929fbababe03e3c026922977b69d747');assert.equal(landing.before.headRefOid,landing.head);assert.equal(landing.after.headRefOid,landing.head);assert.equal(landing.after.state,'MERGED');assert.equal(landing.before.statusCheckRollup.length,13);assert.equal(landing.before.statusCheckRollup.filter(c=>c.conclusion==='SUCCESS').length,11);assert(landing.before.statusCheckRollup.filter(c=>c.conclusion==='SKIPPED').every(c=>c.name==='vectors-full'));
});
