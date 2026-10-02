import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {f0GpioTimingResult,assertSameGpioGuest} from '../scripts/lib/f0-gpio-profile-receipt.mjs';
// Synthetic parser inputs, not actual engine measurements.
const fixture=(rates=[2,2,.5,2,2])=>{
 const lines=['F0_WASM_GUEST '+JSON.stringify({workload:'gpio',elfSha256:'a'.repeat(64),imageSha256:'b'.repeat(64)})];
 for(const [index,rtx] of rates.entries()){
  const iterations=(index+1)*1000;
  lines.push('F0_WASM_SAMPLE '+JSON.stringify({workload:'gpio',index,cycles:48_000_000,cpuHz:48_000_000,
   wallSeconds:1/rtx,rtx,iterations,checksum:iterations^255,mirror:iterations-1,input:index%2?2:0,output:index%2}));
 }
 const passed=rates.every(r=>r>=1);
 lines.push('ok 1 - F0 gpio: active guest and RAM/MMIO observations',
  `${passed?'ok':'not ok'} 2 - F0 gpio: all five 48M-cycle windows meet 1x`,
  '# tests 2','# skipped 0',`# fail ${passed?0:1}`,`# pass ${passed?2:1}`,'# cancelled 0','# todo 0');
 return {stdout:lines.join('\n'),exitCode:passed?0:1};
};
const parse=f=>f0GpioTimingResult(f.stdout,f.exitCode);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('GPIO-only parser retains every-window loss despite a passing median',()=>{
 const p=parse(fixture());
 assert.deepEqual(Object.keys(p.workloads),['gpio']);
 assert.equal(p.workloads.gpio.medianRtx,2);assert.equal(p.workloads.gpio.minimumRtx,.5);
 assert.equal(p.allWindowsMeet1x,false);assert.equal(parse(fixture([2,2,2,2,2])).allWindowsMeet1x,true);
});
test('GPIO-only parser rejects missing proof, skips, extra workloads and wrong exits',()=>{
 const f=fixture();
 for(const stdout of [f.stdout.replace(/^F0_WASM_SAMPLE .*\n/m,''),
  f.stdout.replace(/^F0_WASM_GUEST .*\n/m,''),f.stdout.replaceAll('"gpio"','"ram"'),
  f.stdout.replace('# tests 2','# tests 4'),f.stdout.replace('# skipped 0','# skipped 1'),
  f.stdout.replace('# cancelled 0','# cancelled 1'),f.stdout.replace('# todo 0','# todo 1'),
  f.stdout.replace('ok 1 -','not ok 1 -'),f.stdout.replace('# pass 1','# pass 2'),
  f.stdout+'\nF0_WASM_GUEST '+JSON.stringify({workload:'ram'})])assert.throws(()=>parse({...f,stdout}));
 for(const exitCode of [0,2,null])assert.throws(()=>parse({...f,exitCode}));
});
test('GPIO-only parser rejects inconsistent timing, cycle accounting and held GPIO observations',()=>{
 for(const change of [s=>s.index=0,s=>s.cpuHz++,s=>s.cycles--,s=>s.rtx++,s=>s.wallSeconds=0,
  s=>s.iterations=0,s=>s.mirror=0,s=>s.checksum^=128,s=>s.input=99,s=>s.output=99]){
  const f=fixture();
  f.stdout=f.stdout.split('\n').map(l=>{
   if(!l.startsWith('F0_WASM_SAMPLE '))return l;
   const sample=JSON.parse(l.slice(15));change(sample);return 'F0_WASM_SAMPLE '+JSON.stringify(sample);
  }).join('\n');
  assert.throws(()=>parse(f));
 }
});
test('ordinary and sampled GPIO runs require identical loaded guest and cycle-indexed observations',()=>{
 const a=parse(fixture()),b=parse(fixture());
 b.workloads.gpio.guest.elfSha256='c'.repeat(64);assertSameGpioGuest(a,b);
 b.workloads.gpio.guest.imageSha256='c'.repeat(64);assert.throws(()=>assertSameGpioGuest(a,b));
 b.workloads.gpio.guest.imageSha256='b'.repeat(64);b.workloads.gpio.guestObservations[3].input=0;
 assert.throws(()=>assertSameGpioGuest(a,b));assert.throws(()=>assertSameGpioGuest(a,{}));
});
test('isolated harness changes only workload selection; ordinary acceptance is unchanged',()=>{
 const ordinary=read('test/labwired-f0-timing.test.mjs');
 assert.equal(read('test/labwired-f0-gpio-profile.test.mjs'),
  ordinary.replace("for (const workload of ['ram', 'gpio'])","for (const workload of ['gpio'])"));
 const tool=read('scripts/profile-labwired-f0-gpio.mjs');
 assert.match(tool,/bytes.length !== declared.bytes \|\| hash\(bytes\) !== declared.sha256/);
 assert.match(tool,/LABWIRED_F0_REQUIRED: '1', LABWIRED_REQUIRE_F0_RTX: '1'/);
 assert.match(tool,/assertSameGpioGuest\(receipt.ordinary, receipt.sampled\)/);
 assert.match(tool,/Unset NODE_OPTIONS/);assert.match(tool,/Refusing to overwrite evidence/);
 assert.match(tool,/profileError = error.message;[\s\S]*?save\(\);[\s\S]*?throw error/);
 assert.ok(tool.indexOf('save(); // Preserve the original profile identity')<tool.indexOf('summarizeCpuProfile(JSON.parse(bytes))'));
 assert.ok(tool.indexOf("label + '-stdout.txt'")<tool.indexOf('f0GpioTimingResult(child.stdout'));
 assert.ok(tool.indexOf("run('ordinary', [])")<tool.indexOf("run('sampled',"));
 const workflow=read('.github/workflows/labwired-f0-profile.yml');
 assert.match(workflow,/gpio_profile:[\s\S]*?type: boolean\n        default: false/);
 assert.match(workflow,/node-version: 22\.23\.3/);
 assert.match(workflow,/Independent ordinary and sampled GPIO-only processes\n        if: inputs.gpio_profile/);
 assert.match(workflow,/Retain raw evidence including failed timing windows\n        if: always\(\)/);
 assert.doesNotMatch(workflow,/contents: write|publish=true/);
});
