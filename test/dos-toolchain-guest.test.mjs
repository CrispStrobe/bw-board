import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {assemble} from '../src/i8086-asm.js';
import {findMsdosFiles,build,layoutOf,GEOM} from '../scripts/build-dos-image.mjs';
import {findTools} from '../scripts/oracle-masm.mjs';
import {SOURCE,runDosToolchainGuest,readFatFile} from '../scripts/run-dos-toolchain-guest.mjs';

const dir=process.env.MSDOS_BIN_DIR;
const media=findMsdosFiles(dir?[dir]:undefined),tools=findTools(dir);
const skip=media.ok&&tools.ok?false:`Pinned MS-DOS 2 media/toolchain absent: ${media.reason||tools.missing.join(', ')}`;
let accepted;
const acceptance=()=>accepted??=runDosToolchainGuest({dir,variant:'80286'});

test('optional FAT fixtures preserve the no-extra image and reject invalid plans',{skip},()=>{
    assert.equal(createHash('sha256').update(build(media.files).image).digest('hex'),
        '5fbbe5e86fb845cff120ae8d17a01904c0db9d0b6103ce382b31130bd3eadd39',
        'the historical no-extra DOS image stays byte-identical');
    assert.throws(()=>build({...media.files,extra:[{name:'command.com',data:new Uint8Array([1])}]}),
        /collides with an existing FAT root name/);
    assert.throws(()=>build({...media.files,extra:[{name:'HUGE.BIN',data:new Uint8Array(400_000)}]}),
        /require .* clusters but the disk has/);
    const tooMany=Array.from({length:110},(_,i)=>({name:`F${i}.BIN`,data:new Uint8Array([1])}));
    assert.throws(()=>build({...media.files,extra:tooMany}),/exceed the 112-entry root directory/);
});

test('fast 286 boots real DOS and MASM/LINK/EXE2BIN build and run an owned program',{skip},()=>{
    const r=acceptance();
    assert.deepEqual(r.unsupported,[],'the real guest requested no unsupported service');
    assert.match(r.screen,/Microsoft MACRO Assembler/);
    assert.match(r.screen,/GUEST-TOOLCHAIN-OK/,'the produced program actually ran under DOS');
    assert.match(r.screen,/GUEST-BUILD-DONE\n\nA>/,'COMMAND.COM regained control after the program');
    assert.deepEqual([...r.com],[...assemble(SOURCE,{format:'com'}).bytes],
        'the file persisted by real DOS is the independently expected program');
});

test('runner rejects a built owned program that does not produce the acceptance marker',{skip},()=>{
    const wrong=SOURCE.replace('GUEST-TOOLCHAIN-OK','WRONG-OWNED-OUTPUT');
    assert.throws(()=>runDosToolchainGuest({dir,variant:'80286',source:wrong}),
        /guest program did not print "GUEST-TOOLCHAIN-OK"/);
});

test('runner rejects invalid budgets and corrupt FAT file chains',{skip},()=>{
    for(const budget of [0,-1,1.5,Infinity,100_000_001])
        assert.throws(()=>runDosToolchainGuest({dir,budget}),/guest budget must be a positive safe integer/);
    const disk=acceptance().disk.slice(),lay=layoutOf();
    let at=-1;
    for(let n=0;n<GEOM.rootEntries;n++){
        const candidate=lay.rootStart*512+n*32;
        if(Buffer.from(disk.subarray(candidate,candidate+11)).toString('ascii')==='T       COM'){at=candidate;break;}
    }
    assert.notEqual(at,-1);
    new DataView(disk.buffer,disk.byteOffset+at,32).setUint32(28,lay.clusterBytes+1,true);
    const cluster=disk[at+26]|disk[at+27]<<8,off=lay.fatStart*512+cluster+(cluster>>1);
    if(cluster&1){disk[off]=(disk[off]&0x0f)|((cluster&0x0f)<<4);disk[off+1]=(cluster>>4)&0xff;}
    else{disk[off]=cluster&0xff;disk[off+1]=(disk[off+1]&0xf0)|((cluster>>8)&0x0f);}
    assert.throws(()=>readFatFile(disk,'T.COM'),/FAT chain loops/);
    const oversized=acceptance().disk.slice();
    new DataView(oversized.buffer,oversized.byteOffset+at,32).setUint32(28,0xffffffff,true);
    assert.throws(()=>readFatFile(oversized,'T.COM'),/directory length .* exceeds disk data area/);
});

test('the checked-in receipt is bound to the executed source, output and inputs',{skip},()=>{
    const r=acceptance();
    const receipt=JSON.parse(readFileSync(new URL('../docs/receipts/2026-09-19-dos-toolchain-fast286.json',import.meta.url)));
    assert.equal(receipt.baseRevision,'4926e93cd0133dd038b929f8506318d0da320b3b');
    assert.equal(receipt.executionRevision,'ac6f1038ff6f6426afdd80b6c0879823bfe7df69');
    assert.equal(receipt.sourceSha256,r.sourceSha256);
    assert.equal(receipt.producedComSha256,r.comSha256);
    assert.deepEqual(receipt.sourceHashes,r.sourceHashes);
    assert.deepEqual(receipt.inputSha256,{
        'MSDOS.SYS':r.inputHashes.msdos,'COMMAND.COM':r.inputHashes.command,
        'SYSINIT.OBJ':r.inputHashes.sysinit,'MASM.EXE':r.inputHashes.masm,
        'LINK.EXE':r.inputHashes.link,'EXE2BIN.EXE':r.inputHashes.exe2bin,
    });
    assert.match(r.screen,new RegExp(receipt.observedOutput));
    assert.deepEqual(receipt.unsupportedServices,r.unsupported);
});

test('toolchain admission rejects a one-byte mutation before guest execution',{skip},()=>{
    const scratch=mkdtempSync(join(tmpdir(),'bw-dos-toolchain-'));
    try {
        writeFileSync(join(scratch,'MSDOS.SYS'),media.files.msdos);
        writeFileSync(join(scratch,'COMMAND.COM'),media.files.command);
        writeFileSync(join(scratch,'SYSINIT.OBJ'),media.files.sysinit);
        copyFileSync(tools.paths.masm,join(scratch,'MASM.EXE'));
        copyFileSync(tools.paths.link,join(scratch,'LINK.EXE'));
        copyFileSync(tools.paths.exe2bin,join(scratch,'EXE2BIN.EXE'));
        const path=join(scratch,'MASM.EXE'),damaged=readFileSync(path);
        damaged[100]^=0xff; writeFileSync(path,damaged);
        assert.throws(()=>runDosToolchainGuest({dir:scratch,variant:'80286'}),
            /masm: input SHA-256 is not the pinned Microsoft release/);
    } finally { rmSync(scratch,{recursive:true,force:true}); }
});
