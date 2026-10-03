import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='/tmp/labwired-same-host-20261003.R0T0cC';
const dir=root+'/cpu-hotpath-inspection-r4-20261003/baseline';
const receipt=JSON.parse(readFileSync(dir+'/selected-cpu.json'));
const functions=receipt.functions.map((f,index)=>{
    const bytes=Buffer.concat(receipt.bodyFiles[index].chunks.map(c=>readFileSync(dir+'/'+c.path)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),f.watSha256);
    const wat=bytes.toString(),lines=wat.split('\n'),branchTableTargetHistogram={};
    for(const line of lines.filter(l=>/^\s*br_table\b/.test(l))){
        const tokens=line.replace(/\(;[^;]*;\)/g,'').trim().split(/\s+/).slice(1);
        assert(tokens.every(t=>/^\d+$/.test(t)),'Unexpected branch target notation');
        branchTableTargetHistogram[tokens.length]=(branchTableTargetHistogram[tokens.length]||0)+1;
    }
    return {name:f.name,watSha256:f.watSha256,watBytes:bytes.length,lines:lines.length,
        nonWhitespaceBytes:Buffer.byteLength(wat.replace(/\s/g,'')),branchTableTargetHistogram};
});
const result={source:receipt.coreCommit,tool:receipt.toolCommit,run:37142446921,functions,
    limitations:['Text size is not binary size','Whitespace removal is analysis only; originals remain unchanged',
        'Tables are static syntactic counts, not hit frequencies or removable cost',
        'Eighteen targets fit 17 register cases plus default, but counts alone do not identify every table',
        'No performance, causality or source-promotion claim']};
const path=root+'/cpu-hotpath-text-analysis.json';assert(!existsSync(path));
const data=JSON.stringify(result,null,2)+'\n';
execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+path+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
console.log(JSON.stringify(result));
