#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {runRepPfPitOracle,assertRepPfPitOracle} from './i80386-rep-pf-pit-oracle.mjs';
const output=process.argv[2];
if(!output||process.argv.length!==3)throw Error('usage: node scripts/run-i80386-rep-pf-pit-oracle.mjs /new/capture.json');
const r=runRepPfPitOracle();
// Preserve actual measurements before any semantic qualification assertion.
writeFileSync(output,JSON.stringify(r)+'\n',{flag:'wx'});
console.log(JSON.stringify({capture:output,...assertRepPfPitOracle(r)},null,2));
