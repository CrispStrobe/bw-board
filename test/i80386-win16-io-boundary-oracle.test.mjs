import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/compare-qemu-i80386-win16-io-boundary.mjs',import.meta.url));
const qemu='/usr/bin/qemu-system-i386';
const pinned='28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5';
let available=false;
try{available=createHash('sha256').update(readFileSync(qemu)).digest('hex')===pinned;}
catch{/* The standalone oracle script remains runnable on a pinned host. */}

test('protected16 taken branch stops before one PIC read and resumes exactly',
  {skip:!available&&'pinned QEMU 8.2.2 unavailable'},()=>{
    const run=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'pass');
    assert.deepEqual(report.local.trail,[0x7c2e,0x7c31,0x7c34]);
    assert.deepEqual([report.local.readsBefore,report.local.readsAfter],[0,1]);
    assert.deepEqual(report.local.before,report.reference.before);
    assert.deepEqual(report.local.after,report.reference.after);
    assert.equal(report.reference.outputHex,'a54b');
    if(process.env.BOCHS_386_ROOT){
      assert.equal(report.bochs.outputHex,'a54b');
      assert.equal(report.bochs.booted,true);
      assert.equal(report.bochs.panic,false);
    }
  });

test('one-bit device-value mutation is rejected after the I/O boundary',
  {skip:!available&&'pinned QEMU 8.2.2 unavailable'},()=>{
    const run=spawnSync(process.execPath,[script],{
      env:{...process.env,I386_WIN16_IO_MUTATION:'io-value'},encoding:'utf8',timeout:10000});
    assert.equal(run.status,1,run.stderr||run.stdout);
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'fail');
    assert.deepEqual(report.differences.map(item=>item.field),['local.after']);
    assert.equal(report.local.after.al,0xa4);
  });
