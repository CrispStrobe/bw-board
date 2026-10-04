import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export function verifyProof(log) {
    const rows=[...log.matchAll(/WASM_WORD_DISPATCH_PROOF (\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]));
    assert.deepEqual(rows.map(r=>r.budget),[1,7,8,16,31,64,257]);
    for(const row of rows){
        assert.deepEqual(row,{
            budget:row.budget,
            imageSha256:'60fcba1c8ab4b3bfb835acd755d10253acaf817bfb7a9c979928e316f8d2427f',
            storePc:134217824,loadPc:134217826,safeInterval:1024,phases:5,loops:1572
        });
    }
    return rows;
}
if(process.argv.includes('--self-test')) {
    const row={budget:1,imageSha256:'60fcba1c8ab4b3bfb835acd755d10253acaf817bfb7a9c979928e316f8d2427f',
        storePc:134217824,loadPc:134217826,safeInterval:1024,phases:5,loops:1572};
    const good=[1,7,8,16,31,64,257].map(budget=>'# WASM_WORD_DISPATCH_PROOF '+JSON.stringify({...row,budget})).join('\n');
    assert.equal(verifyProof(good).length,7);
    for(const bad of [good.split('\n').filter((_,i)=>i!==1).join('\n'),good+'\n'+good,
        good.replace('"loops":1572','"loops":1571'),good.replace('"safeInterval":1024','"safeInterval":7'),
        good.replace('"storePc":134217824','"storePc":134217826'),good.replace(row.imageSha256,'0'.repeat(64))]){
        assert.throws(()=>verifyProof(bad));
    }
    console.log('Seven portable proof guard checks pass; synthetic fixtures are not engine evidence.');
} else if(process.argv[2]) {
    const path=process.argv[2];
    const log=readFileSync(path,'utf8');
    const rows=verifyProof(log);
    const output=path+'.short-budget-proof.json';
    assert(!existsSync(output),'Preserve existing proof');
    const data=JSON.stringify({originalLog:path,sha256:createHash('sha256').update(log).digest('hex'),
        rows,scope:'Actual suite semantic observations, not fast-path census or RTx',verifiedAt:new Date().toISOString()},null,2)+'\n';
    execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+output+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
    console.log('All seven original actual-WASM guest proof records verified: '+output);
}
