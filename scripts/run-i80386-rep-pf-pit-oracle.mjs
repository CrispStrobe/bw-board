import {writeFileSync} from 'node:fs';
import {runRepPfPitOracle,assertRepPfPitOracle} from './i80386-rep-pf-pit-oracle.mjs';
const output=process.argv[2];if(!output)throw Error('capture path required');
const r=runRepPfPitOracle();writeFileSync(output,JSON.stringify(r)+'\n',{flag:'wx'});console.log(assertRepPfPitOracle(r));
