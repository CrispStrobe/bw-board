import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDosboxAtConfig} from '../scripts/lib/i80386-at-dosbox-config.mjs';

test('DOSBox AT config resolves a quoted raw HDD and CHS from imgmount',()=>{
  const config=parseDosboxAtConfig(`[dosbox]\nmachine=svga_s3\n[autoexec]\nmount d /games
imgmount 2 "disks/Windows 3.1.img" -t hdd -fs none -size 512,17,4,615
boot -l c`, '/tmp/at/dosbox.conf');
  assert.equal(config.imagePath,'/tmp/at/disks/Windows 3.1.img');
  assert.deepEqual(config.geometry,[615,4,17]);
  assert.deepEqual(config.boot,['-l','c']);
  assert.deepEqual(config.ignored,['mount d /games']);
});

test('DOSBox AT config rejects ambiguous, non-HDD and mismatched boot inputs',()=>{
  const conf='/tmp/at/dosbox.conf';
  assert.throws(()=>parseDosboxAtConfig('[autoexec]\nmount c /games',conf),/exactly one/);
  assert.throws(()=>parseDosboxAtConfig('[autoexec]\nimgmount 2 disk.img -t hdd',conf),/needs -size/);
  assert.throws(()=>parseDosboxAtConfig('[autoexec]\nimgmount 2 disk.img -t hdd -size 512,17,4,615\nboot other.img',conf),/different image/);
  assert.throws(()=>parseDosboxAtConfig('[autoexec]\nimgmount 2 disk.img -t hdd -size 512,17,4,615\nimgmount c other.img -size 512,17,4,615',conf),/exactly one/);
  assert.throws(()=>parseDosboxAtConfig('[autoexec]\nimgmount 2 disk.img -t hdd -size 1024,17,4,615',conf),/512/);
});
