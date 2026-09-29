import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const repo=new URL('../',import.meta.url);
const script=fileURLToPath(new URL('../scripts/compare-qemu-i80386-es-cache-witness.mjs',import.meta.url));
const receipt=JSON.parse(readFileSync(new URL('../docs/receipts/2026-09-29-i80386-es-cache-witness.json',import.meta.url)));
const sha=data=>createHash('sha256').update(data).digest('hex');
const qemu='/usr/bin/qemu-system-i386';
let available=false;
try{available=sha(readFileSync(qemu))===receipt.reference.qemuSha256;}
catch{/* The committed receipt remains verifiable without installed QEMU. */}

test('committed ES-cache receipt binds its exact executed source revision',()=>{
  assert.match(receipt.revision,/^[0-9a-f]{40}$/);
  assert.equal(receipt.status,'pass');
  assert.equal(receipt.reference.outputHex,'93a1b24b');
  assert.equal(receipt.bochs.outputHex,'93a1b24b');
  assert.equal(receipt.bochs.booted,true);
  assert.equal(receipt.bochs.panic,false);
  assert.equal(receipt.local.outputHex,'93a1b24b');
  for(const [file,expected] of Object.entries(receipt.sourceHashes)){
    assert.match(file,/^(src|scripts|test)\/[a-zA-Z0-9._/-]+$/);
    const committed=execFileSync('git',['show',`${receipt.revision}:${file}`],{cwd:repo});
    assert.equal(sha(committed),expected,`${file} at executed revision`);
  }
});

test('pinned QEMU 486 and current ordinary core agree on the owned ES-cache output',
  {skip:!available&&'pinned QEMU 8.2.2 unavailable'},()=>{
    const run=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:75000});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'pass');
    assert.equal(report.reference.outputHex,'93a1b24b');
    assert.equal(report.local.outputHex,'93a1b24b');
    assert.equal(report.local.accessedByte,0x93);
    assert.equal(report.local.modifiedBaseByte,0xa0);
    if(process.env.BOCHS_386_ROOT){
      assert.equal(report.bochs.outputHex,'93a1b24b');
      assert.equal(report.bochs.booted,true);
      assert.equal(report.bochs.panic,false);
    }
  });

test('stale ES cache after reload is rejected by the independent QEMU output',
  {skip:!available&&'pinned QEMU 8.2.2 unavailable'},()=>{
    const run=spawnSync(process.execPath,[script],{
      env:{...process.env,I386_ES_CACHE_MUTATION:'stale-after-reload'},
      encoding:'utf8',timeout:75000});
    assert.equal(run.status,1,run.stderr||run.stdout);
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'fail');
    assert.equal(report.reference.outputHex,'93a1b24b');
    assert.equal(report.local.outputHex,'93a1a14b');
    assert.deepEqual(report.differences.map(item=>item.field),['local.output']);
    if(process.env.BOCHS_386_ROOT)
      assert.equal(report.bochs.outputHex,'93a1b24b');
  });
