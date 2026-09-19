import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeAtDosAcceptance,readFat12RootFile} from '../scripts/lib/at-dos-acceptance.mjs';

const evidence={passed:true,final:{halted:false,shutdown:false},screenText:['at-boot-ok','A>'],
    guestFile:{text:'at-boot-ok\r\n'},keyboardScript:{remaining:[],injected:[{scan:0x1c}]},
    executionBoundaries:{int19:{},unexpectedInterrupt:null,bootSector:{sha256:'boot',devices:{primaryDma:{
        status:4,channels:[{},{},{page:0,baseAddr:0x7c00,baseCount:0x1ff,curAddr:0x7e00,curCount:0xffff}]}}}}};
const options={expectedText:'at-boot-ok\r\n',inputBootSectorSha256:'boot',
    inputMediaSha256:'persisted',priorOutputMediaSha256:'persisted'};

test('AT DOS acceptance requires every independent boot, DMA, keyboard, file, prompt and media-link fact',()=>{
    assert.equal(gradeAtDosAcceptance(evidence,options),true);
    const mutations=[
        e=>e.guestFile.text='wrong\r\n',
        e=>e.screenText=['A>echo at-boot-ok','A>'],
        e=>e.screenText=['at-boot-ok'],
        e=>e.executionBoundaries.bootSector.devices.primaryDma.status=0,
        e=>e.keyboardScript.injected=[],
        e=>e.executionBoundaries.bootSector.sha256='wrong',
        e=>e.final.shutdown=true,
    ];
    for(const mutate of mutations) {
        const copy=structuredClone(evidence);mutate(copy);
        assert.equal(gradeAtDosAcceptance(copy,options),false);
    }
    assert.equal(gradeAtDosAcceptance(evidence,{...options,priorOutputMediaSha256:'other'}),false);
});

test('AT FAT12 acceptance reads one bounded regular file and rejects metadata or broken chains',()=>{
    const image=new Uint8Array(8*512);
    const word=(offset,value)=>{image[offset]=value;image[offset+1]=value>>8;};
    word(11,512);image[13]=1;word(14,1);image[16]=1;word(17,16);word(19,8);word(22,1);
    image[512+3]=0xff;image[512+4]=0x0f;
    image.set(Buffer.from('ATBOOT  TXT'),1024);word(1024+26,2);image[1024+28]=4;
    image.set(Buffer.from('ok\r\n'),1536);
    assert.equal(readFat12RootFile(image,'ATBOOT.TXT').text,'ok\r\n');
    const directory=image.slice();directory[1024+11]=0x10;
    assert.throws(()=>readFat12RootFile(directory,'ATBOOT.TXT'),/not a regular/);
    const chained=image.slice();chained[512+3]=3;chained[512+4]=0;
    assert.throws(()=>readFat12RootFile(chained,'ATBOOT.TXT'),/end-of-chain/);
});
