/** Hosted mutation proof for dedicated incremental-stage profile names. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {classify} from './classify-harris-native-incremental-stages.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export const MUTATIONS=Object.freeze([
    ['resolve dirty','RESOLVE_DIRTY','incremental_stage_resolve_dirty'],
    ['mark affected operations','MARK_AFFECTED','incremental_stage_mark_affected_operations'],
    ['evaluate and stage sparse outputs','EVALUATE_SPARSE','incremental_stage_evaluate_and_stage_sparse_outputs'],
    ['publish successful fixpoint','PUBLISH_INCREMENTAL','incremental_stage_publish_successful_fixpoint'],
].map(([name,selector,target],index)=>Object.freeze({name,selector,target,unknown:`incremental_stage_unknown_${index}`})));

function unknownProfile(name){return {nodes:[{id:1,callFrame:{functionName:name,url:'wasm://wasm/diagnostic'}}],samples:[1]};}

async function main(){
    for(const mutation of MUTATIONS){
        const sandbox=mkdtempSync(join(tmpdir(),'harris-incremental-stage-mutant.'));
        try{
            mkdirSync(join(sandbox,'scripts'),{recursive:true});
            mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
            cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
            cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
            const path=join(sandbox,'src/experimental/wired-kernel/incremental-nets.c');
            const source=readFileSync(path,'utf8');
            const from=`#define ${mutation.selector} ${mutation.target}`;
            const to=`#define ${mutation.selector} ${mutation.unknown}`;
            assert.equal(source.split(from).length-1,1,`${mutation.name} exact selector`);
            writeFileSync(path,source.replace(from,to));
            const build=join(sandbox,'build');mkdirSync(build);
            execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{
                env:{...process.env,NATIVE_INCREMENTAL_STAGE_PROFILE_NAMING:'1'},stdio:'pipe'});
            const wasm=readFileSync(join(build,'wired-net-kernel.wasm'));
            assert.ok(wasm.includes(Buffer.from(mutation.unknown)),`${mutation.name} mutant name emitted`);
            assert.equal(wasm.includes(Buffer.from(mutation.target)),false,`${mutation.name} expected name removed`);
            assert.throws(()=>classify(unknownProfile(mutation.unknown)),new RegExp(`unknown incremental stage ${mutation.unknown}`));
            console.log(`# mutation rejected: ${mutation.name}`);
        }finally{rmSync(sandbox,{recursive:true,force:true});}
    }
    console.log(`# mutations rejected: ${MUTATIONS.length}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
