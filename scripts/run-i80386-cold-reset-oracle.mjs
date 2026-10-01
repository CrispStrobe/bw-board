#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {runColdResetOracle,assertColdResetOracle} from './i80386-cold-reset-oracle.mjs';
const output=process.argv[2];
if(!output)throw new Error('usage: node scripts/run-i80386-cold-reset-oracle.mjs /tmp/capture.json');
const report=runColdResetOracle();
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({capture:output,...assertColdResetOracle(report)},null,2));
