/** Hosted mutation proof for admitted memory input gather-to-preview fusion. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
export const MUTATIONS=Object.freeze([
    {name:'mapped preview omits the final input',pattern:'final data pin and later live values',file:'memory-banks.c',
        from:'#define INPUT(index) inputs[input_nets?input_nets[offset+(index)]:offset+(index)]',
        to:'#define INPUT(index) inputs[input_nets?input_nets[offset+((index)==27?0:(index))]:offset+(index)]'},
    {name:'mapped preview ignores conflicts',pattern:'propagates conflicts before peer commit',file:'memory-banks.c',
        from:'#define CONFLICT(index) conflicts[input_nets?input_nets[offset+(index)]:offset+(index)]',
        to:'#define CONFLICT(index) 0'},
    {name:'admitted preview reads stale snapshot buffers',pattern:'final data pin and later live values',file:'memory-circuit.c',
        from:'preview_owned_memory_banks_mapped(banks,U8(19),U32(20),U32(21),U8(22),U8(10),U8(11),input_nets,U8(25),U8(26),U8(27),U32(28))',
        to:'preview_owned_memory_banks(banks,U8(19),U32(20),U32(21),U8(22),U8(23),U8(24),U8(25),U8(26),U8(27),U32(28))'},
    {name:'raw preview bypasses standalone validation',pattern:'public native memory preview',file:'memory-banks.c',
        from:'0,staged_drives,staged_present,staged_changed,fault,0);',
        to:'0,staged_drives,staged_present,staged_changed,fault,1);'},
    {name:'first bank state commits before late peer preview',pattern:'keeps late peer faults atomic',file:'memory-banks.c',
        from:'for(u32 p=0;p<8;p++)staged_drives[b*8+p]=n[2]==NONE?3:(n[2]>>p)&1;',
        to:'for(u32 p=0;p<8;p++)staged_drives[b*8+p]=n[2]==NONE?3:(n[2]>>p)&1; if(b==0&&banks>1)for(u32 w=0;w<WORDS;w++)states[w]=staged[w];'},
    {name:'mapped preview reads the conflict of another net',pattern:'propagates conflicts before peer commit',file:'memory-banks.c',
        from:'input_nets[offset+(index)]:offset+(index)]\n        #define CONFLICT(index) conflicts[input_nets?input_nets[offset+(index)]:offset+(index)]',
        to:'input_nets[offset+(index)]:offset+(index)]\n        #define CONFLICT(index) conflicts[input_nets?input_nets[offset+((index)+1<PINS?(index)+1:0)]:offset+(index)]'},
    {name:'published memory drivers return without settling',pattern:'settles published drivers',file:'memory-circuit.c',
        from:'#ifdef NATIVE_STAGE_ATTRIBUTION\n        STAGE_ADD(STAGE_MEMORY_POST_SETTLES,1);\n        #endif\n        result=settle_context(c);\n        #endif\n        if(result&0x80000000u)',
        to:'#ifdef NATIVE_STAGE_ATTRIBUTION\n        STAGE_ADD(STAGE_MEMORY_POST_SETTLES,1);\n        #endif\n        if(changed){fault[0]=0;return 0;} result=settle_context(c);\n        #endif\n        if(result&0x80000000u)'},
]);

async function main(){for(const mutation of MUTATIONS){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-memory-input-fusion-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        const path=join(sandbox,'src/experimental/wired-kernel',mutation.file),source=readFileSync(path,'utf8');
        assert.equal(source.split(mutation.from).length-1,1,`${mutation.name} source shape`);
        writeFileSync(path,source.replace(mutation.from,mutation.to));
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,
            'test/harris-native-memory.test.mjs','test/harris-native-memory-circuit.test.mjs'],{cwd:root,
            env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name} must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name} named red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}console.log(`# mutations rejected: ${MUTATIONS.length}`);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
