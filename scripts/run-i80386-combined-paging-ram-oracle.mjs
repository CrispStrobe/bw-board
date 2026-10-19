#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {runCombinedPagingRamOracle,assertCombinedPagingRamOracle} from './i80386-combined-paging-ram-oracle.mjs';
const output=process.argv[2];
if(!output||process.argv.length!==3)throw Error('usage: node scripts/run-i80386-combined-paging-ram-oracle.mjs /new/capture.json');
const report=runCombinedPagingRamOracle();
writeFileSync(output,JSON.stringify(report)+'\n',{flag:'wx'});
console.log(JSON.stringify({capture:output,...assertCombinedPagingRamOracle(report)},null,2));
