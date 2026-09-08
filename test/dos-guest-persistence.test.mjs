// Real Microsoft DOS kernel + COMMAND.COM, with an emulated BIOS disk path.
// Not a wired-board test, not an editor acceptance, and not an 80286 pass.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {I8086Machine} from '../src/i8086-machine.js';
import {createDos8086,DOSBOX8086} from '../src/i8086-dos.js';
import {findMsdosFiles,build,GEOM,layoutOf} from '../scripts/build-dos-image.mjs';

// https://github.com/microsoft/MS-DOS/tree/2d04cacc5322951f187bb17e017c12920ac8ebe2/v2.0/bin
// Microsoft MIT release only; no other historical DOS distribution accepted.
const hashes={
    msdos:'1edf5190671ed4edcc9e6cc095e5094749c58f1833a2e26e40ba7d3389e276d1',
    command:'4cc71b3692b894eef9a7c8b3ac0fc63a71bdfa08175089562fdc4c7c5b038e8a',
    sysinit:'56d9d59d8cf6dbec648c3b391d3532bf4dffa8b615a096aca76312acbeecc7aa'
};
const found=findMsdosFiles();
const when={skip:found.ok?false:`Pinned DOS guest media absent: ${found.reason}`};
function boot(disk,variant,commands,expected) {
    const machine=new I8086Machine({...DOSBOX8086,variant});
    const dos=createDos8086(machine,{disk,geometry:{sectors:9,heads:2},blockOnKey:true}).install();
    dos.type(`\r\r${commands}`); dos.loadBoot(disk.subarray(0,512),0);
    let steps=0;
    while(steps++<3000000) {
        dos.step();
        if((steps&1023)===0 && expected.test(dos.screenText().join('\n'))) break;
    }
    const screen=dos.screenText().join('\n');
    assert.ok(steps<3000000,`${variant} did not reach expected output: ${screen}`);
    assert.deepEqual(dos.report().unsupported,[]);
    assert.match(screen,/MS-DOS version 2\.00/);
    return screen;
}
function readNote(disk) {
    const lay=layoutOf();
    for(let n=0;n<GEOM.rootEntries;n++) {
        const a=lay.rootStart*512+n*32;
        if(Buffer.from(disk.subarray(a,a+11)).toString('ascii')!=='NOTE    TXT') continue;
        const cluster=disk[a+26]|disk[a+27]<<8;
        const size=new DataView(disk.buffer,disk.byteOffset+a,32).getUint32(28,true);
        assert.ok(size<=lay.clusterBytes,'this single-cluster fixture must not silently truncate');
        const start=lay.dataStart*512+(cluster-2)*lay.clusterBytes;
        return Buffer.from(disk.subarray(start,start+size)).toString('ascii');
    }
    assert.fail('NOTE.TXT not present in actual disk root directory');
}

for(const variant of ['8086','80186']) test(`${variant}: real DOS shell writes, fresh-boot reads, overwrites and remounts file`,when,()=>{
    for(const [name,hash] of Object.entries(hashes)) {
        assert.equal(createHash('sha256').update(found.files[name]).digest('hex'),hash,`wrong ${name} guest revision`);
    }
    const pristine=build(found.files).image;
    const disk=pristine.slice();
    boot(disk,variant,'echo PATERSON-OK>NOTE.TXT\rtype NOTE.TXT\r',/\nPATERSON-OK\n\nA>/);
    assert.equal(readNote(disk),'PATERSON-OK\r\n');
    assert.notDeepEqual(disk,pristine,'the disk, not just a host file map, must change');
    const remounted=Uint8Array.from(JSON.parse(JSON.stringify([...disk])));
    boot(remounted,variant,'type NOTE.TXT\recho EDITED>NOTE.TXT\rtype NOTE.TXT\r',/\nEDITED\n\nA>/);
    assert.equal(readNote(remounted),'EDITED\r\n');
    boot(remounted.slice(),variant,'type NOTE.TXT\rtype MISSING.TXT\r',/File not found/);
});
