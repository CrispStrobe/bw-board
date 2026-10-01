import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadDirectNative} from '../scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs';
// These source-stage tests exercise artifact admission, not compiled native execution.
test('direct addon loader requires explicit SHA and native filename',()=>{
 for(const [path,sha] of [['fake.node',undefined],['fake.js','0'.repeat(64)],['fake.node','MAIN']])assert.throws(()=>loadDirectNative(path,sha),/artifact path and SHA required/);
});
test('direct addon byte identity is checked before native module loading',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bw-direct-loader-'));
 try{const file=join(dir,'uncompiled.node');writeFileSync(file,'uncompiled source-stage fixture');assert.throws(()=>loadDirectNative(file,'0'.repeat(64)),/artifact SHA mismatch/);}finally{rmSync(dir,{recursive:true,force:true});}
});
