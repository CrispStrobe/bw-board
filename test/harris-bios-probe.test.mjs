import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildBios} from '../scripts/build-bios.mjs';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';

test('hardware-matched PIC firmware profile changes only ICW4; default ROM remains identical',()=>{
    const legacy=buildBios(),single=buildBios({picMode:'single-unbuffered'});
    assert.equal(createHash('sha256').update(legacy.bytes).digest('hex'),'6f9f5463afa5c30ce25263c0430f741cbb0274e98b00c675ef04c9edfee0aa34');
    const diffs=Array.from(legacy.bytes.keys()).filter(i=>legacy.bytes[i]!==single.bytes[i]);
    assert.deepEqual(diffs,[0xf6]);assert.equal(legacy.bytes[0xf6],9);assert.equal(single.bytes[0xf6],1);
    assert.equal(legacy.picMode,'legacy-buffered');assert.equal(single.picMode,'single-unbuffered');
    assert.deepEqual(single.bytes.slice(0xfff0),legacy.bytes.slice(0xfff0));
});
test('firmware profile selection refuses unknown modes and ambiguous source configuration',()=>{
    assert.throws(()=>buildBios({picMode:'automatic'}),/picMode/);
    const source=readFileSync(new URL('../rom/bios.asm',import.meta.url),'utf8');
    assert.throws(()=>buildBios({source:source.replace(/^BIOS_PIC_ICW4.*$/m,''),picMode:'single-unbuffered'}),/configuration/);
    assert.throws(()=>buildBios({source:source+'\nBIOS_PIC_ICW4 equ 09h\n',picMode:'single-unbuffered'}),/configuration/);
});
test('hardware-matched firmware does not weaken the PIC buffered-mode refusal',()=>{
    const pic=new Harris8259Adapter({enabled:true}),A=bitPins('a',24),D=bitPins('d',16),IR=bitPins('ir',8);
    const pins={reset:0,inta_n:1,ior_n:1,iow_n:1,bhe_n:1,m_io:0,...bitDrives(A,0x20),...bitDrives(D,0),...bitDrives(IR,0)};
    const write=(reg,value)=>{
        Object.assign(pins,bitDrives(A,0x20+reg),bitDrives(D,value<<(8*reg)),{bhe_n:1-reg,iow_n:0});
        pic.update(p=>pins[p]);pins.iow_n=1;pic.update(p=>pins[p]);
    };
    write(0,0x13);write(1,8);assert.throws(()=>write(1,9),{code:'UNSUPPORTED_PIC_MODE'});
});
const cli=args=>spawnSync(process.execPath,[new URL('../scripts/probe-harris-bios.mjs',import.meta.url).pathname,...args],{encoding:'utf8',timeout:20000});
test('probe argument errors are distinct from diagnostic stops',()=>{
    for(const args of [['--max-clocks','0'],['--max-clocks','NaN'],['--max-clocks','1000001'],['--pic-mode','unknown'],['--ram-kib','65'],['--other','1']]) {
        const r=cli(args);assert.equal(r.status,1);assert.equal(r.stdout,'');
    }
});
test('one-clock probe is explicitly not boot acceptance and records configuration/provenance',()=>{
    const r=cli(['--max-clocks','1','--ram-kib','64','--pic-mode','single-unbuffered']);
    assert.equal(r.status,2,r.stderr);const report=JSON.parse(r.stdout);
    assert.equal(report.accepted,false);assert.equal(report.completedClocks,1);
    assert.equal(report.outcome.status,'budget-exhausted');assert.equal(report.pic.writes,0);
    assert.equal(report.configuration.ramBytes,65536);assert.equal(report.configuration.picMode,'single-unbuffered');
    assert.equal(Object.keys(report.sourceHashes).length,8);
});
