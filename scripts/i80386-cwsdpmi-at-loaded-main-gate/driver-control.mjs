import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {passiveRows,vgaTextAdmission,ringEmpty,controllerStatus,run} from './driver.mjs';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const plane=new Uint8Array(65536),latches=Uint8Array.from([5,6,7,8]);
for(const [index,char] of [...'A:\\>'].entries())plane[index*2]=char.charCodeAt(0);
const card={misc:2,seq:new Uint8Array(8),gc:new Uint8Array(16),
  crtc:new Uint8Array(32),getVideoState(){throw new Error('chip getter invoked');}};
card.gc[6]=0x0c;card.seq[4]=6;card.crtc[1]=79;
const video={registerSource:card,planes:[plane,new Uint8Array(65536),
  new Uint8Array(65536),new Uint8Array(65536)],latches,
  read(){throw new Error('VGA read invoked');}};
const memory=new Uint8Array(16<<20);
const machine={vgaMemory:video,chips:{vga1:card},mem:memory,
  _a20Controller:{outputQueue:[],inputBusyCyclesRemaining:0},
  _read386(){throw new Error('bus read invoked');},
  _read(){throw new Error('board read invoked');}};
const before={plane:sha(plane),latches:sha(latches),memory:sha(memory)};
const lines=passiveRows(machine);
assert.equal(lines?.[0],'A:\\>');
assert.deepEqual({plane:sha(plane),latches:sha(latches),memory:sha(memory)},before);
assert.equal(lines?.length,25);
card.crtc[0x0c]=0;card.crtc[0x0d]=40;
for(const [index,char] of [...'C:\\>'].entries())plane[(40+index)*2]=char.charCodeAt(0);
assert.equal(passiveRows(machine)?.[0],'C:\\>');
card.crtc[0x0d]=0;
card.seq[4]=2;card.gc[6]=0x0e;
assert.ok(passiveRows(machine)?.[0].startsWith('A:\\>'));
// Actual earlier owned FreeDOS AT VGA register mode: sequencer bit 0 is set,
// while source _route ignores it for character fetches.
card.misc=103;card.seq[4]=3;card.gc[4]=0;card.gc[5]=16;card.gc[6]=14;
assert.equal(vgaTextAdmission(machine).admitted,true);
assert.ok(passiveRows(machine)?.[0].startsWith('A:\\>'));
assert.deepEqual({latches:sha(latches),memory:sha(memory)},
  {latches:before.latches,memory:before.memory});
card.gc[4]=1;
assert.equal(vgaTextAdmission(machine).admitted,true);
card.gc[5]=0;
assert.equal(vgaTextAdmission(machine).reason,'character read plane');
card.gc[4]=0;card.gc[5]=16;
card.gc[4]=2;
assert.equal(vgaTextAdmission(machine).reason,'character read plane');
assert.equal(passiveRows(machine),null);card.gc[4]=0;
card.seq[4]=11;
assert.equal(vgaTextAdmission(machine).reason,'unsupported sequencer route');
assert.equal(passiveRows(machine),null);
card.seq[4]=1;
assert.equal(vgaTextAdmission(machine).reason,'unsupported sequencer route');
card.seq[4]=3;card.gc[5]=24;
assert.equal(vgaTextAdmission(machine).reason,'VGA read compare mode');
card.gc[5]=16;
card.gc[6]=0x0d;assert.equal(passiveRows(machine),null);card.gc[6]=0x0c;
assert.equal(ringEmpty(machine),true);
memory[0x41c]=1;assert.equal(ringEmpty(machine),false);
assert.equal(controllerStatus(machine),0);
machine._a20Controller.outputQueue.push({value:1});
assert.equal(controllerStatus(machine)&1,1);

if(!process.env.TMPDIR)throw new Error('owned TMPDIR required');
const scratch=fs.mkdtempSync(path.join(process.env.TMPDIR,'cwsdpmi-at-driver-control-'));
try {
  const input=path.join(scratch,'input.json'),alias=path.join(scratch,'alias.json');
  fs.writeFileSync(input,JSON.stringify({bios:'unavailable'}));
  fs.symlinkSync(input,alias);
  const report=path.join(scratch,'report.json'),progress=path.join(scratch,'progress.json');
  const result=run(alias,report,progress);
  process.exitCode=0;
  assert.equal(result.passed,false);
  assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).firstFailure,result.firstFailure);
  assert.match(result.firstFailure,/ELOOP|symbolic/i);
  assert.doesNotMatch(fs.readFileSync(report,'utf8'),/\/mnt\/|\/tmp\/|\/home\//);
  assert.ok(fs.readFileSync(progress,'utf8').includes('firstFailure'));
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
console.log('CWSDPMI AT loaded-main driver controls PASS');
