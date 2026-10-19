#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {runRamCoherenceOracle,assertRamCoherenceOracle} from './i80386-ram-coherence-oracle.mjs';
const output=process.argv[2];
if(!output||process.argv.length!==3)throw Error('usage: node scripts/run-i80386-ram-coherence-oracle.mjs /new/capture.json');
const report=runRamCoherenceOracle();
// Retain the actual measurement even when a later semantic assertion fails.
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({capture:output,...assertRamCoherenceOracle(report)},null,2));
