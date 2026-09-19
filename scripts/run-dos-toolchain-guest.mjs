#!/usr/bin/env node
/** Run Microsoft's 1982 assembler toolchain inside a booted MS-DOS 2 guest. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {assemble} from '../src/i8086-asm.js';
import {I8086Machine} from '../src/i8086-machine.js';
import {createDos8086,DOSBOX8086} from '../src/i8086-dos.js';
import {findMsdosFiles,build,GEOM,layoutOf,fatGet} from './build-dos-image.mjs';
import {findTools} from './oracle-masm.mjs';

export const INPUT_HASHES=Object.freeze({
    msdos:'1edf5190671ed4edcc9e6cc095e5094749c58f1833a2e26e40ba7d3389e276d1',
    command:'4cc71b3692b894eef9a7c8b3ac0fc63a71bdfa08175089562fdc4c7c5b038e8a',
    sysinit:'56d9d59d8cf6dbec648c3b391d3532bf4dffa8b615a096aca76312acbeecc7aa',
    masm:'bf3399d0ec33fd97c3789887b336208d9f4900524609c04985e16a124cbf4449',
    link:'fe52892da7bd6832cb88a959cccd230f307e30c7c83a225b2e638f4ea25d76be',
    exe2bin:'80ac337843421764bb019845f9ef802d35ef642045026b1788373cea756201e2',
});
export const BASE_REVISION='4926e93cd0133dd038b929f8506318d0da320b3b';
export const SOURCE_PATHS=Object.freeze([
    'src/i8086.js','src/i8086-machine.js','src/i8086-dos.js','src/i8086-asm.js',
    'scripts/build-dos-image.mjs','scripts/oracle-masm.mjs','scripts/run-dos-toolchain-guest.mjs',
]);

export const SOURCE=[
    'CODE    SEGMENT',
    '        ASSUME CS:CODE,DS:CODE,ES:CODE,SS:CODE',
    '        ORG 100H',
    'START:  MOV DX, OFFSET MSG',
    '        MOV AH, 9',
    '        INT 21H',
    '        INT 20H',
    'MSG     DB "GUEST-TOOLCHAIN-OK$"',
    'CODE    ENDS',
    '        END START',
].join('\r\n')+'\r\n';

const sha256=(b)=>createHash('sha256').update(b).digest('hex');
const bytes=(s)=>Uint8Array.from(s,(c)=>c.charCodeAt(0));

export function readFatFile(image,name) {
    const lay=layoutOf();
    if(!(image instanceof Uint8Array)||image.length!==lay.imageBytes)
        throw new Error(`${name}: FAT image must be exactly ${lay.imageBytes} bytes`);
    const wanted=name.toUpperCase().split('.');
    const name83=(wanted[0].padEnd(8,' ')+(wanted[1]||'').padEnd(3,' ')).slice(0,11);
    const fat=image.subarray(lay.fatStart*512,(lay.fatStart+GEOM.sectorsPerFat)*512);
    const present=[];
    for(let n=0;n<GEOM.rootEntries;n++) {
        const at=lay.rootStart*512+n*32;
        if(image[at]!==0&&image[at]!==0xe5) present.push(Buffer.from(image.subarray(at,at+11)).toString('ascii'));
        if(Buffer.from(image.subarray(at,at+11)).toString('ascii')!==name83) continue;
        let cluster=image[at+26]|image[at+27]<<8;
        let left=new DataView(image.buffer,image.byteOffset+at,32).getUint32(28,true);
        const dataBytes=(GEOM.totalSectors-lay.dataStart)*512;
        if(left>dataBytes)throw new Error(`${name}: directory length ${left} exceeds disk data area ${dataBytes}`);
        const chunks=[],seen=new Set(),clusterLimit=2+Math.floor(dataBytes/lay.clusterBytes);
        while(left) {
            if(cluster<2||cluster>=clusterLimit||cluster>=0xff8) throw new Error(`${name}: FAT cluster ${cluster} is outside the disk data area`);
            if(seen.has(cluster))throw new Error(`${name}: FAT chain loops at cluster ${cluster}`);
            seen.add(cluster);
            const start=lay.dataStart*512+(cluster-2)*lay.clusterBytes;
            const take=Math.min(left,lay.clusterBytes);
            chunks.push(image.slice(start,start+take)); left-=take;
            cluster=fatGet(fat,cluster);
        }
        return Buffer.concat(chunks.map((x)=>Buffer.from(x)));
    }
    throw new Error(`${name}: absent from guest FAT root (${present.join(', ')})`);
}

export function runDosToolchainGuest({dir=process.env.MSDOS_BIN_DIR,variant='80286',budget=25_000_000,
    source=SOURCE,expectedOutput='GUEST-TOOLCHAIN-OK'}={}) {
    if(!Number.isSafeInteger(budget)||budget<1||budget>100_000_000)
        throw new RangeError('guest budget must be a positive safe integer no greater than 100000000');
    if(typeof source!=='string'||!source.length)throw new TypeError('owned guest source must be a nonempty string');
    if(typeof expectedOutput!=='string'||!expectedOutput.length)throw new TypeError('expected guest output must be a nonempty string');
    const found=findMsdosFiles(dir?[dir]:undefined), tools=findTools(dir);
    if(!found.ok) throw new Error(found.reason);
    if(!tools.ok) throw new Error(`missing toolchain inputs: ${tools.missing.join(', ')}`);
    const inputs={...found.files,
        masm:new Uint8Array(readFileSync(tools.paths.masm)),
        link:new Uint8Array(readFileSync(tools.paths.link)),
        exe2bin:new Uint8Array(readFileSync(tools.paths.exe2bin))};
    for(const [name,hash] of Object.entries(INPUT_HASHES)) {
        if(sha256(inputs[name])!==hash) throw new Error(`${name}: input SHA-256 is not the pinned Microsoft release`);
    }
    const built=build({...found.files,extra:[
        {name:'MASM.EXE',data:inputs.masm},{name:'LINK.EXE',data:inputs.link},
        {name:'EXE2BIN.EXE',data:inputs.exe2bin},{name:'T.ASM',data:bytes(source)},
    ]});
    const disk=built.image.slice();
    const machine=new I8086Machine({...DOSBOX8086,variant});
    const dos=createDos8086(machine,{disk,geometry:{sectors:9,heads:2},blockOnKey:true}).install();
    dos.type('\r\rMASM T,T,T,NUL;\rLINK T,T,NUL,NUL;\rEXE2BIN T.EXE T.COM\rT.COM\rECHO GUEST-BUILD-DONE\r');
    dos.loadBoot(disk.subarray(0,512),0);
    let steps=0,screen='';
    while(steps++<budget) {
        dos.step();
        if((steps&1023)===0) {
            screen=dos.screenText().join('\n');
            if(/GUEST-BUILD-DONE\n\nA>/.test(screen)) break;
        }
    }
    screen=dos.screenText().join('\n');
    if(steps>=budget) throw new Error(`guest budget exhausted after ${budget} steps:\n${screen}`);
    const unsupported=dos.report().unsupported;
    if(!screen.includes(expectedOutput))throw new Error(`guest program did not print ${JSON.stringify(expectedOutput)}:\n${screen}`);
    if(!/GUEST-BUILD-DONE\n\nA>/.test(screen))throw new Error(`COMMAND.COM did not regain its prompt:\n${screen}`);
    if(unsupported.length)throw new Error(`guest requested unsupported services: ${JSON.stringify(unsupported)}`);
    let com;
    try { com=readFatFile(disk,'T.COM'); }
    catch(e) { throw new Error(`${e.message}\nGuest screen:\n${screen}`); }
    const expectedCom=assemble(source,{format:'com'}).bytes;
    if(!Buffer.from(com).equals(Buffer.from(expectedCom)))
        throw new Error(`guest T.COM bytes ${sha256(com)} do not match expected ${sha256(expectedCom)}`);
    return {variant,steps,screen,com,disk,inputHashes:{...INPUT_HASHES},
        sourceSha256:sha256(Buffer.from(source,'ascii')),comSha256:sha256(com),unsupported,
        sourceHashes:Object.fromEntries(SOURCE_PATHS.map(path=>[path,sha256(readFileSync(new URL(`../${path}`,import.meta.url)))]))};
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
    const started=performance.now();
    const result=runDosToolchainGuest({variant:process.argv[2]||'80286'});
    const elapsedMS=performance.now()-started;
    const executionRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    console.log(JSON.stringify({accepted:true,scope:'fast 80286 real-mode core on BIOS-service machine; not wired or protected-mode evidence',
        sourceHashScope:'manually enumerated execution engine and guest harness files, not a transitive import closure',
        expectedOutput:'GUEST-TOOLCHAIN-OK',baseRevision:BASE_REVISION,executionRevision,node:process.version,elapsedMS,
        timingGraded:false,variant:result.variant,steps:result.steps,
        sourceSha256:result.sourceSha256,comSha256:result.comSha256,
        inputHashes:result.inputHashes,sourceHashes:result.sourceHashes,unsupported:result.unsupported},null,2));
}
