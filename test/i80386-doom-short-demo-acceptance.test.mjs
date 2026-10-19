import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gradeI80386DoomShortDemo} from '../scripts/lib/i80386-doom-short-demo-acceptance.mjs';

const reportPath=process.env.ASTRA_DOOM_SHORT_REPORT;
test('short Doom demo acceptance rejects material evidence mutations',
  {skip:!reportPath&&'set ASTRA_DOOM_SHORT_REPORT to the source-bound guest report'},()=>{
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  assert.equal(gradeI80386DoomShortDemo(report).accepted,true);
  const mutations=[
    report=>{report.screenText[0]='timed 23 gametics in 1464 realtics';},
    report=>{report.screenText[1]='';},
    report=>{report.hdd.inputSha256='0'.repeat(64);},
    report=>{report.hdd.files.doomExe.sha256='0'.repeat(64);},
    report=>{delete report.vgaEvidence.latestGraphicsSnapshot;},
    report=>{report.vgaEvidence.latestGraphicsSnapshot=report.vgaEvidence.firstGraphicsSnapshot;},
    report=>{const snapshot=report.vgaEvidence.latestGraphicsSnapshot;
      const plane=Buffer.from(snapshot.planesBase64[0],'base64');plane[0x8000]^=1;
      snapshot.planesBase64[0]=plane.toString('base64');},
    report=>{report.hostRefusal={message:'mutation'};},
    report=>{report.keyboardScript.requested='doom -timedemo astra\r';}
  ];
  for(const mutate of mutations){
    const changed=structuredClone(report);mutate(changed);
    assert.equal(gradeI80386DoomShortDemo(changed).accepted,false);
  }
});
