#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {runCode32RepPfOracle,validateCode32RepPfOracle} from './i80386-code32-rep-pf-oracle.mjs';
const output=process.argv[2];assert(output&&process.argv.length===3,'usage: node scripts/run-i80386-code32-rep-pf-js.mjs output/capture.json.gz');
const r=runCode32RepPfOracle();const summary=validateCode32RepPfOracle(r);
writeFileSync(output,gzipSync(Buffer.from(JSON.stringify(r)+'\n'),{mtime:0}),{flag:'wx'});
console.log(JSON.stringify({schema:r.schema,source:r.source,romSha256:r.romSha256,...summary}));
