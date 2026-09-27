import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAtConsoleEvents} from '../scripts/lib/i80386-at-console-events.mjs';

test('console event parser admits ordered byte and pointer input and rejects ambiguous schedules',()=>{
  assert.deepEqual(parseAtConsoleEvents('[{"step":0,"type":"mouse","dx":3,"dy":-2,"buttons":1},{"step":0,"type":"key","code":28},{"step":2,"type":"serial","code":65}]',3).map(e=>e.type),
    ['mouse','key','serial']);
  assert.throws(()=>parseAtConsoleEvents('[{"step":2,"type":"key","code":28},{"step":1,"type":"key","code":29}]',3),/ordered/);
  assert.throws(()=>parseAtConsoleEvents('[{"step":0,"type":"mouse","dx":1,"dy":2,"buttons":8}]',3),/three-bit/);
  assert.throws(()=>parseAtConsoleEvents('[{"step":0,"type":"key","code":256}]',3),/byte code/);
});

test('console CLI binds external bytes and records input acceptance without bundled media',()=>{
  const dir=mkdtempSync(join(tmpdir(),'at-console-'));
  const paths={bios:join(dir,'bios.bin'),vga:join(dir,'vga.bin'),hdd:join(dir,'hdd.img'),
    events:join(dir,'events.json'),report:join(dir,'report.json'),snapshot:join(dir,'vga.json')};
  const bios=Buffer.alloc(0x10000),vga=Buffer.alloc(0x4000),hdd=Buffer.alloc(512);
  for(const[name,bytes]of [['bios',bios],['vga',vga],['hdd',hdd]])writeFileSync(paths[name],bytes);
  writeFileSync(paths.events,JSON.stringify([{step:0,type:'mouse',dx:1,dy:2,buttons:1}]));
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  execFileSync(process.execPath,['scripts/run-i80386-at-console.mjs'],{cwd,env:{...process.env,
    AT_BIOS_ROM:paths.bios,AT_BIOS_SHA256:digest(bios),
    VGA_BIOS_ROM:paths.vga,VGA_BIOS_SHA256:digest(vga),AT_HDD_IMAGE:paths.hdd,
    AT_HDD_SHA256:digest(hdd),AT_HDD_GEOMETRY:'1,1,1',AT_POST_STEPS:'1',
    AT_CONSOLE_EVENTS:paths.events,AT_CONSOLE_REPORT:paths.report,
    AT_CONSOLE_VGA_OUTPUT:paths.snapshot},encoding:'utf8'});
  const report=JSON.parse(readFileSync(paths.report,'utf8'));
  assert.equal(report.inputs.mouseEnabled,true);
  assert.equal(report.inputs.cmosEquipment,0x05);
  assert.equal(report.delivered.length,1);
  assert.equal(report.delivered[0].accepted,false); // guest has not enabled mouse streaming
  assert.equal(report.steps,1);
  assert.equal(report.inputs.code16Loads,false);
  assert.equal(report.code16LoadExecutions,0);
  assert.equal(report.vga.planeSha256.length,4);
  const snapshot=JSON.parse(readFileSync(paths.snapshot,'utf8'));
  assert.equal(snapshot.planeBase64.length,4);
  assert.ok(['seq','gc','crtc','attr','dac'].every(bank=>
    Array.isArray(snapshot.registers[bank])));
  const config=join(dir,'dosbox.conf'),configuredReport=join(dir,'configured.json');
  writeFileSync(config,'[autoexec]\nimgmount 2 "hdd.img" -t hdd -fs none -size 512,1,1,1\nboot -l c\n');
  execFileSync(process.execPath,['scripts/run-i80386-at-console.mjs','--dosbox-conf',config,
    '--steps','1'],{cwd,env:{...process.env,AT_BIOS_ROM:paths.bios,
    AT_BIOS_SHA256:digest(bios),VGA_BIOS_ROM:paths.vga,VGA_BIOS_SHA256:digest(vga),
    AT_HDD_SHA256:digest(hdd),AT_CONSOLE_REPORT:configuredReport},encoding:'utf8'});
  const configured=JSON.parse(readFileSync(configuredReport,'utf8'));
  assert.deepEqual(configured.inputs.geometry,[1,1,1]);
  assert.equal(configured.inputs.cmosEquipment,0x01);
  assert.equal(configured.inputs.dosboxConfig.parsed.imagePath,paths.hdd);
  const loadReport=join(dir,'code16-loads.json');
  execFileSync(process.execPath,['scripts/run-i80386-at-console.mjs','--dosbox-conf',config,
    '--steps','1'],{cwd,env:{...process.env,AT_BIOS_ROM:paths.bios,
    AT_BIOS_SHA256:digest(bios),VGA_BIOS_ROM:paths.vga,VGA_BIOS_SHA256:digest(vga),
    AT_HDD_SHA256:digest(hdd),AT_CODE16_LOADS:'1',AT_CONSOLE_REPORT:loadReport},encoding:'utf8'});
  const loads=JSON.parse(readFileSync(loadReport,'utf8'));
  assert.equal(loads.inputs.code16Loads,true);
  assert.equal(loads.code16LoadExecutions,0);
  assert.deepEqual(loads.cpu,configured.cpu);
  const nativeReport=join(dir,'native.json');
  execFileSync(process.execPath,['scripts/run-i80386-at-console.mjs','--dosbox-conf',config,
    '--steps','1','--native-blocks'],{cwd,env:{...process.env,AT_BIOS_ROM:paths.bios,
    AT_BIOS_SHA256:digest(bios),VGA_BIOS_ROM:paths.vga,VGA_BIOS_SHA256:digest(vga),
    AT_HDD_SHA256:digest(hdd),AT_CONSOLE_REPORT:nativeReport},encoding:'utf8'});
  const native=JSON.parse(readFileSync(nativeReport,'utf8'));
  assert.equal(native.inputs.nativeBlocks,true);
  assert.deepEqual(native.cpu,configured.cpu);
  assert.deepEqual(native.vga.planeSha256,configured.vga.planeSha256);
  const modeReport=join(dir,'mode-profile.json');
  execFileSync(process.execPath,['scripts/run-i80386-at-console.mjs','--dosbox-conf',config,
    '--steps','1'],{cwd,env:{...process.env,AT_BIOS_ROM:paths.bios,
    AT_BIOS_SHA256:digest(bios),VGA_BIOS_ROM:paths.vga,VGA_BIOS_SHA256:digest(vga),
    AT_HDD_SHA256:digest(hdd),AT_MODE_CPU_PROFILE:'1',AT_CONSOLE_REPORT:modeReport},
  encoding:'utf8'});
  const measured=JSON.parse(readFileSync(modeReport,'utf8'));
  assert.deepEqual(measured.cpu,configured.cpu);
  assert.deepEqual(measured.modeCpuProfile.steps,[1,0,0,0]);
  assert.deepEqual(measured.modeCpuProfile.pureWindows,[1,0,0,0]);
  assert.equal(measured.modeCpuProfile.mixedWindows,0);
  assert.equal(measured.modeCpuProfile.samples,1);
});
